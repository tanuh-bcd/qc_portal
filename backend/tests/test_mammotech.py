"""Tests for the Mammo Tech role: auth gating, own-case scoping, and the
image-quality Yes/No review that gates whether a case can reach a Radiologist."""
from .conftest import get_token, TestSession
from backend.src.models.models import DoctorAssessment, User


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


def _assign_to_mammo_tech(client, admin_headers, assessment_id, mammo_tech_id):
    subjects = {s["assessment_id"]: s for s in client.get("/api/v1/qc/admin/subjects", headers=admin_headers).json()}
    subject_id = subjects[assessment_id]["qc_subject_id"]
    client.post(
        "/api/v1/qc/admin/assign-mammotech",
        json={"mammo_tech_id": mammo_tech_id, "subject_ids": [subject_id]},
        headers=admin_headers,
    )
    return subject_id


class TestMammoTechAccess:
    def test_no_auth(self, client):
        res = client.get("/api/v1/qc/mammotech/cases")
        assert res.status_code == 401

    def test_wrong_role(self, client, seed_hospital_and_user):
        token = get_token("Radiologist", "radiologist@test.com")
        res = client.get("/api/v1/qc/mammotech/cases", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 403


class TestMammoTechReview:
    def test_sees_only_own_assigned_cases(self, client, seed_hospital_and_user):
        admin_headers = {"Authorization": f"Bearer {get_token('Admin', 'admin@test.com')}"}
        mammo_tech = next(m for m in client.get("/api/v1/qc/admin/mammotechs", headers=admin_headers).json() if m["email"] == "mammotech@test.com")

        assessment_id = _make_assessment("session_mtq_1")
        _assign_to_mammo_tech(client, admin_headers, assessment_id, mammo_tech["id"])

        other_assessment_id = _make_assessment("session_mtq_2")  # left unassigned

        mt_headers = {"Authorization": f"Bearer {get_token('Mammo Tech', mammo_tech['email'])}"}
        res = client.get("/api/v1/qc/mammotech/cases", headers=mt_headers)
        assert res.status_code == 200
        case_ids = [c["case_id"] for c in res.json()["cases"]]
        assert assessment_id in case_ids
        assert other_assessment_id not in case_ids

    def test_yes_accepts_and_unlocks_radiologist_assignment(self, client, seed_hospital_and_user):
        admin_headers = {"Authorization": f"Bearer {get_token('Admin', 'admin@test.com')}"}
        mammo_tech = next(m for m in client.get("/api/v1/qc/admin/mammotechs", headers=admin_headers).json() if m["email"] == "mammotech@test.com")
        assessment_id = _make_assessment("session_mtq_3")
        subject_id = _assign_to_mammo_tech(client, admin_headers, assessment_id, mammo_tech["id"])

        mt_headers = {"Authorization": f"Bearer {get_token('Mammo Tech', mammo_tech['email'])}"}
        res = client.post(
            f"/api/v1/qc/mammotech/cases/{assessment_id}/review",
            json={"quality_accepted": True},
            headers=mt_headers,
        )
        assert res.status_code == 200
        assert res.json()["status"] == "Accepted"

        radiologist_pool = client.get("/api/v1/qc/admin/subjects?for_role=radiologist", headers=admin_headers).json()
        assert subject_id in [s["qc_subject_id"] for s in radiologist_pool]

    def test_no_rejects_and_stops_workflow(self, client, seed_hospital_and_user):
        admin_headers = {"Authorization": f"Bearer {get_token('Admin', 'admin@test.com')}"}
        mammo_tech = next(m for m in client.get("/api/v1/qc/admin/mammotechs", headers=admin_headers).json() if m["email"] == "mammotech@test.com")
        assessment_id = _make_assessment("session_mtq_4")
        subject_id = _assign_to_mammo_tech(client, admin_headers, assessment_id, mammo_tech["id"])

        mt_headers = {"Authorization": f"Bearer {get_token('Mammo Tech', mammo_tech['email'])}"}
        res = client.post(
            f"/api/v1/qc/mammotech/cases/{assessment_id}/review",
            json={"quality_accepted": False},
            headers=mt_headers,
        )
        assert res.status_code == 200
        assert res.json()["status"] == "Rejected"

        radiologist_pool = client.get("/api/v1/qc/admin/subjects?for_role=radiologist", headers=admin_headers).json()
        assert subject_id not in [s["qc_subject_id"] for s in radiologist_pool]

        # A Radiologist assignment attempt is also rejected server-side.
        radiologist = client.post(
            "/api/v1/qc/admin/users",
            json={"full_name": "Dr. Reject", "email": "rejrad@test.com", "password": "pw12345", "role": "Radiologist"},
            headers=admin_headers,
        ).json()
        res = client.post(
            "/api/v1/qc/admin/assign-radiologist",
            json={"radiologist_id": radiologist["id"], "subject_ids": [subject_id]},
            headers=admin_headers,
        )
        assert res.status_code == 200
        assert res.json()["assigned_count"] == 0
        assert subject_id in res.json()["not_mammo_tech_accepted_subject_ids"]

    def test_cannot_review_another_mammo_techs_case(self, client, seed_hospital_and_user):
        admin_headers = {"Authorization": f"Bearer {get_token('Admin', 'admin@test.com')}"}
        mammo_tech = next(m for m in client.get("/api/v1/qc/admin/mammotechs", headers=admin_headers).json() if m["email"] == "mammotech@test.com")
        assessment_id = _make_assessment("session_mtq_5")
        _assign_to_mammo_tech(client, admin_headers, assessment_id, mammo_tech["id"])

        other_mt = client.post(
            "/api/v1/qc/admin/users",
            json={"full_name": "Other MT", "email": "othermt@test.com", "password": "pw12345", "role": "Mammo Tech"},
            headers=admin_headers,
        ).json()
        other_headers = {"Authorization": f"Bearer {get_token('Mammo Tech', other_mt['email'])}"}
        res = client.post(
            f"/api/v1/qc/mammotech/cases/{assessment_id}/review",
            json={"quality_accepted": True},
            headers=other_headers,
        )
        assert res.status_code == 404
