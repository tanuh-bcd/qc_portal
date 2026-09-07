"""Tests for admin UI endpoints: hospital management, user management, role-based access."""
import pytest
from .conftest import get_token, TestSession
from backend.src.models.models import DoctorAssessment, User


class TestAdminAccess:
    def test_admin_endpoint_no_auth(self, client):
        res = client.get("/api/v1/qc/admin/roles")
        assert res.status_code == 401

    def test_admin_endpoint_radiologist_role(self, client, seed_hospital_and_user):
        token = get_token("Radiologist", "radiologist@test.com")
        res = client.get("/api/v1/qc/admin/roles", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 403

    def test_admin_endpoint_admin_role(self, client, seed_hospital_and_user):
        token = get_token("Admin", "admin@test.com")
        res = client.get("/api/v1/qc/admin/roles", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200


class TestAdminRoles:
    def test_list_roles(self, client, seed_hospital_and_user):
        token = get_token("Admin", "admin@test.com")
        res = client.get("/api/v1/qc/admin/roles", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        roles = res.json()
        assert isinstance(roles, list)
        role_names = [r["qc_name"] for r in roles]
        assert "Admin" in role_names
        assert "Radiologist" in role_names
        assert "Mammo Tech" in role_names


def _make_assessment(session_id, hospital_id="clinic_00001"):
    db = TestSession()
    doctor = db.query(User).filter(User.qc_email == "radiologist@test.com").first()
    assessment = DoctorAssessment(
        qc_patient_session_id=session_id,
        qc_hospital_id=hospital_id,
        qc_doctor_id=doctor.qc_id,
        qc_mammo_birads="2",
        qc_mammo_density="B",
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)
    assessment_id = assessment.qc_id
    db.close()
    return assessment_id


class TestMammoTechAssignment:
    def test_mammotechs_endpoint_lists_active_mammo_techs(self, client, seed_hospital_and_user):
        token = get_token("Admin", "admin@test.com")
        res = client.get("/api/v1/qc/admin/mammotechs", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        emails = [m["email"] for m in res.json()]
        assert "mammotech@test.com" in emails

    def test_assign_mammotech_and_subject_filters(self, client, seed_hospital_and_user):
        admin_token = get_token("Admin", "admin@test.com")
        headers = {"Authorization": f"Bearer {admin_token}"}

        assessment_id = _make_assessment("session_mt_1")
        mammo_tech = next(m for m in client.get("/api/v1/qc/admin/mammotechs", headers=headers).json() if m["email"] == "mammotech@test.com")

        subjects = client.get("/api/v1/qc/admin/subjects?for_role=mammotech", headers=headers).json()
        subject_ids = [s["qc_subject_id"] for s in subjects if s["assessment_id"] == assessment_id]
        assert len(subject_ids) == 1
        subject_id = subject_ids[0]

        res = client.post(
            "/api/v1/qc/admin/assign-mammotech",
            json={"mammo_tech_id": mammo_tech["id"], "subject_ids": [subject_id]},
            headers=headers,
        )
        assert res.status_code == 200
        assert res.json()["assigned_count"] == 1

        # Now assigned, so it drops out of the Mammo Tech eligible pool.
        subjects = client.get("/api/v1/qc/admin/subjects?for_role=mammotech", headers=headers).json()
        assert assessment_id not in [s["assessment_id"] for s in subjects]

        # Not yet Mammo-Tech-Accepted, so it's not in the Radiologist eligible pool either.
        subjects = client.get("/api/v1/qc/admin/subjects?for_role=radiologist", headers=headers).json()
        assert assessment_id not in [s["assessment_id"] for s in subjects]

    def test_assign_radiologist_blocked_until_mammo_tech_accepted(self, client, seed_hospital_and_user):
        admin_token = get_token("Admin", "admin@test.com")
        headers = {"Authorization": f"Bearer {admin_token}"}

        assessment_id = _make_assessment("session_mt_2")
        mammo_tech = next(m for m in client.get("/api/v1/qc/admin/mammotechs", headers=headers).json() if m["email"] == "mammotech@test.com")
        subjects = {s["assessment_id"]: s for s in client.get("/api/v1/qc/admin/subjects", headers=headers).json()}
        subject_id = subjects[assessment_id]["qc_subject_id"]

        radiologist = client.post(
            "/api/v1/qc/admin/users",
            json={"full_name": "Dr. New", "email": "newrad@test.com", "password": "pw12345", "role": "Radiologist"},
            headers=headers,
        ).json()

        res = client.post(
            "/api/v1/qc/admin/assign-radiologist",
            json={"radiologist_id": radiologist["id"], "subject_ids": [subject_id]},
            headers=headers,
        )
        assert res.status_code == 200
        body = res.json()
        assert body["assigned_count"] == 0
        assert subject_id in body["not_mammo_tech_accepted_subject_ids"]

        # Mammo Tech accepts the case.
        client.post(
            "/api/v1/qc/admin/assign-mammotech",
            json={"mammo_tech_id": mammo_tech["id"], "subject_ids": [subject_id]},
            headers=headers,
        )
        mt_token = get_token("Mammo Tech", mammo_tech["email"])
        review_res = client.post(
            f"/api/v1/qc/mammotech/cases/{assessment_id}/review",
            json={"quality_accepted": True},
            headers={"Authorization": f"Bearer {mt_token}"},
        )
        assert review_res.status_code == 200
        assert review_res.json()["status"] == "Accepted"

        # Now the Radiologist assignment succeeds.
        res = client.post(
            "/api/v1/qc/admin/assign-radiologist",
            json={"radiologist_id": radiologist["id"], "subject_ids": [subject_id]},
            headers=headers,
        )
        assert res.status_code == 200
        assert res.json()["assigned_count"] == 1
        assert res.json()["not_mammo_tech_accepted_subject_ids"] == []
