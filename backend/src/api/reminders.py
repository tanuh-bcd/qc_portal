from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .auth import get_current_user
from ..core.config import settings
from ..db.session import get_db, get_questionnaire_db
from ..models.models import User
from ..services.reminder_reports import (
    aggregate_recipients,
    build_reports,
    current_date,
    is_delivery_disabled,
    is_delivery_paused,
    run_reminders,
    reminder_cc_recipients,
    set_delivery_disabled,
    set_delivery_paused,
)

router = APIRouter()


def _configured_emails(value: str) -> set[str]:
    return {item.strip().lower() for item in value.split(",") if item.strip()}


def require_reminder_operator(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    email = current_user.get("email", "").strip().lower()
    authorized = _configured_emails(settings.REMINDER_OPERATOR_EMAILS)
    active_user = db.query(User).filter(
        User.email == email,
        User.is_active.is_(True),
    ).first()
    if email not in authorized or not active_user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to manage reminder reports",
        )
    return current_user


def _report_preview(report) -> dict:
    return {
        "hospitalId": report.hospital_id,
        "hospitalName": report.hospital_name,
        "lifetimeDataPoints": report.lifetime_data_points,
        "currentQuarterDataPoints": report.data_points,
        "assessmentsSubmitted": report.assessments_submitted,
        "pendingSubmissions": report.pending_submissions,
        "quarterlyTarget": report.quarterly_target,
        "currentQuarterRecords": report.current_quarter_records,
        "dataQuality": {
            "missingConsent": report.missing_consent,
            "missingQuestionnaire": report.missing_questionnaire_sessions,
            "blankQuestionnaireFields": report.blank_questionnaire_sessions,
            "missingMammogramViews": report.missing_mammogram_views,
            "missingBIRADS": report.missing_birads,
            "missingACRDensity": report.missing_density,
            "missingMammogramReport": report.missing_mammogram_reports,
            "routineViewQualityFlags": report.mammogram_quality_flags,
        },
        "activeRecipientCount": report.active_recipient_count,
        "activeRecipientEmails": list(report.active_recipient_emails),
        "goalAchieved": report.pending_submissions == 0,
    }


@router.get("/status")
def reminder_status(
    db: Session = Depends(get_db),
    _operator: dict = Depends(require_reminder_operator),
):
    return {
        "deliveryEnabled": settings.REMINDER_EMAIL_ENABLED,
        "disabled": is_delivery_disabled(db),
        "paused": is_delivery_paused(db),
        "intervalDays": settings.REMINDER_INTERVAL_DAYS,
        "pilotIntervalMinutes": settings.REMINDER_INTERVAL_MINUTES,
        "quarterlyTarget": settings.REMINDER_QUARTERLY_TARGET,
        "aggregateRecipients": [recipient.email for recipient in aggregate_recipients()],
        "ccRecipients": reminder_cc_recipients(),
        "maxDeliveryAttempts": max(settings.REMINDER_MAX_DELIVERY_ATTEMPTS, 1),
        "failureRecipientEmail": settings.REMINDER_FAILURE_RECIPIENT_EMAIL,
    }


@router.get("/preview")
def preview_reports(
    hospital_id: Optional[str] = Query(None),
    report_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    questionnaire_db: Session = Depends(get_questionnaire_db),
    _operator: dict = Depends(require_reminder_operator),
):
    as_of = report_date or current_date()
    reports = build_reports(db, questionnaire_db, as_of, hospital_id=hospital_id)
    if hospital_id and not reports:
        raise HTTPException(status_code=404, detail="Hospital not found")
    return {
        "reportDate": as_of,
        "reports": [_report_preview(report) for report in reports],
    }


@router.post("/resend")
def manually_resend_reports(
    hospital_id: Optional[str] = Query(None),
    include_aggregate: bool = Query(False),
    db: Session = Depends(get_db),
    questionnaire_db: Session = Depends(get_questionnaire_db),
    _operator: dict = Depends(require_reminder_operator),
):
    if not settings.REMINDER_EMAIL_ENABLED:
        raise HTTPException(status_code=503, detail="Reminder email delivery is disabled")
    if is_delivery_disabled(db):
        raise HTTPException(
            status_code=503,
            detail="Reminder email delivery was disabled by an authorized operator",
        )
    if is_delivery_paused(db):
        raise HTTPException(status_code=503, detail="Reminder email delivery is paused")
    results = run_reminders(
        db,
        questionnaire_db,
        hospital_id=hospital_id,
        force=True,
        include_aggregate=include_aggregate,
    )
    failed = sum(result.status == "failed" for result in results)
    response = {
        "success": failed == 0,
        "processed": len(results),
        "sent": sum(result.status == "sent" for result in results),
        "failed": failed,
    }
    if failed:
        raise HTTPException(status_code=502, detail=response)
    return response


@router.post("/pause")
def pause_reports(
    db: Session = Depends(get_db),
    operator: dict = Depends(require_reminder_operator),
):
    configuration = set_delivery_paused(db, True, operator["email"])
    return {"paused": configuration.is_paused, "updatedBy": configuration.updated_by}


@router.post("/resume")
def resume_reports(
    db: Session = Depends(get_db),
    operator: dict = Depends(require_reminder_operator),
):
    configuration = set_delivery_paused(db, False, operator["email"])
    return {"paused": configuration.is_paused, "updatedBy": configuration.updated_by}


@router.post("/disable")
def disable_reports(
    db: Session = Depends(get_db),
    operator: dict = Depends(require_reminder_operator),
):
    configuration = set_delivery_disabled(db, True, operator["email"])
    return {"disabled": configuration.is_disabled, "updatedBy": configuration.updated_by}


@router.post("/enable")
def enable_reports(
    db: Session = Depends(get_db),
    operator: dict = Depends(require_reminder_operator),
):
    configuration = set_delivery_disabled(db, False, operator["email"])
    return {"disabled": configuration.is_disabled, "updatedBy": configuration.updated_by}
