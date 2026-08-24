"""Systematic tests for DICOM upload flow in the clinician view.

Covers:
  - Signed URL generation (upload-url endpoint)
  - Upload completion recording (upload-complete endpoint)
  - Assessment submission with file attachments (assessment endpoint)
  - Attachment flag computation (_get_attachment_flags)
  - Full end-to-end upload flows
  - Error handling and edge cases
"""
import io
import json
import pytest
from unittest.mock import patch, MagicMock

from .conftest import get_token, TestSession, TestQSession


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _start_questionnaire_session(client):
    """Create a session in the questionnaire DB via the public endpoint."""
    res = client.post("/api/session/start")
    assert res.status_code == 200
    return res.json()["sessionId"]


def _submit_questionnaire(client, session_id):
    """Submit questionnaire answers so the session has risk data."""
    res = client.post("/api/submit", json={
        "sessionId": session_id,
        "formDataEn": {
            "Q1": "45",
            "Q10": "13",
            "Q12_Current": "Yes",
            "Q14": "Yes",
            "Q16": "20 to 24",
            "Q17": "less than 12 months",
            "Q21": "No one",
            "Q40": "No",
            "Institute Name": "TestHospital",
        },
    })
    assert res.status_code == 200
    return res.json()


def _make_fake_dicom(name="test.dcm", size=1024):
    """Create a minimal fake DICOM file for upload testing."""
    content = b"\x00" * size
    return (name, io.BytesIO(content), "application/dicom")


def _clinician_token():
    return get_token("Clinician", "doctor@test.com")


def _admin_token():
    return get_token("Admin", "admin@test.com")


def _mock_gcs():
    """Return a patch context that mocks all GCS interactions."""
    mock_client = MagicMock()
    mock_bucket = MagicMock()
    mock_blob = MagicMock()

    mock_client.bucket.return_value = mock_bucket
    mock_bucket.blob.return_value = mock_blob
    mock_blob.generate_signed_url.return_value = "https://storage.googleapis.com/fake-signed-url"
    mock_blob.upload_from_string.return_value = None

    return patch(
        "backend.src.api.patient._get_storage_client",
        return_value=mock_client,
    ), patch(
        "backend.src.api.patient.upload_to_gcs",
        return_value="gs://test-bucket/fake-path/file.dcm",
    )


# ===========================================================================
# 1. Signed URL generation  (/api/v1/patient/upload-url)
# ===========================================================================

