import pytest
from fastapi import HTTPException

from backend.src.api import reminders
from backend.src.models.models import ReminderConfiguration
from backend.src.services.reminder_reports import (
    is_delivery_disabled,
    is_delivery_paused,
    set_delivery_disabled,
    set_delivery_paused,
)
from backend.tests.conftest import TestSession


def test_only_configured_active_users_can_manage_reminders(monkeypatch):
    db = TestSession()
    monkeypatch.setattr(
        reminders.settings,
        "REMINDER_OPERATOR_EMAILS",
        "admin@test.com,ashwin.rajkumar@tanuh.ai",
    )
    try:
        operator = reminders.require_reminder_operator(
            current_user={"email": "ADMIN@test.com"},
            db=db,
        )
        assert operator["email"] == "ADMIN@test.com"

        with pytest.raises(HTTPException) as exc_info:
            reminders.require_reminder_operator(
                current_user={"email": "doctor@test.com"},
                db=db,
            )
        assert exc_info.value.status_code == 403
    finally:
        db.close()


def test_pause_and_resume_are_persisted_with_operator_identity():
    db = TestSession()
    try:
        db.query(ReminderConfiguration).filter(ReminderConfiguration.id == 1).delete()
        db.commit()
        set_delivery_paused(db, True, "palivela.sanjana@tanuh.ai")
        assert is_delivery_paused(db) is True
        configuration = set_delivery_paused(db, False, "bharath.tangella@tanuh.ai")
        assert configuration.is_paused is False
        assert configuration.updated_by == "bharath.tangella@tanuh.ai"
        set_delivery_disabled(db, True, "ashwin.rajkumar@tanuh.ai")
        assert is_delivery_disabled(db) is True
        configuration = set_delivery_disabled(db, False, "vaishnavi.joshi@tanuh.ai")
        assert configuration.is_disabled is False
    finally:
        db.query(ReminderConfiguration).filter(ReminderConfiguration.id == 1).delete()
        db.commit()
        db.close()
