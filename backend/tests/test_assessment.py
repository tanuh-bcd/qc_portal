"""Tests for clinician assessment submission against bcd_questionnaire sessions."""
import pytest
import json
from .conftest import get_token


class TestAssessmentSubmission:
    """Test the full assessment flow: session exists in bcd_questionnaire,
    assessment saved in bcd_application2."""

    def _get_valid_session_id(self, client):
        """Get a real session ID from bcd_questionnaire via the public endpoint."""
        res = client.post("/api/session/start")
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        return data["sessionId"]

    def test_submit_basic_assessment(self, client, seed_hospital_and_user):
        """Submit a minimal assessment with clinical findings."""
        session_id = self._get_valid_session_id(client)
        token = get_token("Clinician", "doctor@test.com")

        clinical = json.dumps({
            "right": {
                "masses": False,
                "calcification": False,
                "skin_thickening": False,
                "nipple_retraction": False,
                "lymph_nodes": False,
                "architectural_distortion": False,
                "focal_asymmetry": False,
                "asymmetry": False,
                "birads": "1",
                "density": "A",
                "comments": ""
            },
            "left": {
                "masses": False,
                "calcification": False,
                "skin_thickening": False,
                "nipple_retraction": False,
                "lymph_nodes": False,
                "architectural_distortion": False,
                "focal_asymmetry": False,
                "asymmetry": False,
                "birads": "2",
                "density": "B",
                "comments": ""
            }
        })

        res = client.post("/api/v1/patient/assessment", data={
            "patient_session_id": session_id,
            "questionnaire_feedback": "Looks correct",
            "is_questionnaire_correct": "true",
            "mammo_birads": "1",
            "mammo_density": "A",
            "us_biopsy_birads": "",
            "us_biopsy_density": "",
            "precision_diagnosis": "",
            "datapoint_feedback": "",
            "clinical_findings": clinical,
            "recommendation_followup": "Routine screening in 12 months",
            "routine_views_uploaded": "false",
            "doctor_risk_class": "Baseline Risk",
            "doctor_case_notes": "No abnormalities detected",
        }, headers={"Authorization": f"Bearer {token}"})

        assert res.status_code == 200
        data = res.json()
        assert data["patient_session_id"] == session_id
        assert data["recommendation_followup"] == "Routine screening in 12 months"
        assert data["doctor_risk_class"] == "Baseline Risk"
        assert data["doctor_case_notes"] == "No abnormalities detected"

    def test_submit_high_risk_assessment(self, client, seed_hospital_and_user):
        """Submit assessment with high-risk findings — masses, calcification, lymph nodes."""
        session_id = self._get_valid_session_id(client)
        token = get_token("Clinician", "doctor@test.com")

        clinical = json.dumps({
            "right": {
                "masses": True,
                "mass_location": "Upper outer quadrant",
                "mass_description": "2cm irregular spiculated mass",
                "calcification": True,
                "calcification_type": "suspicious",
                "skin_thickening": True,
                "nipple_retraction": False,
                "lymph_nodes": True,
                "lymph_nodes_type": "malignant",
                "architectural_distortion": True,
                "focal_asymmetry": False,
                "asymmetry": False,
                "birads": "4",
                "birads_4_sub": "4C",
                "density": "C",
                "comments": "Highly suspicious lesion"
            },
            "left": {
                "masses": False,
                "calcification": False,
                "skin_thickening": False,
                "nipple_retraction": False,
                "lymph_nodes": False,
                "architectural_distortion": False,
                "focal_asymmetry": False,
                "asymmetry": False,
                "birads": "1",
                "density": "B",
                "comments": "Normal"
            }
        })

        res = client.post("/api/v1/patient/assessment", data={
            "patient_session_id": session_id,
            "questionnaire_feedback": "",
            "is_questionnaire_correct": "true",
            "mammo_birads": "4",
            "mammo_density": "C",
            "us_biopsy_birads": "",
            "us_biopsy_density": "",
            "precision_diagnosis": "",
            "datapoint_feedback": "",
            "clinical_findings": clinical,
            "recommendation_followup": "Urgent biopsy recommended. Refer to oncology.",
            "routine_views_uploaded": "true",
            "doctor_risk_class": "High Risk",
            "doctor_case_notes": "Right breast shows 2cm spiculated mass in UOQ with suspicious calcifications and malignant axillary lymphadenopathy.",
        }, headers={"Authorization": f"Bearer {token}"})

        assert res.status_code == 200
        data = res.json()
        assert data["doctor_risk_class"] == "High Risk"
        cf = data.get("clinical_findings")
        if isinstance(cf, str):
            cf = json.loads(cf)
        assert cf["right"]["masses"] is True
        assert cf["right"]["birads_4_sub"] == "4C"
        assert cf["right"]["lymph_nodes_type"] == "malignant"

    def test_update_existing_assessment(self, client, seed_hospital_and_user):
        """Submit assessment then update it — should modify, not duplicate."""
        session_id = self._get_valid_session_id(client)
        token = get_token("Clinician", "doctor@test.com")

        base_data = {
            "patient_session_id": session_id,
            "questionnaire_feedback": "Initial feedback",
            "is_questionnaire_correct": "true",
            "mammo_birads": "1",
            "mammo_density": "A",
            "us_biopsy_birads": "",
            "us_biopsy_density": "",
            "precision_diagnosis": "",
            "datapoint_feedback": "",
            "clinical_findings": "{}",
            "recommendation_followup": "Initial recommendation",
            "routine_views_uploaded": "false",
            "doctor_risk_class": "Baseline Risk",
            "doctor_case_notes": "Initial notes",
        }

        # First submission
        res1 = client.post("/api/v1/patient/assessment", data=base_data,
                           headers={"Authorization": f"Bearer {token}"})
        assert res1.status_code == 200
        assessment_id = res1.json()["id"]

        # Update
        base_data["recommendation_followup"] = "Updated recommendation"
        base_data["doctor_risk_class"] = "Evident Risk"
        base_data["doctor_case_notes"] = "Updated notes after review"

        res2 = client.post("/api/v1/patient/assessment", data=base_data,
                           headers={"Authorization": f"Bearer {token}"})
        assert res2.status_code == 200
        assert res2.json()["id"] == assessment_id
        assert res2.json()["recommendation_followup"] == "Updated recommendation"
        assert res2.json()["doctor_risk_class"] == "Evident Risk"

    def test_assessment_invalid_session(self, client, seed_hospital_and_user):
        """Submit assessment for a non-existent session — should fail."""
        token = get_token("Clinician", "doctor@test.com")

        res = client.post("/api/v1/patient/assessment", data={
            "patient_session_id": "non-existent-uuid-12345",
            "is_questionnaire_correct": "false",
            "mammo_birads": "",
            "mammo_density": "",
            "us_biopsy_birads": "",
            "us_biopsy_density": "",
            "precision_diagnosis": "",
            "datapoint_feedback": "",
            "routine_views_uploaded": "false",
        }, headers={"Authorization": f"Bearer {token}"})

        assert res.status_code in [404, 500]

    def test_assessment_no_auth(self, client):
        """Submit assessment without authentication — should fail."""
        res = client.post("/api/v1/patient/assessment", data={
            "patient_session_id": "any-session-id",
            "is_questionnaire_correct": "false",
            "mammo_birads": "",
            "mammo_density": "",
            "us_biopsy_birads": "",
            "us_biopsy_density": "",
            "precision_diagnosis": "",
            "datapoint_feedback": "",
            "routine_views_uploaded": "false",
        })
        assert res.status_code == 401

    def test_assessment_clinical_findings_persisted(self, client, seed_hospital_and_user):
        """Verify clinical_findings JSON is correctly stored and returned."""
        session_id = self._get_valid_session_id(client)
        token = get_token("Clinician", "doctor@test.com")

        findings = {
            "right": {
                "masses": True,
                "mass_location": "Central",
                "mass_description": "1.5cm oval well-circumscribed",
                "calcification": False,
                "skin_thickening": False,
                "nipple_retraction": False,
                "lymph_nodes": True,
                "lymph_nodes_type": "indeterminate",
                "architectural_distortion": False,
                "focal_asymmetry": True,
                "asymmetry": False,
                "birads": "3",
                "density": "C",
                "comments": "Probably benign, 6-month follow-up"
            },
            "left": {
                "masses": False,
                "calcification": True,
                "calcification_type": "benign",
                "skin_thickening": False,
                "nipple_retraction": False,
                "lymph_nodes": False,
                "architectural_distortion": False,
                "focal_asymmetry": False,
                "asymmetry": True,
                "birads": "2",
                "density": "B",
                "comments": "Benign calcifications noted"
            }
        }

        res = client.post("/api/v1/patient/assessment", data={
            "patient_session_id": session_id,
            "is_questionnaire_correct": "true",
            "mammo_birads": "3",
            "mammo_density": "C",
            "us_biopsy_birads": "",
            "us_biopsy_density": "",
            "precision_diagnosis": "",
            "datapoint_feedback": "",
            "clinical_findings": json.dumps(findings),
            "recommendation_followup": "6-month follow-up mammogram",
            "routine_views_uploaded": "true",
            "doctor_risk_class": "Significant Risk",
            "doctor_case_notes": "Right breast probably benign mass with indeterminate lymph nodes",
        }, headers={"Authorization": f"Bearer {token}"})

        assert res.status_code == 200
        data = res.json()
        cf = data.get("clinical_findings")
        if isinstance(cf, str):
            cf = json.loads(cf)

        assert cf["right"]["masses"] is True
        assert cf["right"]["mass_location"] == "Central"
        assert cf["right"]["lymph_nodes_type"] == "indeterminate"
        assert cf["right"]["focal_asymmetry"] is True
        assert cf["left"]["calcification"] is True
        assert cf["left"]["calcification_type"] == "benign"
        assert cf["left"]["asymmetry"] is True


