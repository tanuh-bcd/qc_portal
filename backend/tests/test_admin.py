"""Tests for admin UI endpoints: hospital management, user management, role-based access."""
import pytest
from .conftest import get_token


class TestAdminAccess:
    def test_admin_endpoint_no_auth(self, client):
        res = client.get("/api/v1/admin/roles")
        assert res.status_code == 401

    def test_admin_endpoint_doctor_role(self, client, seed_hospital_and_user):
        token = get_token("Doctor", "doctor@test.com")
        res = client.get("/api/v1/admin/roles", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 403

    def test_admin_endpoint_staff_role(self, client, seed_hospital_and_user):
        token = get_token("Staff", "staff@test.com")
        res = client.get("/api/v1/admin/roles", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 403

    def test_admin_endpoint_admin_role(self, client, seed_hospital_and_user):
        token = get_token("Admin", "admin@test.com")
        res = client.get("/api/v1/admin/roles", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200


class TestAdminRoles:
    def test_list_roles(self, client, seed_hospital_and_user):
        token = get_token("Admin", "admin@test.com")
        res = client.get("/api/v1/admin/roles", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        roles = res.json()
        assert isinstance(roles, list)
        role_names = [r["name"] for r in roles]
        assert "Admin" in role_names
        assert "Doctor" in role_names
        assert "Staff" in role_names
