"""Tests for admin UI endpoints: hospital management, user management, role-based access."""
import pytest
from .conftest import get_token, create_case, add_attachment, TestSession


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


class TestMammoTechAssignment:
    def test_create_mammo_tech_assigns_cases(self, client, seed_hospital_and_user):
        session_id, _ = create_case()
        admin_token = get_token("Admin", "admin@test.com")
        res = client.post("/api/v1/qc/admin/users", json={
            "full_name": "MT One", "email": "mt1@test.com", "password": "password123",
            "role": "Mammo Tech", "cases": [session_id],
        }, headers={"Authorization": f"Bearer {admin_token}"})
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["role"] == "Mammo Tech"
        assert data["assigned_cases"] == 1
        assert data["failed_cases"] == []

    def test_mammo_tech_and_radiologist_assignments_are_independent(self, client, seed_hospital_and_user):
        """Regression test for the "last assignment wins" filter added to
        _all_subjects_with_status: a Mammo Tech assignment and a Radiologist
        assignment on the same subject must not clobber each other's view."""
        session_id, _ = create_case()
        admin_token = get_token("Admin", "admin@test.com")
        headers = {"Authorization": f"Bearer {admin_token}"}

        res = client.post("/api/v1/qc/admin/users", json={
            "full_name": "MT Two", "email": "mt2@test.com", "password": "password123",
            "role": "Mammo Tech", "cases": [session_id],
        }, headers=headers)
        assert res.status_code == 200, res.text

        radiologists = client.get("/api/v1/qc/admin/radiologists", headers=headers).json()
        radiologist_id = next(r["id"] for r in radiologists if r["email"] == "radiologist@test.com")
        res = client.post("/api/v1/qc/admin/assign-radiologist", json={
            "radiologist_id": radiologist_id, "subject_ids": [session_id],
        }, headers=headers)
        assert res.status_code == 200
        assert res.json()["assigned_count"] == 1

        radiologist_view = client.get("/api/v1/qc/admin/subjects", headers=headers).json()
        subject = next(s for s in radiologist_view if s["qc_subject_id"] == session_id)
        assert subject["assignment_status"] == "Pending"
        assert subject["radiologist_email"] == "radiologist@test.com"

        mammo_view = client.get("/api/v1/qc/admin/subjects?for_role=mammo_tech", headers=headers).json()
        subject = next(s for s in mammo_view if s["qc_subject_id"] == session_id)
        assert subject["assignment_status"] == "Pending"
        assert subject["radiologist_email"] == "mt2@test.com"


class TestAssignMammoTech:
    def test_lists_only_mammo_techs(self, client, seed_hospital_and_user):
        admin_token = get_token("Admin", "admin@test.com")
        headers = {"Authorization": f"Bearer {admin_token}"}
        client.post("/api/v1/qc/admin/users", json={
            "full_name": "MT Listed", "email": "mt_listed@test.com", "password": "password123",
            "role": "Mammo Tech",
        }, headers=headers)

        mammo_techs = client.get("/api/v1/qc/admin/mammo-techs", headers=headers).json()
        emails = [m["email"] for m in mammo_techs]
        assert "mt_listed@test.com" in emails
        assert "radiologist@test.com" not in emails

    def test_assign_existing_mammo_tech_to_cases(self, client, seed_hospital_and_user):
        session_id, _ = create_case()
        admin_token = get_token("Admin", "admin@test.com")
        headers = {"Authorization": f"Bearer {admin_token}"}

        res = client.post("/api/v1/qc/admin/users", json={
            "full_name": "MT Assignable", "email": "mt_assignable@test.com", "password": "password123",
            "role": "Mammo Tech",
        }, headers=headers)
        assert res.status_code == 200
        mammo_tech_id = res.json()["id"]

        res = client.post("/api/v1/qc/admin/assign-mammo-tech", json={
            "mammo_tech_id": mammo_tech_id, "subject_ids": [session_id],
        }, headers=headers)
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["assigned_count"] == 1

        mammo_view = client.get("/api/v1/qc/admin/subjects?for_role=mammo_tech", headers=headers).json()
        subject = next(s for s in mammo_view if s["qc_subject_id"] == session_id)
        assert subject["assignment_status"] == "Pending"
        assert subject["radiologist_email"] == "mt_assignable@test.com"

    def test_assignment_row_carries_both_mammo_tech_and_radiologist_ids(self, client, seed_hospital_and_user):
        """qc_mammo_tech_id lets a single qc_assignments row show both the
        Mammo Tech and the Radiologist involved with a case, instead of
        requiring a join across the two role-tagged rows."""
        from backend.src.models.models import Assignment, DoctorAssessment

        session_id, case_id = create_case()
        add_attachment(case_id, "mammo_cc_left")
        admin_token = get_token("Admin", "admin@test.com")
        headers = {"Authorization": f"Bearer {admin_token}"}

        res = client.post("/api/v1/qc/admin/users", json={
            "full_name": "MT Cols", "email": "mt_cols@test.com", "password": "password123",
            "role": "Mammo Tech", "cases": [session_id],
        }, headers=headers)
        assert res.status_code == 200
        mammo_tech_id = res.json()["id"]

        db = TestSession()
        try:
            mt_assignment = db.query(Assignment).filter(
                Assignment.qc_assessment_id == case_id, Assignment.qc_mammo_tech_id.isnot(None)
            ).first()
            assert mt_assignment.qc_mammo_tech_id == mammo_tech_id
        finally:
            db.close()

        token = get_token("Mammo Tech", "mt_cols@test.com")
        res = client.post(f"/api/v1/qc/mammo-tech/cases/{case_id}/review",
                           json={"confirmation": "yes"}, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assigned_radiologist_id = res.json()["assigned_radiologist_id"]

        db = TestSession()
        try:
            rad_assignment = db.query(Assignment).filter(
                Assignment.qc_assessment_id == case_id, Assignment.qc_radiologist_id == assigned_radiologist_id
            ).first()
            assert rad_assignment.qc_mammo_tech_id == mammo_tech_id
            assert rad_assignment.qc_radiologist_id == assigned_radiologist_id
        finally:
            db.close()

        assignments = client.get("/api/v1/qc/admin/assignments", headers=headers).json()
        rad_row = next(a for a in assignments if a["assessment_id"] == case_id and a["radiologist_id"] == assigned_radiologist_id)
        assert rad_row["mammo_tech_id"] == mammo_tech_id
        assert rad_row["mammo_tech_name"] == "MT Cols"
        assert rad_row["assigned_at"] is not None

        mt_history = client.get("/api/v1/qc/admin/assignments?for_role=mammo_tech", headers=headers).json()
        mt_row = next(a for a in mt_history if a["assessment_id"] == case_id)
        assert mt_row["mammo_tech_name"] == "MT Cols"
        assert mt_row["assigned_at"] is not None

    def test_assign_mammo_tech_rejects_radiologist_id(self, client, seed_hospital_and_user):
        session_id, _ = create_case()
        admin_token = get_token("Admin", "admin@test.com")
        headers = {"Authorization": f"Bearer {admin_token}"}

        radiologists = client.get("/api/v1/qc/admin/radiologists", headers=headers).json()
        radiologist_id = next(r["id"] for r in radiologists if r["email"] == "radiologist@test.com")

        res = client.post("/api/v1/qc/admin/assign-mammo-tech", json={
            "mammo_tech_id": radiologist_id, "subject_ids": [session_id],
        }, headers=headers)
        assert res.status_code == 400
