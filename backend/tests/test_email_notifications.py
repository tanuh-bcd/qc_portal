"""Tests for the new case-assignment / pending-cases-reminder emails.
send_email is monkeypatched (same pattern as test_email.py) so no real SMTP
call is ever attempted; only send_template_email's template lookup + render
+ recipient resolution are exercised for real.

Every test creates its own dedicated Mammo Tech/Radiologist user (unique
email per test) rather than touching the shared seeded mammotech@test.com/
radiologist@test.com — other test files (test_mammo_tech.py in particular)
assert those seeded users' case queues stay empty, so reusing them here would
leave stray Pending assignments that break those tests when the whole suite
runs together."""
import datetime
import itertools

import pytest

from backend.src.core import email as email_service
from backend.src.models.models import Assignment, EmailTemplate, PendingCaseReminderLog, User
from backend.src.services.pending_case_reminders import send_due_reminders
from .conftest import get_token, create_case, add_attachment, TestSession

TEMPLATE_KEYS = ["mammo_tech_case_assigned", "radiologist_case_assigned", "pending_case_reminder"]
_email_counter = itertools.count()


def _unique_email(prefix):
    return f"{prefix}{next(_email_counter)}@test.com"


def _create_user(client, role, email):
    admin_token = get_token("Admin", "admin@test.com")
    res = client.post("/api/v1/qc/admin/users", json={
        "full_name": f"Test {role} {email}", "email": email, "password": "password123", "role": role,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200, res.text
    return res.json()["id"]


@pytest.fixture
def captured_emails(monkeypatch):
    """Patches the low-level send_email (as test_email.py does) and seeds the
    3 new templates this feature needs — the real migration only inserts
    these into a live MySQL DB, so the SQLite test DB needs them seeded
    directly, same as test_email.py does for its own template."""
    calls = []

    def fake_send_email(to_email, subject, html, **kwargs):
        calls.append({"to": to_email, "subject": subject, "html": html, **kwargs})
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send_email)

    db = TestSession()
    bodies = {
        "mammo_tech_case_assigned": ("QC BCD Portal – Cases Assigned for Review", "<p>Hi {{full_name}},</p>"),
        "radiologist_case_assigned": ("QC BCD Portal – Cases Assigned for Radiologist Review", "<p>Hi {{full_name}},</p>"),
        "pending_case_reminder": ("QC BCD Portal – Pending Cases Reminder", "<p>Hi {{full_name}},</p>"),
    }
    for key, (subject, body) in bodies.items():
        if not db.query(EmailTemplate).filter(EmailTemplate.qc_template_key == key).first():
            db.add(EmailTemplate(qc_template_key=key, qc_subject=subject, qc_body_html=body))
    db.commit()
    db.close()

    yield calls

    db = TestSession()
    db.query(EmailTemplate).filter(EmailTemplate.qc_template_key.in_(TEMPLATE_KEYS)).delete(synchronize_session=False)
    db.commit()
    db.close()


class TestMammoTechAssignmentEmail:
    def test_one_email_per_assignment_action(self, client, seed_hospital_and_user, captured_emails):
        admin_headers = {"Authorization": f"Bearer {get_token('Admin', 'admin@test.com')}"}
        mt_email = _unique_email("mt_assign_")
        mt_id = _create_user(client, "Mammo Tech", mt_email)

        subj1, _ = create_case()
        subj2, _ = create_case()

        res = client.post("/api/v1/qc/admin/assign-mammo-tech",
                           json={"mammo_tech_id": mt_id, "subject_ids": [subj1, subj2]},
                           headers=admin_headers)
        assert res.status_code == 200, res.text
        assert res.json()["assigned_count"] == 2

        mammo_tech_calls = [c for c in captured_emails if c["subject"] == "QC BCD Portal – Cases Assigned for Review"]
        assert len(mammo_tech_calls) == 1
        assert mammo_tech_calls[0]["to"] == mt_email

    def test_no_email_when_nothing_newly_assigned(self, client, seed_hospital_and_user, captured_emails):
        admin_headers = {"Authorization": f"Bearer {get_token('Admin', 'admin@test.com')}"}
        mt_email = _unique_email("mt_noop_")
        mt_id = _create_user(client, "Mammo Tech", mt_email)

        subj, _ = create_case()
        client.post("/api/v1/qc/admin/assign-mammo-tech",
                     json={"mammo_tech_id": mt_id, "subject_ids": [subj]}, headers=admin_headers)
        assert len(captured_emails) == 1

        # Re-assigning the exact same case to the same mammo tech is a no-op.
        res = client.post("/api/v1/qc/admin/assign-mammo-tech",
                           json={"mammo_tech_id": mt_id, "subject_ids": [subj]}, headers=admin_headers)
        assert res.json()["assigned_count"] == 0
        assert len(captured_emails) == 1


class TestRadiologistAssignmentEmail:
    def test_yes_review_emails_the_chosen_radiologist(self, client, seed_hospital_and_user, captured_emails):
        admin_headers = {"Authorization": f"Bearer {get_token('Admin', 'admin@test.com')}"}
        mt_email = _unique_email("mt_yes_")
        mt_id = _create_user(client, "Mammo Tech", mt_email)
        mt_headers = {"Authorization": f"Bearer {get_token('Mammo Tech', mt_email)}"}

        subj, aid = create_case()
        add_attachment(aid, "mammo_cc_left")
        client.post("/api/v1/qc/admin/assign-mammo-tech",
                     json={"mammo_tech_id": mt_id, "subject_ids": [subj]}, headers=admin_headers)

        case_id = client.get("/api/v1/qc/mammo-tech/cases", headers=mt_headers).json()["cases"][0]["case_id"]
        res = client.post(f"/api/v1/qc/mammo-tech/cases/{case_id}/review",
                           json={"confirmation": "yes"}, headers=mt_headers)
        assert res.status_code == 200, res.text
        chosen_radiologist_id = res.json()["assigned_radiologist_id"]

        db = TestSession()
        try:
            chosen_email = db.query(User).filter(User.qc_id == chosen_radiologist_id).first().qc_email
        finally:
            db.close()

        rad_calls = [c for c in captured_emails if c["subject"] == "QC BCD Portal – Cases Assigned for Radiologist Review"]
        assert len(rad_calls) == 1
        assert rad_calls[0]["to"] == chosen_email

    def test_no_review_sends_no_radiologist_email(self, client, seed_hospital_and_user, captured_emails):
        admin_headers = {"Authorization": f"Bearer {get_token('Admin', 'admin@test.com')}"}
        mt_email = _unique_email("mt_no_")
        mt_id = _create_user(client, "Mammo Tech", mt_email)
        mt_headers = {"Authorization": f"Bearer {get_token('Mammo Tech', mt_email)}"}

        subj, aid = create_case()
        add_attachment(aid, "mammo_cc_left")
        client.post("/api/v1/qc/admin/assign-mammo-tech",
                     json={"mammo_tech_id": mt_id, "subject_ids": [subj]}, headers=admin_headers)

        case_id = client.get("/api/v1/qc/mammo-tech/cases", headers=mt_headers).json()["cases"][0]["case_id"]
        res = client.post(f"/api/v1/qc/mammo-tech/cases/{case_id}/review",
                           json={"confirmation": "no", "reason": "Bad image"}, headers=mt_headers)
        assert res.status_code == 200, res.text

        rad_calls = [c for c in captured_emails if c["subject"] == "QC BCD Portal – Cases Assigned for Radiologist Review"]
        assert len(rad_calls) == 0


class TestPendingCaseReminders:
    def test_reminder_cooldown_and_auto_stop(self, client, seed_hospital_and_user, captured_emails):
        admin_headers = {"Authorization": f"Bearer {get_token('Admin', 'admin@test.com')}"}
        mt_email = _unique_email("mt_remind_")
        mt_id = _create_user(client, "Mammo Tech", mt_email)

        subj, _ = create_case()
        client.post("/api/v1/qc/admin/assign-mammo-tech",
                     json={"mammo_tech_id": mt_id, "subject_ids": [subj]}, headers=admin_headers)
        # That assignment already sent a "cases assigned" email — clear it so
        # this test only looks at reminder-specific sends.
        captured_emails.clear()

        def reminder_calls_for(user_email):
            return [c for c in captured_emails
                    if c["subject"] == "QC BCD Portal – Pending Cases Reminder" and c["to"] == user_email]

        db = TestSession()
        try:
            now = datetime.datetime.utcnow()

            # First run: user has a pending case and no prior reminder -> sends.
            results = send_due_reminders(db, now=now)
            mine = [r for r in results if r["email"] == mt_email]
            assert len(mine) == 1 and mine[0]["sent"] is True
            assert len(reminder_calls_for(mt_email)) == 1

            # Immediately again: still within the 3-day cooldown -> no send.
            results = send_due_reminders(db, now=now + datetime.timedelta(hours=1))
            mine = [r for r in results if r["email"] == mt_email]
            assert mine[0]["sent"] is False and mine[0]["reason"] == "cooldown"
            assert len(reminder_calls_for(mt_email)) == 1  # unchanged

            # 3+ days later: cooldown elapsed -> sends again.
            results = send_due_reminders(db, now=now + datetime.timedelta(days=3, minutes=1))
            mine = [r for r in results if r["email"] == mt_email]
            assert mine[0]["sent"] is True
            assert len(reminder_calls_for(mt_email)) == 2

            # Clear the pending case (mark it Rejected) -> user drops out entirely.
            user = db.query(User).filter(User.qc_email == mt_email).first()
            db.query(Assignment).filter(Assignment.qc_radiologist_id == user.qc_id).update(
                {"qc_status": "Rejected"}, synchronize_session=False
            )
            db.commit()
            results = send_due_reminders(db, now=now + datetime.timedelta(days=10))
            mine = [r for r in results if r["email"] == mt_email]
            assert mine == []
        finally:
            db.query(PendingCaseReminderLog).filter(
                PendingCaseReminderLog.qc_user_id.in_(
                    db.query(User.qc_id).filter(User.qc_email == mt_email)
                )
            ).delete(synchronize_session=False)
            db.commit()
            db.close()