class TestUploadUrlGeneration:
    """Test the signed URL generation endpoint."""

    def test_generate_upload_url(self, client, seed_hospital_and_user):
        """Generate a signed URL for file upload."""
        token = get_token("Clinician", "doctor@test.com")

        res = client.post("/api/v1/patient/upload-url", data={
            "file_type": "mammo_cc_left",
            "file_name": "test_dicom.dcm",
            "session_id": "test-session-123",
        }, headers={"Authorization": f"Bearer {token}"})

        assert res.status_code == 200
        data = res.json()
        assert "upload_url" in data
        assert "gcs_url" in data
        assert "blob_path" in data
        assert "mammogram" in data["blob_path"]
        assert "mammo_cc_left" in data["blob_path"]

    def test_upload_url_no_auth(self, client):
        """Generating upload URL without auth should fail."""
        res = client.post("/api/v1/patient/upload-url", data={
            "file_type": "mammo_cc_left",
            "file_name": "test.dcm",
            "session_id": "test-session",
        })
        assert res.status_code == 401

    def test_record_upload_complete(self, client, seed_hospital_and_user):
        """Record a completed upload in the attachments table."""
        session_id = self._create_session(client)
        token = get_token("Clinician", "doctor@test.com")

        res = client.post("/api/v1/patient/upload-complete", data={
            "session_id": session_id,
            "file_type": "mammo_cc_left",
            "file_name": "cc_left_scan.dcm",
            "gcs_url": "gs://test-bucket/test-path/cc_left_scan.dcm",
            "mime_type": "application/dicom",
        }, headers={"Authorization": f"Bearer {token}"})

        assert res.status_code == 200
        assert res.json()["success"] is True

    def _create_session(self, client):
        res = client.post("/api/session/start")
        return res.json()["sessionId"]
