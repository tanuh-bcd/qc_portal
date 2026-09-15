"""3-day pending-cases reminder emails for Mammo Tech/Radiologist users.

Self-contained feature — no code or tables shared with reminder_reports.py
(the existing, unrelated hospital-quarterly-report reminder feature). See
PendingCaseReminderLog in models.py for the per-user cooldown tracking.
"""
import datetime
import logging

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..api.admin import _get_role_by_name, MAMMO_TECH_ROLE_NAME, RADIOLOGIST_ROLE_NAME
from ..core.email import send_template_email
from ..models.models import Assignment, PendingCaseReminderLog, User

logger = logging.getLogger(__name__)

REMINDER_COOLDOWN = datetime.timedelta(days=3)


def _pending_counts_for_role(db: Session, role_name: str) -> dict:
    """{user_id: pending_case_count} for the given role, using the same
    Assignment role/status filter conventions used throughout admin.py and
    mammo_tech.py (the assignee's user id always lives in qc_radiologist_id,
    regardless of role)."""
    role = _get_role_by_name(db, role_name)
    role_id = role.qc_id if role else -1
    if role_name == MAMMO_TECH_ROLE_NAME:
        role_filter = Assignment.qc_role_id == role_id
    else:
        role_filter = or_(Assignment.qc_role_id.is_(None), Assignment.qc_role_id == role_id)

    rows = (
        db.query(Assignment.qc_radiologist_id, func.count(Assignment.qc_id))
        .filter(role_filter, Assignment.qc_status == "Pending")
        .group_by(Assignment.qc_radiologist_id)
        .all()
    )
    return {user_id: count for user_id, count in rows}


def _pending_counts_by_user(db: Session) -> dict:
    pending_counts: dict = {}
    for role_name in (MAMMO_TECH_ROLE_NAME, RADIOLOGIST_ROLE_NAME):
        for user_id, count in _pending_counts_for_role(db, role_name).items():
            pending_counts[user_id] = pending_counts.get(user_id, 0) + count
    return pending_counts


def send_due_reminders(db: Session, dry_run: bool = False, now: datetime.datetime = None) -> list:
    """Sends the pending_case_reminder email to every user with >=1 pending
    case whose last reminder (if any) was sent more than REMINDER_COOLDOWN
    ago. Returns one result dict per eligible user for CLI reporting/tests.
    A user with zero pending cases is simply not in the candidate set, so
    reminders stop automatically once their queue is clear."""
    now = now or datetime.datetime.utcnow()
    results = []

    for user_id, pending_count in _pending_counts_by_user(db).items():
        if pending_count <= 0:
            continue

        user = db.query(User).filter(User.qc_id == user_id).first()
        if not user or not user.qc_email:
            logger.warning("Skipping pending-case reminder for user_id=%s: no user/email on file", user_id)
            continue

        log = db.query(PendingCaseReminderLog).filter(PendingCaseReminderLog.qc_user_id == user_id).first()
        if log and log.qc_last_sent_at and (now - log.qc_last_sent_at) < REMINDER_COOLDOWN:
            results.append({
                "user_id": user_id, "email": user.qc_email, "pending_count": pending_count,
                "sent": False, "reason": "cooldown",
            })
            continue

        if dry_run:
            results.append({
                "user_id": user_id, "email": user.qc_email, "pending_count": pending_count,
                "sent": False, "reason": "dry_run",
            })
            continue

        sent = False
        try:
            sent = send_template_email(db, "pending_case_reminder", user.qc_email, {
                "full_name": user.qc_full_name or user.qc_email,
            })
        except Exception:
            logger.exception("Failed to send pending-case reminder to %s", user.qc_email)

        if log is None:
            log = PendingCaseReminderLog(qc_user_id=user_id)
            db.add(log)

        if sent:
            log.qc_last_sent_at = now
            log.qc_pending_count_at_send = pending_count
            db.commit()

        results.append({
            "user_id": user_id, "email": user.qc_email, "pending_count": pending_count,
            "sent": sent, "reason": None if sent else "send_failed",
        })

    return results
