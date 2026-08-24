"""Tests for authentication endpoints: login, hospitals, token validation."""
import pytest
from .conftest import get_token


class TestGetHospitals:
    def test_returns_list(self, client, seed_hospital_and_user):
        res = client.get("/api/v1/auth/hospitals")
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["name"] == "TestHospital"


class TestLogin:
    def test_valid_admin_login(self, client, seed_hospital_and_user):
        res = client.post("/api/v1/auth/login", json={
            "hospital_name": "TestHospital",
            "role": "Admin",
            "email": "admin@test.com",
            "password": "password123"
        })
        assert res.status_code == 200
        data = res.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_valid_doctor_login(self, client, seed_hospital_and_user):
        res = client.post("/api/v1/auth/login", json={
            "hospital_name": "TestHospital",
            "role": "Doctor",
            "email": "doctor@test.com",
            "password": "password123"
        })
        assert res.status_code == 200
        assert "access_token" in res.json()

    def test_wrong_password(self, client, seed_hospital_and_user):
        res = client.post("/api/v1/auth/login", json={
            "hospital_name": "TestHospital",
            "role": "Admin",
            "email": "admin@test.com",
            "password": "wrongpassword"
        })
        assert res.status_code == 401

    def test_wrong_hospital(self, client, seed_hospital_and_user):
        res = client.post("/api/v1/auth/login", json={
            "hospital_name": "NonExistent",
            "role": "Admin",
            "email": "admin@test.com",
            "password": "password123"
        })
        assert res.status_code == 401

    def test_wrong_role(self, client, seed_hospital_and_user):
        res = client.post("/api/v1/auth/login", json={
            "hospital_name": "TestHospital",
            "role": "InvalidRole",
            "email": "admin@test.com",
            "password": "password123"
        })
        assert res.status_code == 401

    def test_missing_fields(self, client):
        res = client.post("/api/v1/auth/login", json={"email": "a@b.com"})
        assert res.status_code == 422


class TestTokenValidation:
    def test_protected_endpoint_no_token(self, client):
        res = client.get("/api/v1/doctor/sessions")
        assert res.status_code == 401

    def test_protected_endpoint_invalid_token(self, client):
        res = client.get("/api/v1/doctor/sessions", headers={"Authorization": "Bearer invalidtoken"})
        assert res.status_code == 401

    def test_protected_endpoint_valid_token(self, client, seed_hospital_and_user):
        token = get_token("Doctor", "doctor@test.com")
        res = client.get("/api/v1/doctor/sessions", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
