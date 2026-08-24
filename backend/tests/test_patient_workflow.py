"""Tests for the patient/session endpoints (consent, questionnaire, assessment,
doctor sessions). Formerly test_clinician.py — renamed because none of these
endpoints (see backend/src/api/patient.py and backend/src/api/doctor.py) actually
enforce a specific role; they only require an authenticated user via
get_current_user. The old test names/tokens ("Doctor"/"Staff") were leftovers
from a role model that no longer exists (roles are now just Admin/Radiologist),
so all tokens below use Radiologist — any authenticated role would pass these
same assertions.
"""
import pytest
import io
from .conftest import get_token


class TestDoctorSessions:
    def test_list_sessions_empty(self, client, seed_hospital_and_user):
        token = get_token("Radiologist", "radiologist@test.com")
        res = client.get("/api/v1/qc/doctor/sessions", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert isinstance(res.json(), list)

    def test_list_sessions_unauthorized(self, client):
        res = client.get("/api/v1/qc/doctor/sessions")
        assert res.status_code == 401

    def test_session_detail_not_found(self, client, seed_hospital_and_user):
        token = get_token("Radiologist", "radiologist@test.com")
        res = client.get("/api/v1/qc/doctor/sessions/99999", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 404


class TestPatientConsent:
    def test_consent_without_file(self, client, seed_hospital_and_user):
        token = get_token("Radiologist", "radiologist@test.com")
        res = client.post(
            "/api/v1/qc/patient/consent",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert res.status_code == 200
        data = res.json()
        assert "id" in data

    def test_consent_unauthorized(self, client):
        res = client.post("/api/v1/qc/patient/consent")
        assert res.status_code == 401


class TestAssessment:
    def _create_session(self, client, token):
        res = client.post("/api/v1/qc/patient/consent", headers={"Authorization": f"Bearer {token}"})
        return res.json()["id"]

    def test_create_assessment_basic(self, client, seed_hospital_and_user):
        token = get_token("Radiologist", "radiologist@test.com")
        session_id = self._create_session(client, token)

        res = client.post("/api/v1/qc/patient/assessment", data={
            "patient_session_id": session_id,
            "questionnaire_feedback": "Looks good",
            "is_questionnaire_correct": "true",
            "mammo_birads": "2",
            "mammo_density": "B",
            "us_biopsy_birads": "",
            "us_biopsy_density": "",
            "precision_diagnosis": "",
            "datapoint_feedback": "",
            "clinical_findings": '{"right": {"masses": false, "birads": "2", "density": "B"}, "left": {"masses": false, "birads": "1", "density": "A"}}',
            "recommendation_followup": "Routine screening in 1 year",
            "routine_views_uploaded": "true",
        }, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200

    def test_assessment_missing_session(self, client, seed_hospital_and_user):
        token = get_token("Radiologist", "radiologist@test.com")
        res = client.post("/api/v1/qc/patient/assessment", data={
            "patient_session_id": 99999,
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

    def test_assessment_unauthorized(self, client):
        res = client.post("/api/v1/qc/patient/assessment", data={
            "patient_session_id": 1,
            "is_questionnaire_correct": "false",
        })
        assert res.status_code == 401


class TestQuestionnaireSubmission:
    def test_submit_responses(self, client, seed_hospital_and_user):
        token = get_token("Radiologist", "radiologist@test.com")
        session_id = self._create_session(client, token)

        res = client.post("/api/v1/qc/patient/questionnaire", json={
            "session_id": session_id,
            "responses": [
                {"qc_question": "What is your age?", "qc_answer": "45"},
                {"qc_question": "Family history?", "qc_answer": "No"}
            ]
        }, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert res.json()["status"] == "success"

    def _create_session(self, client, token):
        res = client.post("/api/v1/qc/patient/consent", headers={"Authorization": f"Bearer {token}"})
        return res.json()["id"]
