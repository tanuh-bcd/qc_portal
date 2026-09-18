"""Cloud Scheduler entry points for backend cron jobs.

Currently home to the pending-case reminder trigger only. The previously
separate fortnightly-reminder cron endpoint and its own copy of this auth
dependency were removed from the codebase in an earlier cleanup and are not
part of this router.
"""
import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from google.auth import exceptions as google_auth_exceptions
from google.auth.transport import requests as google_auth_requests
from google.oauth2 import id_token
from sqlalchemy.orm import Session

from ..core.config import settings
from ..db.session import get_db
from ..services.pending_case_reminders import send_due_reminders

router = APIRouter()
logger = logging.getLogger(__name__)


def verify_cron_identity(
    authorization: Optional[str] = Header(None),
    x_cron_secret: Optional[str] = Header(None),
):
    """Authenticate GCP Cloud Scheduler OIDC, with an explicit local-test fallback."""
    if settings.CRON_SHARED_SECRET and x_cron_secret:
        if secrets.compare_digest(x_cron_secret, settings.CRON_SHARED_SECRET):
            return {"authentication": "shared-secret"}

    if not settings.CRON_OIDC_AUDIENCE or not settings.CRON_SERVICE_ACCOUNT_EMAIL:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cron OIDC authentication is not configured",
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing scheduler identity token",
        )

    token = authorization.removeprefix("Bearer ").strip()
    try:
        claims = id_token.verify_oauth2_token(
            token,
            google_auth_requests.Request(),
            audience=settings.CRON_OIDC_AUDIENCE,
        )
    except (ValueError, google_auth_exceptions.GoogleAuthError) as exc:
        logger.warning("Rejected cron identity token: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid scheduler identity token",
        ) from exc

    token_email = claims.get("email", "").lower()
    expected_email = settings.CRON_SERVICE_ACCOUNT_EMAIL.lower()
    if token_email != expected_email or claims.get("email_verified") is not True:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Scheduler service account is not authorized",
        )

    return claims


@router.post("/pending-case-reminders")
def trigger_pending_case_reminders(
    dry_run: bool = Query(False),
    db: Session = Depends(get_db),
    _identity: dict = Depends(verify_cron_identity),
):
    """Cloud Scheduler entry point. `send_due_reminders` retains the 3-day
    per-user cooldown, so a recipient with no due reminder is simply skipped
    rather than re-emailed on every run."""
    if not settings.PENDING_CASE_REMINDER_EMAIL_ENABLED and not dry_run:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Pending-case reminder email delivery is disabled",
        )

    results = send_due_reminders(db, dry_run=dry_run)
    sent = sum(1 for r in results if r["sent"])
    failed = sum(1 for r in results if r.get("reason") == "send_failed")
    skipped = len(results) - sent - failed

    response = {
        "success": failed == 0,
        "processed": len(results),
        "sent": sent,
        "failed": failed,
        "skipped": skipped,
        "dryRun": dry_run,
    }
    if failed:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=response,
        )
    return response
