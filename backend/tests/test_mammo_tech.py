import pytest
from .conftest import get_token, create_case, add_attachment, TestSession


def _create_mammo_tech_with_case(client, session_id, email="newmammotech@test.com"):
    """Creates a fresh Mammo Tech (reusing the existing user-creation+assignment
    endpoint) with the given subject pre-assigned, and returns a bearer token for them."""
    admin_token = get_token("Admin", "admin@test.com")
    res = client.post("/api/v1/qc/admin/users", json={
        "full_name": "New Mammo Tech", "email": email, "password": "password123",
        "role": "Mammo Tech", "cases": [session_id],
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200, res.text
    assert res.json()["assigned_cases"] == 1
    return get_token("Mammo Tech", email)


class TestMammoTechAccess:
    def test_no_auth(self, client):
        res = client.get("/api/v1/qc/mammo-tech/cases")
        assert res.status_code == 401

    def test_wrong_role(self, client, seed_hospital_and_user):
        token = get_token("Radiologist", "radiologist@test.com")
        res = client.get("/api/v1/qc/mammo-tech/cases", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 403

    def test_mammo_tech_role_allowed(self, client, seed_hospital_and_user):
        token = get_token("Mammo Tech", "mammotech@test.com")
        res = client.get("/api/v1/qc/mammo-tech/cases", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert res.json()["cases"] == []


class TestMammoTechCases:
    def test_get_cases_returns_only_own_assignments(self, client, seed_hospital_and_user):
        session_id, case_id = create_case()
        token = _create_mammo_tech_with_case(client, session_id, "mt_cases@test.com")

        res = client.get("/api/v1/qc/mammo-tech/cases", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        cases = res.json()["cases"]
        assert len(cases) == 1
        assert cases[0]["case_id"] == case_id
        assert cases[0]["status"] == "Pending"

        other_token = get_token("Mammo Tech", "mammotech@test.com")
        res = client.get("/api/v1/qc/mammo-tech/cases", headers={"Authorization": f"Bearer {other_token}"})
        assert res.json()["cases"] == []


class TestMammoTechReview:
    def test_no_auth(self, client):
        res = client.post("/api/v1/qc/mammo-tech/cases/1/review", json={"confirmation": "yes"})
        assert res.status_code == 401

    def test_blocked_with_zero_images(self, client, seed_hospital_and_user):
        session_id, case_id = create_case()
        token = _create_mammo_tech_with_case(client, session_id, "mt_empty@test.com")

        res = client.post(f"/api/v1/qc/mammo-tech/cases/{case_id}/review",
                           json={"confirmation": "yes"}, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 400

    def test_review_no_rejects_and_leaves_radiologist_untouched(self, client, seed_hospital_and_user):
        session_id, case_id = create_case()
        add_attachment(case_id, "mammo_cc_left")
        token = _create_mammo_tech_with_case(client, session_id, "mt_no@test.com")

        res = client.post(
            f"/api/v1/qc/mammo-tech/cases/{case_id}/review",
            json={"confirmation": "no"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "Rejected"
        assert data["assigned_radiologist_id"] is None
        assert data["assigned_to"] is not None

        admin_token = get_token("Admin", "admin@test.com")
        radiologist_view = client.get(
            "/api/v1/qc/admin/subjects", headers={"Authorization": f"Bearer {admin_token}"}
        ).json()
        subject = next(s for s in radiologist_view if s["qc_subject_id"] == session_id)
        assert subject["assignment_status"] == "Unassigned"

    def test_review_yes_assigns_random_radiologist(self, client, seed_hospital_and_user):
        session_id, case_id = create_case()
        add_attachment(case_id, "mammo_cc_left")
        add_attachment(case_id, "mammo_reading")
        token = _create_mammo_tech_with_case(client, session_id, "mt_yes@test.com")

        res = client.post(
            f"/api/v1/qc/mammo-tech/cases/{case_id}/review",
            json={"confirmation": "yes", "left": {"birads": "1"}},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "In-Progress"
        assert data["assigned_radiologist_id"] is not None
        assert data["assigned_radiologist_name"] == "Dr. Radiologist"

        radiologist_token = get_token("Radiologist", "radiologist@test.com")
        res = client.get(
            "/api/v1/qc/radiologist/cases", headers={"Authorization": f"Bearer {radiologist_token}"}
        )
        cases = res.json()["cases"]
        assert any(c["case_id"] == case_id and c["status"] == "Pending" for c in cases)

        mt_cases = client.get(
            "/api/v1/qc/mammo-tech/cases", headers={"Authorization": f"Bearer {token}"}
        ).json()["cases"]
        mt_case = next(c for c in mt_cases if c["case_id"] == case_id)
        assert mt_case["assigned_radiologist_id"] == data["assigned_radiologist_id"]
        assert mt_case["assigned_radiologist_name"] == "Dr. Radiologist"

        db = TestSession()
        try:
            from backend.src.models.models import DoctorAssessment
            assessment = db.query(DoctorAssessment).filter(DoctorAssessment.qc_id == case_id).first()
            assert assessment.qc_clinical_findings["left"]["birads"] == "1"
        finally:
            db.close()

    def test_review_yes_with_no_radiologists_available_keeps_case_pending(self, client, seed_hospital_and_user):
        from backend.src.models.models import User, Role

        db = TestSession()
        try:
            role = db.query(Role).filter(Role.qc_name == "Radiologist").first()
            db.query(User).filter(User.qc_role_id == role.qc_id).update({"qc_is_active": False})
            db.commit()
        finally:
            db.close()

        try:
            session_id, case_id = create_case()
            add_attachment(case_id, "mammo_cc_left")
            token = _create_mammo_tech_with_case(client, session_id, "mt_norad@test.com")

            res = client.post(
                f"/api/v1/qc/mammo-tech/cases/{case_id}/review",
                json={"confirmation": "yes"},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 409

            res = client.get(
                "/api/v1/qc/mammo-tech/cases", headers={"Authorization": f"Bearer {token}"}
            )
            assert res.json()["cases"][0]["status"] == "Pending"
        finally:
            db = TestSession()
            try:
                role = db.query(Role).filter(Role.qc_name == "Radiologist").first()
                db.query(User).filter(User.qc_role_id == role.qc_id).update({"qc_is_active": True})
                db.commit()
            finally:
                db.close()

    def test_cannot_review_twice(self, client, seed_hospital_and_user):
        session_id, case_id = create_case()
        add_attachment(case_id, "mammo_cc_left")
        token = _create_mammo_tech_with_case(client, session_id, "mt_twice@test.com")

        res = client.post(
            f"/api/v1/qc/mammo-tech/cases/{case_id}/review",
            json={"confirmation": "no"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200

        res = client.post(
            f"/api/v1/qc/mammo-tech/cases/{case_id}/review",
            json={"confirmation": "yes"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 400


class TestNextCase:
    def test_returns_next_case_on_reject(self, client, seed_hospital_and_user):
        admin_token = get_token("Admin", "admin@test.com")
        session_id1, case_id1 = create_case()
        add_attachment(case_id1, "mammo_cc_left")
        session_id2, case_id2 = create_case()
        add_attachment(case_id2, "mammo_cc_left")

        res = client.post("/api/v1/qc/admin/users", json={
            "full_name": "MT Queue", "email": "mt_queue@test.com", "password": "password123",
            "role": "Mammo Tech", "cases": [session_id1, session_id2],
        }, headers={"Authorization": f"Bearer {admin_token}"})
        assert res.json()["assigned_cases"] == 2
        token = get_token("Mammo Tech", "mt_queue@test.com")

        res = client.post(f"/api/v1/qc/mammo-tech/cases/{case_id1}/review",
                           json={"confirmation": "no"}, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert res.json()["next_case"] is not None
        assert res.json()["next_case"]["case_id"] == case_id2
