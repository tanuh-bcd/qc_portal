"""Tests for the Radiologist two-stage Left/Right breast annotation review."""
from .conftest import get_token, TestSession
from backend.src.models.models import DoctorAssessment, User


def _make_assigned_case(client, admin_headers, suffix):
    db = TestSession()
    doctor = db.query(User).filter(User.qc_email == "radiologist@test.com").first()
    assessment = DoctorAssessment(
        qc_patient_session_id=f"session_rad_review_{suffix}",
        qc_hospital_id="clinic_00001",
        qc_doctor_id=doctor.qc_id,
        qc_mammo_birads="2",
        qc_mammo_density="B",
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)
    assessment_id = assessment.qc_id
    db.close()

    subjects = {s["assessment_id"]: s for s in client.get("/api/v1/qc/admin/subjects", headers=admin_headers).json()}
    subject_id = subjects[assessment_id]["qc_subject_id"]

    mammo_tech = next(m for m in client.get("/api/v1/qc/admin/mammotechs", headers=admin_headers).json() if m["email"] == "mammotech@test.com")
    client.post(
        "/api/v1/qc/admin/assign-mammotech",
        json={"mammo_tech_id": mammo_tech["id"], "subject_ids": [subject_id]},
        headers=admin_headers,
    )
    mt_headers = {"Authorization": f"Bearer {get_token('Mammo Tech', mammo_tech['email'])}"}
    client.post(
        f"/api/v1/qc/mammotech/cases/{assessment_id}/review",
        json={"quality_accepted": True},
        headers=mt_headers,
    )

    radiologist_email = f"reviewrad_{suffix}@test.com"
    radiologist = client.post(
        "/api/v1/qc/admin/users",
        json={"full_name": "Dr. Review", "email": radiologist_email, "password": "pw12345", "role": "Radiologist"},
        headers=admin_headers,
    ).json()
    client.post(
        "/api/v1/qc/admin/assign-radiologist",
        json={"radiologist_id": radiologist["id"], "subject_ids": [subject_id]},
        headers=admin_headers,
    )
    return assessment_id, radiologist["email"]


class TestRadiologistBreastReview:
    def test_left_rejected_requires_comment(self, client, seed_hospital_and_user):
        admin_headers = {"Authorization": f"Bearer {get_token('Admin', 'admin@test.com')}"}
        assessment_id, rad_email = _make_assigned_case(client, admin_headers, "left_comment")
        rad_headers = {"Authorization": f"Bearer {get_token('Radiologist', rad_email)}"}

        res = client.post(
            f"/api/v1/qc/radiologist/cases/{assessment_id}/review-left",
            json={"accepted": False},
            headers=rad_headers,
        )
        assert res.status_code == 422

        res = client.post(
            f"/api/v1/qc/radiologist/cases/{assessment_id}/review-left",
            json={"accepted": False, "comment": "Blurry left CC view"},
            headers=rad_headers,
        )
        assert res.status_code == 200
        assert res.json()["status"] == "In-Progress"

    def test_right_requires_left_accepted_first(self, client, seed_hospital_and_user):
        admin_headers = {"Authorization": f"Bearer {get_token('Admin', 'admin@test.com')}"}
        assessment_id, rad_email = _make_assigned_case(client, admin_headers, "right_first")
        rad_headers = {"Authorization": f"Bearer {get_token('Radiologist', rad_email)}"}

        res = client.post(
            f"/api/v1/qc/radiologist/cases/{assessment_id}/review-right",
            json={"accepted": True},
            headers=rad_headers,
        )
        assert res.status_code == 400

    def test_full_accept_path_completes_case(self, client, seed_hospital_and_user):
        admin_headers = {"Authorization": f"Bearer {get_token('Admin', 'admin@test.com')}"}
        assessment_id, rad_email = _make_assigned_case(client, admin_headers, "full_accept")
        rad_headers = {"Authorization": f"Bearer {get_token('Radiologist', rad_email)}"}

        res = client.post(
            f"/api/v1/qc/radiologist/cases/{assessment_id}/review-left",
            json={"accepted": True},
            headers=rad_headers,
        )
        assert res.status_code == 200
        assert res.json()["status"] == "In-Progress"

        res = client.post(
            f"/api/v1/qc/radiologist/cases/{assessment_id}/review-right",
            json={"accepted": True},
            headers=rad_headers,
        )
        assert res.status_code == 200
        assert res.json()["status"] == "Completed"

    def test_right_rejected_requires_comment_and_stays_in_progress(self, client, seed_hospital_and_user):
        admin_headers = {"Authorization": f"Bearer {get_token('Admin', 'admin@test.com')}"}
        assessment_id, rad_email = _make_assigned_case(client, admin_headers, "right_comment")
        rad_headers = {"Authorization": f"Bearer {get_token('Radiologist', rad_email)}"}

        client.post(
            f"/api/v1/qc/radiologist/cases/{assessment_id}/review-left",
            json={"accepted": True},
            headers=rad_headers,
        )
        res = client.post(
            f"/api/v1/qc/radiologist/cases/{assessment_id}/review-right",
            json={"accepted": False},
            headers=rad_headers,
        )
        assert res.status_code == 422

        res = client.post(
            f"/api/v1/qc/radiologist/cases/{assessment_id}/review-right",
            json={"accepted": False, "comment": "Missing MLO view"},
            headers=rad_headers,
        )
        assert res.status_code == 200
        assert res.json()["status"] == "In-Progress"
