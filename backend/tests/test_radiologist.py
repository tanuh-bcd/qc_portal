import pytest
from .conftest import get_token, create_case, add_attachment, assign_case, TestSession


class TestCompleteCaseAccess:
    def test_no_auth(self, client):
        res = client.post("/api/v1/qc/radiologist/cases/1/complete", json={"grade": "Best"})
        assert res.status_code == 401

    def test_not_assigned_to_this_radiologist(self, client, seed_hospital_and_user):
        session_id, case_id = create_case()
        add_attachment(case_id, "mammo_cc_left")
        assign_case(case_id, "radiologist@test.com")

        admin_token = get_token("Admin", "admin@test.com")
        client.post("/api/v1/qc/admin/users", json={
            "full_name": "Dr. Other", "email": "radiologist2@test.com", "password": "password123",
            "role": "Radiologist",
        }, headers={"Authorization": f"Bearer {admin_token}"})
        other_token = get_token("Radiologist", "radiologist2@test.com")

        res = client.post(
            f"/api/v1/qc/radiologist/cases/{case_id}/complete",
            json={"grade": "Best"},
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert res.status_code == 404


class TestCompleteCaseGrading:
    def test_missing_reason_on_bad_grade_rejected(self, client, seed_hospital_and_user):
        session_id, case_id = create_case()
        add_attachment(case_id, "mammo_cc_left")
        assign_case(case_id, "radiologist@test.com")
        token = get_token("Radiologist", "radiologist@test.com")
        headers = {"Authorization": f"Bearer {token}"}

        res = client.post(f"/api/v1/qc/radiologist/cases/{case_id}/complete",
                           json={"grade": "Bad"}, headers=headers)
        assert res.status_code == 422

        res = client.post(f"/api/v1/qc/radiologist/cases/{case_id}/complete",
                           json={"grade": "Not a Mammogram"}, headers=headers)
        assert res.status_code == 422

    def test_blocked_with_zero_images(self, client, seed_hospital_and_user):
        session_id, case_id = create_case()
        assign_case(case_id, "radiologist@test.com")
        token = get_token("Radiologist", "radiologist@test.com")

        res = client.post(f"/api/v1/qc/radiologist/cases/{case_id}/complete",
                           json={"grade": "Best"}, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 400

    def test_good_grade_completes_case(self, client, seed_hospital_and_user):
        session_id, case_id = create_case()
        add_attachment(case_id, "mammo_cc_left")
        add_attachment(case_id, "mammo_reading")
        assign_case(case_id, "radiologist@test.com")
        token = get_token("Radiologist", "radiologist@test.com")

        res = client.post(f"/api/v1/qc/radiologist/cases/{case_id}/complete",
                           json={"grade": "Good"}, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "Completed"

    def test_bad_grade_with_reason_completes_case(self, client, seed_hospital_and_user):
        session_id, case_id = create_case()
        add_attachment(case_id, "mammo_cc_left")
        assign_case(case_id, "radiologist@test.com")
        token = get_token("Radiologist", "radiologist@test.com")

        res = client.post(f"/api/v1/qc/radiologist/cases/{case_id}/complete",
                           json={"grade": "Bad", "reason": "Poor contrast throughout"},
                           headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert res.json()["status"] == "Completed"

    def test_cannot_complete_twice(self, client, seed_hospital_and_user):
        session_id, case_id = create_case()
        add_attachment(case_id, "mammo_cc_left")
        assign_case(case_id, "radiologist@test.com")
        token = get_token("Radiologist", "radiologist@test.com")
        headers = {"Authorization": f"Bearer {token}"}

        res = client.post(f"/api/v1/qc/radiologist/cases/{case_id}/complete",
                           json={"grade": "Best"}, headers=headers)
        assert res.status_code == 200

        res = client.post(f"/api/v1/qc/radiologist/cases/{case_id}/complete",
                           json={"grade": "Good"}, headers=headers)
        assert res.status_code == 400

    def test_clinical_findings_merge_preserves_existing_keys(self, client, seed_hospital_and_user):
        session_id, case_id = create_case()
        add_attachment(case_id, "mammo_cc_left")
        assign_case(case_id, "radiologist@test.com")

        db = TestSession()
        try:
            from backend.src.models.models import DoctorAssessment
            assessment = db.query(DoctorAssessment).filter(DoctorAssessment.qc_id == case_id).first()
            assessment.qc_clinical_findings = {"left": {"masses": True}, "right": {}}
            db.commit()
        finally:
            db.close()

        token = get_token("Radiologist", "radiologist@test.com")
        res = client.post(
            f"/api/v1/qc/radiologist/cases/{case_id}/complete",
            json={"grade": "Best", "left": {"birads": "2"}},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200

        db = TestSession()
        try:
            from backend.src.models.models import DoctorAssessment
            assessment = db.query(DoctorAssessment).filter(DoctorAssessment.qc_id == case_id).first()
            cf = assessment.qc_clinical_findings
            assert cf["left"]["masses"] is True
            assert cf["left"]["birads"] == "2"
        finally:
            db.close()


def _fresh_radiologist(client, email):
    """Creates a brand-new Radiologist with no pre-existing assignments, since
    the test DB is session-scoped and shared across this whole module — reusing
    radiologist@test.com for "next assigned case" assertions would pick up
    Pending assignments left over from earlier tests."""
    admin_token = get_token("Admin", "admin@test.com")
    client.post("/api/v1/qc/admin/users", json={
        "full_name": "Dr. Fresh", "email": email, "password": "password123", "role": "Radiologist",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    return get_token("Radiologist", email)


class TestNextCase:
    def test_returns_next_case(self, client, seed_hospital_and_user):
        token = _fresh_radiologist(client, "radiologist_next1@test.com")
        headers = {"Authorization": f"Bearer {token}"}

        session_id1, case_id1 = create_case()
        add_attachment(case_id1, "mammo_cc_left")
        assign_case(case_id1, "radiologist_next1@test.com")

        session_id2, case_id2 = create_case()
        add_attachment(case_id2, "mammo_cc_left")
        assign_case(case_id2, "radiologist_next1@test.com")

        res = client.post(f"/api/v1/qc/radiologist/cases/{case_id1}/complete",
                           json={"grade": "Best"}, headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["next_case"] is not None
        assert data["next_case"]["case_id"] == case_id2

    def test_returns_null_next_case_when_none_remain(self, client, seed_hospital_and_user):
        token = _fresh_radiologist(client, "radiologist_next2@test.com")
        headers = {"Authorization": f"Bearer {token}"}

        session_id, case_id = create_case()
        add_attachment(case_id, "mammo_cc_left")
        assign_case(case_id, "radiologist_next2@test.com")

        res = client.post(f"/api/v1/qc/radiologist/cases/{case_id}/complete",
                           json={"grade": "Best"}, headers=headers)
        assert res.status_code == 200
        assert res.json()["next_case"] is None