class TestUploadUrlEndpoint:
    """Tests for the signed-URL generation used by ResumableUpload."""

    def test_generates_signed_url_for_valid_dicom_type(self, client, seed_hospital_and_user):
        with _mock_gcs()[0]:
            token = _clinician_token()
            res = client.post("/api/v1/patient/upload-url", data={
                "file_type": "mammo_cc_left",
                "file_name": "scan_left_cc.dcm",
                "session_id": "test-session-001",
            }, headers={"Authorization": f"Bearer {token}"})

            assert res.status_code == 200
            data = res.json()
            assert "upload_url" in data
            assert "gcs_url" in data
            assert "blob_path" in data
            assert "mammogram" in data["blob_path"]
            assert "mammo_cc_left" in data["blob_path"]

    def test_generates_url_for_each_mammo_view(self, client, seed_hospital_and_user):
        token = _clinician_token()
        views = ["mammo_cc_left", "mammo_cc_right", "mammo_mlo_left", "mammo_mlo_right"]

        with _mock_gcs()[0]:
            for view in views:
                res = client.post("/api/v1/patient/upload-url", data={
                    "file_type": view,
                    "file_name": f"{view}.dcm",
                    "session_id": "test-session-views",
                }, headers={"Authorization": f"Bearer {token}"})
                assert res.status_code == 200, f"Failed for view {view}"
                assert view in res.json()["blob_path"]

    def test_generates_url_for_ultrasound(self, client, seed_hospital_and_user):
        with _mock_gcs()[0]:
            token = _clinician_token()
            res = client.post("/api/v1/patient/upload-url", data={
                "file_type": "us_video",
                "file_name": "ultrasound.dcm",
                "session_id": "test-session-us",
            }, headers={"Authorization": f"Bearer {token}"})
            assert res.status_code == 200
            assert "ultrasound" in res.json()["blob_path"]

    def test_generates_url_for_annotation(self, client, seed_hospital_and_user):
        with _mock_gcs()[0]:
            token = _clinician_token()
            res = client.post("/api/v1/patient/upload-url", data={
                "file_type": "annot_cc_left",
                "file_name": "annotation.dcm",
                "session_id": "test-session-annot",
            }, headers={"Authorization": f"Bearer {token}"})
            assert res.status_code == 200
            assert "annotation" in res.json()["blob_path"]

    def test_rejects_unauthenticated_request(self, client):
        res = client.post("/api/v1/patient/upload-url", data={
            "file_type": "mammo_cc_left",
            "file_name": "test.dcm",
            "session_id": "session-123",
        })
        assert res.status_code == 401

    def test_rejects_missing_required_fields(self, client, seed_hospital_and_user):
        token = _clinician_token()
        res = client.post("/api/v1/patient/upload-url", data={
            "file_type": "mammo_cc_left",
        }, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 422

    def test_blob_path_includes_hospital_and_session(self, client, seed_hospital_and_user):
        with _mock_gcs()[0]:
            token = _clinician_token()
            res = client.post("/api/v1/patient/upload-url", data={
                "file_type": "mammo_cc_left",
                "file_name": "test.dcm",
                "session_id": "session-abc-123",
            }, headers={"Authorization": f"Bearer {token}"})
            blob_path = res.json()["blob_path"]
            assert "clinic_00001" in blob_path
            assert "session-abc-123" in blob_path

    def test_gcs_url_format(self, client, seed_hospital_and_user):
        with _mock_gcs()[0]:
            token = _clinician_token()
            res = client.post("/api/v1/patient/upload-url", data={
                "file_type": "mammo_cc_left",
                "file_name": "test.dcm",
                "session_id": "s1",
            }, headers={"Authorization": f"Bearer {token}"})
            gcs_url = res.json()["gcs_url"]
            assert gcs_url.startswith("gs://")


# ===========================================================================
# 2. Upload completion recording  (/api/v1/patient/upload-complete)
# ===========================================================================

class TestUploadCompleteEndpoint:
    """Tests for recording a completed GCS upload in the DB."""

    def test_records_new_upload_creates_assessment(self, client, seed_hospital_and_user):
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        res = client.post("/api/v1/patient/upload-complete", data={
            "session_id": session_id,
            "file_type": "mammo_cc_left",
            "file_name": "cc_left.dcm",
            "gcs_url": "gs://bucket/path/cc_left.dcm",
            "mime_type": "application/dicom",
        }, headers={"Authorization": f"Bearer {token}"})

        assert res.status_code == 200
        assert res.json()["success"] is True

    def test_records_multiple_file_types(self, client, seed_hospital_and_user):
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()
        file_types = ["mammo_cc_left", "mammo_cc_right", "mammo_mlo_left", "mammo_mlo_right"]

        for ft in file_types:
            res = client.post("/api/v1/patient/upload-complete", data={
                "session_id": session_id,
                "file_type": ft,
                "file_name": f"{ft}.dcm",
                "gcs_url": f"gs://bucket/path/{ft}.dcm",
                "mime_type": "application/dicom",
            }, headers={"Authorization": f"Bearer {token}"})
            assert res.status_code == 200

    def test_replaces_existing_upload_same_type(self, client, seed_hospital_and_user):
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        for i in range(2):
            res = client.post("/api/v1/patient/upload-complete", data={
                "session_id": session_id,
                "file_type": "mammo_cc_left",
                "file_name": f"cc_left_v{i}.dcm",
                "gcs_url": f"gs://bucket/path/cc_left_v{i}.dcm",
                "mime_type": "application/dicom",
            }, headers={"Authorization": f"Bearer {token}"})
            assert res.status_code == 200

    def test_records_ultrasound_upload(self, client, seed_hospital_and_user):
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        res = client.post("/api/v1/patient/upload-complete", data={
            "session_id": session_id,
            "file_type": "us_video",
            "file_name": "ultrasound.dcm",
            "gcs_url": "gs://bucket/path/us.dcm",
            "mime_type": "application/dicom",
        }, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200

    def test_records_annotation_upload(self, client, seed_hospital_and_user):
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        res = client.post("/api/v1/patient/upload-complete", data={
            "session_id": session_id,
            "file_type": "annot_cc_left",
            "file_name": "annot.dcm",
            "gcs_url": "gs://bucket/path/annot.dcm",
            "mime_type": "application/dicom",
        }, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200

    def test_rejects_unauthenticated(self, client):
        res = client.post("/api/v1/patient/upload-complete", data={
            "session_id": "s1",
            "file_type": "mammo_cc_left",
            "file_name": "test.dcm",
            "gcs_url": "gs://bucket/test.dcm",
        })
        assert res.status_code == 401

    def test_rejects_missing_fields(self, client, seed_hospital_and_user):
        token = _clinician_token()
        res = client.post("/api/v1/patient/upload-complete", data={
            "session_id": "s1",
        }, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 422


# ===========================================================================
# 3. Assessment submission with file uploads  (/api/v1/patient/assessment)
# ===========================================================================

class TestAssessmentWithFileUpload:
    """Tests for DICOM/file uploads through the assessment form submission."""

    def _base_assessment_data(self, session_id):
        return {
            "patient_session_id": session_id,
            "questionnaire_feedback": "Looks correct",
            "is_questionnaire_correct": "true",
            "mammo_birads": "1",
            "mammo_density": "A",
            "us_biopsy_birads": "",
            "us_biopsy_density": "",
            "precision_diagnosis": "",
            "datapoint_feedback": "",
            "clinical_findings": json.dumps({
                "right": {"masses": False, "birads": "1", "density": "A"},
                "left": {"masses": False, "birads": "2", "density": "B"},
            }),
            "recommendation_followup": "Routine screening",
            "routine_views_uploaded": "false",
            "doctor_risk_class": "Baseline Risk",
            "doctor_case_notes": "Normal",
        }

    def test_assessment_with_mammo_cc_left(self, client, seed_hospital_and_user):
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        gcs_patch, upload_patch = _mock_gcs()
        with gcs_patch, upload_patch:
            data = self._base_assessment_data(session_id)
            res = client.post("/api/v1/patient/assessment",
                data=data,
                files={"mammo_cc_left": _make_fake_dicom("cc_left.dcm")},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 200
            resp_data = res.json()
            assert resp_data["patient_session_id"] == session_id
            atts = resp_data.get("attachments", [])
            assert any(a["file_type"] == "mammo_cc_left" for a in atts)

    def test_assessment_with_all_four_mammo_views(self, client, seed_hospital_and_user):
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        gcs_patch, upload_patch = _mock_gcs()
        with gcs_patch, upload_patch:
            data = self._base_assessment_data(session_id)
            files = {
                "mammo_cc_left": _make_fake_dicom("cc_left.dcm"),
                "mammo_cc_right": _make_fake_dicom("cc_right.dcm"),
                "mammo_mlo_left": _make_fake_dicom("mlo_left.dcm"),
                "mammo_mlo_right": _make_fake_dicom("mlo_right.dcm"),
            }
            res = client.post("/api/v1/patient/assessment",
                data=data, files=files,
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 200
            atts = res.json().get("attachments", [])
            att_types = {a["file_type"] for a in atts}
            assert {"mammo_cc_left", "mammo_cc_right", "mammo_mlo_left", "mammo_mlo_right"}.issubset(att_types)

    def test_assessment_with_mammo_reading_pdf(self, client, seed_hospital_and_user):
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        gcs_patch, upload_patch = _mock_gcs()
        with gcs_patch, upload_patch:
            data = self._base_assessment_data(session_id)
            res = client.post("/api/v1/patient/assessment",
                data=data,
                files={"mammo_reading": ("report.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 200
            atts = res.json().get("attachments", [])
            assert any(a["file_type"] == "mammo_reading" for a in atts)

    def test_assessment_with_ultrasound_video(self, client, seed_hospital_and_user):
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        gcs_patch, upload_patch = _mock_gcs()
        with gcs_patch, upload_patch:
            data = self._base_assessment_data(session_id)
            res = client.post("/api/v1/patient/assessment",
                data=data,
                files={"us_video": _make_fake_dicom("us_scan.dcm")},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 200
            atts = res.json().get("attachments", [])
            assert any(a["file_type"] == "us_video" for a in atts)

    def test_assessment_with_ultrasound_reading(self, client, seed_hospital_and_user):
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        gcs_patch, upload_patch = _mock_gcs()
        with gcs_patch, upload_patch:
            data = self._base_assessment_data(session_id)
            res = client.post("/api/v1/patient/assessment",
                data=data,
                files={"us_reading": ("us_report.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 200
            atts = res.json().get("attachments", [])
            assert any(a["file_type"] == "us_reading" for a in atts)

    def test_assessment_with_biopsy_doc(self, client, seed_hospital_and_user):
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        gcs_patch, upload_patch = _mock_gcs()
        with gcs_patch, upload_patch:
            data = self._base_assessment_data(session_id)
            res = client.post("/api/v1/patient/assessment",
                data=data,
                files={"biopsy_doc": ("biopsy.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 200
            atts = res.json().get("attachments", [])
            assert any(a["file_type"] == "biopsy_reading" for a in atts)

    def test_assessment_with_annotation_files(self, client, seed_hospital_and_user):
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        gcs_patch, upload_patch = _mock_gcs()
        with gcs_patch, upload_patch:
            data = self._base_assessment_data(session_id)
            files = {
                "annot_cc_left": _make_fake_dicom("annot_cc_l.dcm"),
                "annot_cc_right": _make_fake_dicom("annot_cc_r.dcm"),
                "annot_mlo_left": _make_fake_dicom("annot_mlo_l.dcm"),
                "annot_mlo_right": _make_fake_dicom("annot_mlo_r.dcm"),
            }
            res = client.post("/api/v1/patient/assessment",
                data=data, files=files,
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 200
            att_types = {a["file_type"] for a in res.json().get("attachments", [])}
            for annot in ["annot_cc_left", "annot_cc_right", "annot_mlo_left", "annot_mlo_right"]:
                assert annot in att_types

    def test_assessment_with_all_file_types(self, client, seed_hospital_and_user):
        """Full upload: all 4 mammo views + reports + US + biopsy + annotations."""
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        gcs_patch, upload_patch = _mock_gcs()
        with gcs_patch, upload_patch:
            data = self._base_assessment_data(session_id)
            files = {
                "mammo_cc_left": _make_fake_dicom("cc_l.dcm"),
                "mammo_cc_right": _make_fake_dicom("cc_r.dcm"),
                "mammo_mlo_left": _make_fake_dicom("mlo_l.dcm"),
                "mammo_mlo_right": _make_fake_dicom("mlo_r.dcm"),
                "mammo_reading": ("report.pdf", io.BytesIO(b"%PDF"), "application/pdf"),
                "us_video": _make_fake_dicom("us.dcm"),
                "us_reading": ("us_report.pdf", io.BytesIO(b"%PDF"), "application/pdf"),
                "biopsy_doc": ("biopsy.pdf", io.BytesIO(b"%PDF"), "application/pdf"),
                "annot_cc_left": _make_fake_dicom("annot_cc_l.dcm"),
                "annot_cc_right": _make_fake_dicom("annot_cc_r.dcm"),
                "annot_mlo_left": _make_fake_dicom("annot_mlo_l.dcm"),
                "annot_mlo_right": _make_fake_dicom("annot_mlo_r.dcm"),
            }
            res = client.post("/api/v1/patient/assessment",
                data=data, files=files,
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 200
            att_types = {a["file_type"] for a in res.json().get("attachments", [])}
            expected = {
                "mammo_cc_left", "mammo_cc_right", "mammo_mlo_left", "mammo_mlo_right",
                "mammo_reading", "us_video", "us_reading", "biopsy_reading",
                "annot_cc_left", "annot_cc_right", "annot_mlo_left", "annot_mlo_right",
            }
            assert expected.issubset(att_types)

    def test_file_replacement_on_update(self, client, seed_hospital_and_user):
        """Re-uploading a file for the same type should replace, not duplicate."""
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        gcs_patch, upload_patch = _mock_gcs()
        with gcs_patch, upload_patch:
            data = self._base_assessment_data(session_id)

            # First upload
            res1 = client.post("/api/v1/patient/assessment",
                data=data,
                files={"mammo_cc_left": _make_fake_dicom("cc_left_v1.dcm")},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res1.status_code == 200
            assessment_id = res1.json()["id"]
            v1_atts = [a for a in res1.json()["attachments"] if a["file_type"] == "mammo_cc_left"]
            assert len(v1_atts) == 1
            assert v1_atts[0]["file_name"] == "cc_left_v1.dcm"

            # Second upload — should replace
            res2 = client.post("/api/v1/patient/assessment",
                data=data,
                files={"mammo_cc_left": _make_fake_dicom("cc_left_v2.dcm")},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res2.status_code == 200
            assert res2.json()["id"] == assessment_id
            v2_atts = [a for a in res2.json()["attachments"] if a["file_type"] == "mammo_cc_left"]
            assert len(v2_atts) == 1
            assert v2_atts[0]["file_name"] == "cc_left_v2.dcm"

    def test_assessment_no_files_still_succeeds(self, client, seed_hospital_and_user):
        """Assessment with no file uploads should still save clinical data."""
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        data = self._base_assessment_data(session_id)
        res = client.post("/api/v1/patient/assessment",
            data=data,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200
        assert res.json()["recommendation_followup"] == "Routine screening"

    def test_gcs_failure_saves_assessment_with_warnings(self, client, seed_hospital_and_user):
        """If GCS upload fails, the assessment data should still be saved with upload warnings."""
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        with patch("backend.src.api.patient.upload_to_gcs", side_effect=Exception("GCS unavailable")):
            data = self._base_assessment_data(session_id)
            res = client.post("/api/v1/patient/assessment",
                data=data,
                files={"mammo_cc_left": _make_fake_dicom("cc_left.dcm")},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 200
            resp_data = res.json()
            assert resp_data["recommendation_followup"] == "Routine screening"
            assert resp_data["upload_warnings"] is not None
            assert any("GCS unavailable" in w for w in resp_data["upload_warnings"])

    def test_partial_gcs_failure_saves_successful_uploads(self, client, seed_hospital_and_user):
        """Some uploads succeed, some fail — assessment and successful uploads are saved."""
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        call_count = 0
        original_upload = MagicMock(return_value="gs://test-bucket/fake.dcm")

        def fail_second_call(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise Exception("GCS timeout")
            return original_upload(*args, **kwargs)

        with patch("backend.src.api.patient.upload_to_gcs", side_effect=fail_second_call):
            data = self._base_assessment_data(session_id)
            files = {
                "mammo_cc_left": _make_fake_dicom("cc_left.dcm"),
                "mammo_cc_right": _make_fake_dicom("cc_right.dcm"),
            }
            res = client.post("/api/v1/patient/assessment",
                data=data, files=files,
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 200
            resp_data = res.json()
            assert resp_data["recommendation_followup"] == "Routine screening"
            atts = resp_data.get("attachments", [])
            assert any(a["file_type"] == "mammo_cc_left" for a in atts)
            assert resp_data["upload_warnings"] is not None
            assert len(resp_data["upload_warnings"]) == 1

    def test_assessment_unauthorized(self, client):
        res = client.post("/api/v1/patient/assessment",
            data={"patient_session_id": "s1", "is_questionnaire_correct": "false",
                   "routine_views_uploaded": "false"},
        )
        assert res.status_code == 401

    def test_assessment_invalid_session(self, client, seed_hospital_and_user):
        token = _clinician_token()
        data = self._base_assessment_data("nonexistent-session-id")
        res = client.post("/api/v1/patient/assessment",
            data=data,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code in [404, 500]


# ===========================================================================
# 4. Attachment flag computation
# ===========================================================================

class TestAttachmentFlags:
    """Tests for _get_attachment_flags used by the doctor sessions list."""

    def test_no_assessment_returns_all_false(self):
        from backend.src.api.doctor import _get_attachment_flags
        flags = _get_attachment_flags(None)
        assert flags["has_assessment"] is False
        assert flags["has_mammo_dicom"] is False
        assert flags["has_mammo_reading"] == ""
        assert flags["has_us_video"] == ""
        assert flags["has_us_reading"] == ""
        assert flags["has_biopsy"] is False
        assert flags["has_annotations"] is False

    def test_empty_assessment_no_attachments(self):
        from backend.src.api.doctor import _get_attachment_flags
        assessment = MagicMock()
        assessment.attachments = []
        flags = _get_attachment_flags(assessment)
        assert flags["has_assessment"] is True
        assert flags["has_mammo_dicom"] is False

    def test_all_four_mammo_views(self):
        from backend.src.api.doctor import _get_attachment_flags
        assessment = MagicMock()
        assessment.attachments = [
            MagicMock(file_type="mammo_cc_left"),
            MagicMock(file_type="mammo_cc_right"),
            MagicMock(file_type="mammo_mlo_left"),
            MagicMock(file_type="mammo_mlo_right"),
        ]
        flags = _get_attachment_flags(assessment)
        assert flags["has_mammo_dicom"] is True

    def test_partial_mammo_views_not_complete(self):
        from backend.src.api.doctor import _get_attachment_flags
        assessment = MagicMock()
        assessment.attachments = [
            MagicMock(file_type="mammo_cc_left"),
            MagicMock(file_type="mammo_cc_right"),
        ]
        flags = _get_attachment_flags(assessment)
        assert flags["has_mammo_dicom"] is False

    def test_mammo_reading_flag(self):
        from backend.src.api.doctor import _get_attachment_flags
        assessment = MagicMock()
        assessment.attachments = [MagicMock(file_type="mammo_reading")]
        flags = _get_attachment_flags(assessment)
        assert flags["has_mammo_reading"] == "Yes"

    def test_us_video_flag(self):
        from backend.src.api.doctor import _get_attachment_flags
        assessment = MagicMock()
        assessment.attachments = [MagicMock(file_type="us_video")]
        flags = _get_attachment_flags(assessment)
        assert flags["has_us_video"] == "Yes"

    def test_us_reading_flag(self):
        from backend.src.api.doctor import _get_attachment_flags
        assessment = MagicMock()
        assessment.attachments = [MagicMock(file_type="us_reading")]
        flags = _get_attachment_flags(assessment)
        assert flags["has_us_reading"] == "Yes"

    def test_biopsy_flag(self):
        from backend.src.api.doctor import _get_attachment_flags
        assessment = MagicMock()
        assessment.attachments = [MagicMock(file_type="biopsy_reading")]
        flags = _get_attachment_flags(assessment)
        assert flags["has_biopsy"] is True

    def test_annotation_flag(self):
        from backend.src.api.doctor import _get_attachment_flags
        assessment = MagicMock()
        assessment.attachments = [
            MagicMock(file_type="annot_cc_left"),
            MagicMock(file_type="annot_mlo_right"),
        ]
        flags = _get_attachment_flags(assessment)
        assert flags["has_annotations"] is True

    def test_smr_flag_all_mammo_and_us_reading_no_mammo_reading_no_us_video(self):
        """SMR = all 4 mammo views + us_reading, but NO mammo_reading and NO us_video."""
        from backend.src.api.doctor import _get_attachment_flags
        assessment = MagicMock()
        assessment.attachments = [
            MagicMock(file_type="mammo_cc_left"),
            MagicMock(file_type="mammo_cc_right"),
            MagicMock(file_type="mammo_mlo_left"),
            MagicMock(file_type="mammo_mlo_right"),
            MagicMock(file_type="us_reading"),
        ]
        flags = _get_attachment_flags(assessment)
        assert flags["has_mammo_reading"] == "SMR"
        assert flags["has_us_video"] == "SMR"
        assert flags["has_us_reading"] == "SMR"

    def test_not_smr_when_mammo_reading_present(self):
        """With mammo_reading present, should NOT be SMR."""
        from backend.src.api.doctor import _get_attachment_flags
        assessment = MagicMock()
        assessment.attachments = [
            MagicMock(file_type="mammo_cc_left"),
            MagicMock(file_type="mammo_cc_right"),
            MagicMock(file_type="mammo_mlo_left"),
            MagicMock(file_type="mammo_mlo_right"),
            MagicMock(file_type="us_reading"),
            MagicMock(file_type="mammo_reading"),
        ]
        flags = _get_attachment_flags(assessment)
        assert flags["has_mammo_reading"] == "Yes"
        assert flags["has_us_video"] != "SMR"
        assert flags["has_us_reading"] == "Yes"


# ===========================================================================
# 5. End-to-end flow tests
# ===========================================================================

class TestEndToEndUploadFlow:
    """Integration tests for complete upload workflows."""

    def test_resumable_upload_flow(self, client, seed_hospital_and_user):
        """Simulate the ResumableUpload component's three-step flow."""
        session_id = _start_questionnaire_session(client)
        _submit_questionnaire(client, session_id)
        token = _clinician_token()

        # Step 1: Get signed URL
        with _mock_gcs()[0]:
            url_res = client.post("/api/v1/patient/upload-url", data={
                "file_type": "mammo_cc_left",
                "file_name": "cc_left.dcm",
                "session_id": session_id,
            }, headers={"Authorization": f"Bearer {token}"})
            assert url_res.status_code == 200
            gcs_url = url_res.json()["gcs_url"]

        # Step 2: (simulated) PUT to signed URL — skipped in unit tests

        # Step 3: Record completion
        complete_res = client.post("/api/v1/patient/upload-complete", data={
            "session_id": session_id,
            "file_type": "mammo_cc_left",
            "file_name": "cc_left.dcm",
            "gcs_url": gcs_url,
            "mime_type": "application/dicom",
        }, headers={"Authorization": f"Bearer {token}"})
        assert complete_res.status_code == 200

    def test_all_four_mammo_resumable_then_verify_via_detail(self, client, seed_hospital_and_user):
        """Upload all 4 mammo views via resumable flow, then check session detail flags."""
        session_id = _start_questionnaire_session(client)
        _submit_questionnaire(client, session_id)
        token = _clinician_token()

        views = ["mammo_cc_left", "mammo_cc_right", "mammo_mlo_left", "mammo_mlo_right"]
        for view in views:
            with _mock_gcs()[0]:
                url_res = client.post("/api/v1/patient/upload-url", data={
                    "file_type": view,
                    "file_name": f"{view}.dcm",
                    "session_id": session_id,
                }, headers={"Authorization": f"Bearer {token}"})
                gcs_url = url_res.json()["gcs_url"]

            client.post("/api/v1/patient/upload-complete", data={
                "session_id": session_id,
                "file_type": view,
                "file_name": f"{view}.dcm",
                "gcs_url": gcs_url,
                "mime_type": "application/dicom",
            }, headers={"Authorization": f"Bearer {token}"})

        # Verify via session detail (avoids MySQL-specific IN-tuple syntax in list endpoint)
        detail_res = client.get(f"/api/v1/doctor/sessions/{session_id}",
            headers={"Authorization": f"Bearer {token}"})
        assert detail_res.status_code == 200
        assert detail_res.json()["has_mammo_dicom"] is True

    def test_assessment_then_verify_session_detail(self, client, seed_hospital_and_user):
        """Submit assessment with files, then verify session detail returns them."""
        session_id = _start_questionnaire_session(client)
        _submit_questionnaire(client, session_id)
        token = _clinician_token()

        gcs_patch, upload_patch = _mock_gcs()
        with gcs_patch, upload_patch:
            data = {
                "patient_session_id": session_id,
                "questionnaire_feedback": "",
                "is_questionnaire_correct": "true",
                "mammo_birads": "2",
                "mammo_density": "B",
                "us_biopsy_birads": "",
                "us_biopsy_density": "",
                "precision_diagnosis": "",
                "datapoint_feedback": "",
                "clinical_findings": json.dumps({
                    "right": {"masses": False, "birads": "2", "density": "B"},
                    "left": {"masses": False, "birads": "1", "density": "A"},
                }),
                "recommendation_followup": "Annual screening",
                "routine_views_uploaded": "true",
                "doctor_risk_class": "Baseline Risk",
                "doctor_case_notes": "Normal findings",
            }
            files = {
                "mammo_cc_left": _make_fake_dicom("cc_l.dcm"),
                "mammo_cc_right": _make_fake_dicom("cc_r.dcm"),
                "mammo_mlo_left": _make_fake_dicom("mlo_l.dcm"),
                "mammo_mlo_right": _make_fake_dicom("mlo_r.dcm"),
            }
            assess_res = client.post("/api/v1/patient/assessment",
                data=data, files=files,
                headers={"Authorization": f"Bearer {token}"},
            )
            assert assess_res.status_code == 200

        # Verify session detail
        detail_res = client.get(f"/api/v1/doctor/sessions/{session_id}",
            headers={"Authorization": f"Bearer {token}"})
        assert detail_res.status_code == 200
        detail = detail_res.json()
        assert detail["has_assessment"] is True
        assert detail["has_mammo_dicom"] is True

    def test_upload_without_prior_assessment_creates_one(self, client, seed_hospital_and_user):
        """Using upload-complete before any assessment should auto-create an assessment."""
        session_id = _start_questionnaire_session(client)
        token = _clinician_token()

        res = client.post("/api/v1/patient/upload-complete", data={
            "session_id": session_id,
            "file_type": "mammo_cc_left",
            "file_name": "cc_left.dcm",
            "gcs_url": "gs://bucket/path/cc_left.dcm",
            "mime_type": "application/dicom",
        }, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200

        # Subsequent assessment submission should find and update the existing record
        gcs_patch, upload_patch = _mock_gcs()
        with gcs_patch, upload_patch:
            assess_res = client.post("/api/v1/patient/assessment", data={
                "patient_session_id": session_id,
                "is_questionnaire_correct": "true",
                "mammo_birads": "1",
                "mammo_density": "A",
                "us_biopsy_birads": "",
                "us_biopsy_density": "",
                "precision_diagnosis": "",
                "datapoint_feedback": "",
                "clinical_findings": "{}",
                "recommendation_followup": "OK",
                "routine_views_uploaded": "false",
            }, headers={"Authorization": f"Bearer {token}"})
            assert assess_res.status_code == 200
            atts = assess_res.json().get("attachments", [])
            assert any(a["file_type"] == "mammo_cc_left" for a in atts)


# ===========================================================================
# 6. Blob path construction
# ===========================================================================

class TestBlobPathConstruction:
    """Tests for build_blob_path utility."""

    def test_basic_blob_path(self):
        from backend.src.api.patient import build_blob_path
        import datetime
        import pytz
        ist = pytz.timezone("Asia/Kolkata")
        now = datetime.datetime(2024, 6, 15, 10, 30, 0, tzinfo=ist)

        path = build_blob_path("clinic_001", "session_123", "mammo_cc_left", "scan.dcm", now)
        assert path.startswith("tanuh-data-capture/")
        assert "clinic_001" in path
        assert "session_123" in path
        assert "mammogram" in path
        assert "mammo_cc_left" in path
        assert path.endswith(".dcm")

    def test_blob_path_with_sequence(self):
        from backend.src.api.patient import build_blob_path
        import datetime
        import pytz
        ist = pytz.timezone("Asia/Kolkata")
        now = datetime.datetime(2024, 6, 15, 10, 30, 0, tzinfo=ist)

        path = build_blob_path("c1", "s1", "mammo_dicom", "file.dcm", now, seq=3)
        assert "mammo_dicom-3" in path

    def test_blob_path_unknown_file_type_uses_type_as_folder(self):
        from backend.src.api.patient import build_blob_path
        import datetime
        import pytz
        ist = pytz.timezone("Asia/Kolkata")
        now = datetime.datetime(2024, 6, 15, 10, 30, 0, tzinfo=ist)

        path = build_blob_path("c1", "s1", "unknown_type", "file.bin", now)
        assert "unknown_type" in path

    def test_blob_path_preserves_extension(self):
        from backend.src.api.patient import build_blob_path
        import datetime
        import pytz
        ist = pytz.timezone("Asia/Kolkata")
        now = datetime.datetime(2024, 6, 15, 10, 30, 0, tzinfo=ist)

        for ext in ["dcm", "pdf", "jpg", "mp4"]:
            path = build_blob_path("c1", "s1", "mammo_cc_left", f"file.{ext}", now)
            assert path.endswith(f".{ext}")

    def test_blob_path_file_without_extension_defaults_to_bin(self):
        from backend.src.api.patient import build_blob_path
        import datetime
        import pytz
        ist = pytz.timezone("Asia/Kolkata")
        now = datetime.datetime(2024, 6, 15, 10, 30, 0, tzinfo=ist)

        path = build_blob_path("c1", "s1", "mammo_cc_left", "noextension", now)
        assert path.endswith(".bin")


# ===========================================================================
# 7. FILE_TYPE_MAP coverage
# ===========================================================================

class TestFileTypeMap:
    """Verify FILE_TYPE_MAP maps all frontend file types to GCS folder names."""

    def test_all_mammo_types_map_to_mammogram(self):
        from backend.src.api.patient import FILE_TYPE_MAP
        for ft in ["mammo_dicom", "mammo_cc_left", "mammo_cc_right", "mammo_mlo_left", "mammo_mlo_right"]:
            assert FILE_TYPE_MAP[ft] == "mammogram", f"{ft} should map to 'mammogram'"

    def test_annotation_types(self):
        from backend.src.api.patient import FILE_TYPE_MAP
        for ft in ["annot_cc_left", "annot_cc_right", "annot_mlo_left", "annot_mlo_right"]:
            assert FILE_TYPE_MAP[ft] == "annotation", f"{ft} should map to 'annotation'"

    def test_report_types(self):
        from backend.src.api.patient import FILE_TYPE_MAP
        assert FILE_TYPE_MAP["mammo_reading"] == "mammogram-report"
        assert FILE_TYPE_MAP["us_reading"] == "ultrasound-report"

    def test_ultrasound_type(self):
        from backend.src.api.patient import FILE_TYPE_MAP
        assert FILE_TYPE_MAP["us_video"] == "ultrasound"

    def test_biopsy_type(self):
        from backend.src.api.patient import FILE_TYPE_MAP
        assert FILE_TYPE_MAP["biopsy_reading"] == "biopsy"

    def test_consent_type(self):
        from backend.src.api.patient import FILE_TYPE_MAP
        assert FILE_TYPE_MAP["consent"] == "consent"


# ===========================================================================
# 8. Permission / authorization edge cases
# ===========================================================================

class TestUploadPermissions:
    """Tests for role-based access to upload endpoints."""

    def test_admin_can_submit_assessment(self, client, seed_hospital_and_user):
        session_id = _start_questionnaire_session(client)
        token = _admin_token()

        gcs_patch, upload_patch = _mock_gcs()
        with gcs_patch, upload_patch:
            res = client.post("/api/v1/patient/assessment", data={
                "patient_session_id": session_id,
                "is_questionnaire_correct": "true",
                "mammo_birads": "1",
                "mammo_density": "A",
                "us_biopsy_birads": "",
                "us_biopsy_density": "",
                "precision_diagnosis": "",
                "datapoint_feedback": "",
                "clinical_findings": "{}",
                "recommendation_followup": "",
                "routine_views_uploaded": "false",
            }, headers={"Authorization": f"Bearer {token}"})
            assert res.status_code == 200

    def test_admin_can_update_clinician_assessment(self, client, seed_hospital_and_user):
        """Admin should be able to update an assessment created by a clinician."""
        session_id = _start_questionnaire_session(client)
        clinician_token = _clinician_token()
        admin_token = _admin_token()

        base_data = {
            "patient_session_id": session_id,
            "is_questionnaire_correct": "true",
            "mammo_birads": "1",
            "mammo_density": "A",
            "us_biopsy_birads": "",
            "us_biopsy_density": "",
            "precision_diagnosis": "",
            "datapoint_feedback": "",
            "clinical_findings": "{}",
            "recommendation_followup": "Initial",
            "routine_views_uploaded": "false",
        }

        # Clinician creates
        res1 = client.post("/api/v1/patient/assessment",
            data=base_data, headers={"Authorization": f"Bearer {clinician_token}"})
        assert res1.status_code == 200

        # Admin updates
        base_data["recommendation_followup"] = "Updated by admin"
        res2 = client.post("/api/v1/patient/assessment",
            data=base_data, headers={"Authorization": f"Bearer {admin_token}"})
        assert res2.status_code == 200
        assert res2.json()["recommendation_followup"] == "Updated by admin"

    def test_clinician_can_generate_upload_url(self, client, seed_hospital_and_user):
        with _mock_gcs()[0]:
            token = _clinician_token()
            res = client.post("/api/v1/patient/upload-url", data={
                "file_type": "mammo_cc_left",
                "file_name": "test.dcm",
                "session_id": "s1",
            }, headers={"Authorization": f"Bearer {token}"})
            assert res.status_code == 200

    def test_staff_can_generate_upload_url(self, client, seed_hospital_and_user):
        with _mock_gcs()[0]:
            token = get_token("Staff", "staff@test.com")
            res = client.post("/api/v1/patient/upload-url", data={
                "file_type": "mammo_cc_left",
                "file_name": "test.dcm",
                "session_id": "s1",
            }, headers={"Authorization": f"Bearer {token}"})
            assert res.status_code == 200
