from fastapi import HTTPException

import pytest

from backend.src.api import jobs


def test_pending_case_reminder_endpoint_rejects_unauthenticated_request(monkeypatch):
    monkeypatch.setattr(jobs.settings, "CRON_SHARED_SECRET", "")
    monkeypatch.setattr(
        jobs.settings,
        "CRON_OIDC_AUDIENCE",
        "https://example.test/api/internal/jobs/pending-case-reminders",
    )
    monkeypatch.setattr(jobs.settings, "CRON_SERVICE_ACCOUNT_EMAIL", "scheduler@example.test")

    with pytest.raises(HTTPException) as exc_info:
        jobs.verify_cron_identity(authorization=None, x_cron_secret=None)
    assert exc_info.value.status_code == 401


def test_pending_case_reminder_endpoint_runs_dry_run_with_local_secret(monkeypatch):
    monkeypatch.setattr(jobs.settings, "CRON_SHARED_SECRET", "test-only-secret")
    monkeypatch.setattr(
        jobs,
        "send_due_reminders",
        lambda db, dry_run=False: [
            {"user_id": 1, "email": "a@example.com", "pending_count": 2, "sent": False, "reason": "dry_run"},
            {"user_id": 2, "email": "b@example.com", "pending_count": 1, "sent": False, "reason": "dry_run"},
        ],
    )

    identity = jobs.verify_cron_identity(authorization=None, x_cron_secret="test-only-secret")
    response = jobs.trigger_pending_case_reminders(dry_run=True, db=object(), _identity=identity)

    assert response == {
        "success": True,
        "processed": 2,
        "sent": 0,
        "failed": 0,
        "skipped": 2,
        "dryRun": True,
    }


def test_pending_case_reminder_endpoint_blocked_when_disabled(monkeypatch):
    monkeypatch.setattr(jobs.settings, "PENDING_CASE_REMINDER_EMAIL_ENABLED", False)

    with pytest.raises(HTTPException) as exc_info:
        jobs.trigger_pending_case_reminders(
            dry_run=False,
            db=object(),
            _identity={"authentication": "shared-secret"},
        )
    assert exc_info.value.status_code == 503


def test_pending_case_reminder_endpoint_returns_retryable_error_on_failure(monkeypatch):
    monkeypatch.setattr(jobs.settings, "PENDING_CASE_REMINDER_EMAIL_ENABLED", True)
    monkeypatch.setattr(
        jobs,
        "send_due_reminders",
        lambda db, dry_run=False: [
            {"user_id": 1, "email": "a@example.com", "pending_count": 2, "sent": True, "reason": None},
            {"user_id": 2, "email": "b@example.com", "pending_count": 1, "sent": False, "reason": "send_failed"},
        ],
    )

    with pytest.raises(HTTPException) as exc_info:
        jobs.trigger_pending_case_reminders(
            dry_run=False,
            db=object(),
            _identity={"authentication": "shared-secret"},
        )
    assert exc_info.value.status_code == 502
    assert exc_info.value.detail["sent"] == 1
    assert exc_info.value.detail["failed"] == 1
