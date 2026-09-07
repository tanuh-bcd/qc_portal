"""Tests for admin UI endpoints: hospital management, user management, role-based access."""
import pytest
from .conftest import get_token, create_case


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
