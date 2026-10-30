"""Retrospective notification emails.

Same mechanism as the rest of the QC Portal: templates live in qc_email_templates and are sent through
core.email.send_template_email over the existing SMTP settings. A failure to send is logged and never
blocks the workflow action that triggered it.
"""
import html
import logging
from typing import Optional

from sqlalchemy.orm import Session

from ..core.email import send_template_email

logger = logging.getLogger(__name__)

TEMPLATE_ASSIGNED = "retro_cases_assigned"
TEMPLATE_ESCALATED = "retro_case_escalated"
TEMPLATE_RETURNED = "retro_case_returned"


def _login_url() -> str:
    from ..api.admin import QC_LOGIN_URL  # imported lazily: api.admin imports this package's siblings
    return QC_LOGIN_URL


def _send(db: Session, key: str, user, variables: dict) -> bool:
    if not user or not user.qc_email:
        return False
    # Templates are HTML and the renderer does not escape, so user-typed text (notes, names) is escaped here.
    safe = {k: html.escape(str(v)).replace("\n", "<br>") for k, v in
            {"full_name": user.qc_full_name or user.qc_email, **variables}.items()}
    try:
        return bool(send_template_email(db, key, user.qc_email, {**safe, "login_url": _login_url()}))
    except Exception:
        logger.exception("Retrospective email '%s' to %s failed", key, user.qc_email)
        return False


def notify_assigned(db: Session, tech, count: int, first_case: Optional[str], last_case: Optional[str]) -> bool:
    return _send(db, TEMPLATE_ASSIGNED, tech, {
        "case_count": str(count), "first_case": first_case or "", "last_case": last_case or ""})


def notify_escalated(db: Session, radiologist, case_code: str, tech_name: str, note: str) -> bool:
    return _send(db, TEMPLATE_ESCALATED, radiologist, {"case_code": case_code, "mammo_tech_name": tech_name, "note": note})


def notify_returned(db: Session, tech, case_code: str, radiologist_name: str) -> bool:
    return _send(db, TEMPLATE_RETURNED, tech, {"case_code": case_code, "radiologist_name": radiologist_name})
