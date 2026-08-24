import html
import logging
import uuid
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta
from typing import Iterable, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import bindparam, func, text
from sqlalchemy.orm import Session, joinedload

from ..core.config import settings
from ..core.email import send_template_email
from ..models.models import (
    DoctorAssessment,
    Hospital,
    PatientSession,
    ReminderConfiguration,
    ReminderEmailLog,
    User,
)

logger = logging.getLogger(__name__)

HOSPITAL_TEMPLATE_KEY = "fortnightly_submission_update"
AGGREGATE_TEMPLATE_KEY = "fortnightly_all_hospitals_update"
FAILURE_TEMPLATE_KEY = "fortnightly_delivery_failure"
INSTITUTE_QUESTIONS = (
    "Institute Name",
    "Institute Name:",
    "Enter the Hospital ID(If any, else leave):",
    "Q45",
)
MAMMOGRAM_VIEWS = {
    "mammo_cc_left",
    "mammo_cc_right",
    "mammo_mlo_left",
    "mammo_mlo_right",
}


@dataclass(frozen=True)
class ReminderRecipient:
    email: str
    name: str


@dataclass(frozen=True)
class ReminderReport:
    hospital_id: str
    hospital_name: str
    report_date: date
    quarter_start: date
    quarter_end: date
    lifetime_data_points: int
    data_points: int
    assessments_submitted: int
    pending_submissions: int
    quarterly_target: int
    current_quarter_records: int
    missing_consent: int
    missing_questionnaire_sessions: int
    blank_questionnaire_sessions: int
    incomplete_assessments: int
    missing_mammogram_views: int
    missing_birads: int
    missing_density: int
    missing_mammogram_reports: int
    mammogram_quality_flags: int
    active_recipient_count: int
    active_recipient_emails: tuple[str, ...]


def _csv_values(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def current_date() -> date:
    return datetime.now(ZoneInfo(settings.REMINDER_TIMEZONE)).date()


def quarter_bounds(report_date: date) -> tuple[date, date]:
    start_month = ((report_date.month - 1) // 3) * 3 + 1
    start = date(report_date.year, start_month, 1)
    if start_month == 10:
        end = date(report_date.year + 1, 1, 1)
    else:
        end = date(report_date.year, start_month + 3, 1)
    return start, end


def _as_date(value) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except (TypeError, ValueError):
        logger.warning("Ignoring unparseable questionnaire session date %r", value)
        return None


def _chunks(values: list[str], size: int = 500) -> Iterable[list[str]]:
    for index in range(0, len(values), size):
        yield values[index:index + size]


def _questionnaire_rows(questionnaire_db: Session, hospital_name: str):
    statement = text("""
        SELECT DISTINCT
            s.session_id,
            s.session_start_time,
            s.session_end_time,
            s.snehita_lifetime_risk,
            s.consent_url
        FROM session_table s
        JOIN session_data_table sd ON s.session_id = sd.session_id
        WHERE sd.question IN :institute_questions
          AND TRIM(sd.answer) = :hospital_name
    """).bindparams(bindparam("institute_questions", expanding=True))
    return questionnaire_db.execute(statement, {
        "institute_questions": INSTITUTE_QUESTIONS,
        "hospital_name": hospital_name,
    }).fetchall()


def _blank_questionnaire_session_ids(questionnaire_db: Session, session_ids: list[str]) -> set[str]:
    blank_ids: set[str] = set()
    for session_chunk in _chunks(session_ids):
        statement = text("""
            SELECT DISTINCT session_id
            FROM session_data_table
            WHERE session_id IN :session_ids
              AND (answer IS NULL OR TRIM(answer) = '')
        """).bindparams(bindparam("session_ids", expanding=True))
        blank_ids.update(
            row[0] for row in questionnaire_db.execute(
                statement, {"session_ids": session_chunk}
            ).fetchall()
        )
    return blank_ids


def _patient_sessions(db: Session, session_ids: list[str]) -> dict[str, PatientSession]:
    sessions: dict[str, PatientSession] = {}
    for session_chunk in _chunks(session_ids):
        rows = db.query(PatientSession).filter(
            PatientSession.id.in_(session_chunk)
        ).all()
        sessions.update({row.id: row for row in rows})
    return sessions


def _latest_assessments(
    db: Session,
    session_ids: list[str],
) -> dict[str, DoctorAssessment]:
    assessments: dict[str, DoctorAssessment] = {}
    for session_chunk in _chunks(session_ids):
        rows = db.query(DoctorAssessment).options(
            joinedload(DoctorAssessment.attachments)
        ).filter(
            DoctorAssessment.patient_session_id.in_(session_chunk)
        ).all()
        for row in rows:
            existing = assessments.get(row.patient_session_id)
            if not existing or (
                row.created_at or datetime.min,
                row.id or 0,
            ) > (
                existing.created_at or datetime.min,
                existing.id or 0,
            ):
                assessments[row.patient_session_id] = row
    return assessments


def _bilateral_value(assessment: Optional[DoctorAssessment], field: str) -> bool:
    if not assessment:
        return False
    if field == "birads":
        right_value = assessment.mammo_birads
        left_value = assessment.us_biopsy_birads
    else:
        right_value = assessment.mammo_density
        left_value = assessment.us_biopsy_density

    findings = assessment.clinical_findings if isinstance(assessment.clinical_findings, dict) else {}
    right = findings.get("right") if isinstance(findings.get("right"), dict) else {}
    left = findings.get("left") if isinstance(findings.get("left"), dict) else {}
    return bool(right_value or right.get(field)) and bool(left_value or left.get(field))


def _components(
    questionnaire_row,
    patient_session: Optional[PatientSession],
    assessment: Optional[DoctorAssessment],
) -> dict[str, bool]:
    attachment_types = {
        attachment.file_type for attachment in (assessment.attachments if assessment else [])
    }
    questionnaire_complete = bool(
        questionnaire_row.snehita_lifetime_risk is not None
        and str(questionnaire_row.snehita_lifetime_risk).strip()
    )
    return {
        "consent": bool(
            (questionnaire_row.consent_url and str(questionnaire_row.consent_url).strip())
            or (patient_session and patient_session.consent_scanned_url)
        ),
        "questionnaire": questionnaire_complete,
        "mammogram": MAMMOGRAM_VIEWS.issubset(attachment_types),
        "birads": _bilateral_value(assessment, "birads"),
        "density": _bilateral_value(assessment, "density"),
        "mammogram_report": "mammo_reading" in attachment_types,
        "routine_views_confirmed": bool(assessment and assessment.routine_views_uploaded),
        "assessment": assessment is not None,
    }


def _is_complete_data_point(components: dict[str, bool]) -> bool:
    return all(components[key] for key in ("consent", "questionnaire", "mammogram", "birads", "density"))


def active_hospital_recipients(db: Session, hospital_id: str) -> list[ReminderRecipient]:
    users = db.query(User).filter(
        User.hospital_id == hospital_id,
        User.is_active.is_(True),
        User.email.isnot(None),
        User.email != "",
    ).order_by(User.id).all()
    excluded_domains = {
        value.lower().lstrip("@")
        for value in _csv_values(settings.REMINDER_EXCLUDED_RECIPIENT_DOMAINS)
    }
    recipients: list[ReminderRecipient] = []
    seen: set[str] = set()
    for user in users:
        email = user.email.strip().lower()
        if any(email.endswith(f"@{domain}") for domain in excluded_domains):
            continue
        if email in seen:
            continue
        seen.add(email)
        recipients.append(ReminderRecipient(email, user.full_name or "PinkShield AI User"))
    return recipients


def hospital_recipients(db: Session, hospital_id: str) -> list[ReminderRecipient]:
    if settings.REMINDER_RECIPIENT_EMAIL:
        return [ReminderRecipient(settings.REMINDER_RECIPIENT_EMAIL.strip().lower(), "Pilot Reviewer")]
    return active_hospital_recipients(db, hospital_id)


def aggregate_recipients() -> list[ReminderRecipient]:
    emails = (
        [settings.REMINDER_RECIPIENT_EMAIL]
        if settings.REMINDER_RECIPIENT_EMAIL
        else _csv_values(settings.REMINDER_AGGREGATE_RECIPIENTS)
    )
    seen: set[str] = set()
    recipients: list[ReminderRecipient] = []
    for value in emails:
        email = value.strip().lower()
        if email and email not in seen:
            seen.add(email)
            recipients.append(ReminderRecipient(email, "PinkShield AI Team"))
    return recipients


def reminder_cc_recipients() -> list[str]:
    seen: set[str] = set()
    recipients: list[str] = []
    for value in _csv_values(settings.REMINDER_CC_EMAILS):
        email = value.strip().lower()
        if email and email not in seen:
            seen.add(email)
            recipients.append(email)
    return recipients


def build_report(
    db: Session,
    questionnaire_db: Session,
    hospital: Hospital,
    report_date: date,
    target: Optional[int] = None,
) -> ReminderReport:
    target = target if target is not None else settings.REMINDER_QUARTERLY_TARGET
    quarter_start, quarter_end = quarter_bounds(report_date)
    questionnaire_rows = _questionnaire_rows(questionnaire_db, hospital.name)
    session_ids = [row.session_id for row in questionnaire_rows]
    patient_sessions = _patient_sessions(db, session_ids)
    latest_assessments = _latest_assessments(db, session_ids)

    current_rows = []
    lifetime_data_points = 0
    for row in questionnaire_rows:
        components = _components(
            row,
            patient_sessions.get(row.session_id),
            latest_assessments.get(row.session_id),
        )
        if _is_complete_data_point(components):
            lifetime_data_points += 1
        submitted_on = _as_date(row.session_end_time or row.session_start_time)
        if submitted_on and quarter_start <= submitted_on < quarter_end:
            current_rows.append((row, components))

    current_session_ids = [row.session_id for row, _ in current_rows]
    blank_session_ids = _blank_questionnaire_session_ids(questionnaire_db, current_session_ids)
    data_points = sum(_is_complete_data_point(components) for _, components in current_rows)
    assessments_submitted = sum(components["assessment"] for _, components in current_rows)

    recipients = active_hospital_recipients(db, hospital.id)
    return ReminderReport(
        hospital_id=hospital.id,
        hospital_name=hospital.name,
        report_date=report_date,
        quarter_start=quarter_start,
        quarter_end=quarter_end,
        lifetime_data_points=int(lifetime_data_points),
        data_points=int(data_points),
        assessments_submitted=int(assessments_submitted),
        pending_submissions=max(target - int(data_points), 0),
        quarterly_target=target,
        current_quarter_records=len(current_rows),
        missing_consent=sum(not components["consent"] for _, components in current_rows),
        missing_questionnaire_sessions=sum(not components["questionnaire"] for _, components in current_rows),
        blank_questionnaire_sessions=len(blank_session_ids),
        incomplete_assessments=sum(
            not components["assessment"] or not components["birads"] or not components["density"]
            for _, components in current_rows
        ),
        missing_mammogram_views=sum(not components["mammogram"] for _, components in current_rows),
        missing_birads=sum(not components["birads"] for _, components in current_rows),
        missing_density=sum(not components["density"] for _, components in current_rows),
        missing_mammogram_reports=sum(not components["mammogram_report"] for _, components in current_rows),
        mammogram_quality_flags=sum(
            components["assessment"] and not components["routine_views_confirmed"]
            for _, components in current_rows
        ),
        active_recipient_count=len(recipients),
        active_recipient_emails=tuple(recipient.email for recipient in recipients),
    )


def is_due(
    db: Session,
    hospital_id: Optional[str],
    as_of: date | datetime,
    interval_days: int,
    interval_minutes: int = 0,
    recipient_email: Optional[str] = None,
    report_type: str = "hospital",
) -> bool:
    query = db.query(func.max(ReminderEmailLog.sent_at)).filter(
        ReminderEmailLog.report_type == report_type,
        ReminderEmailLog.status == "sent",
    )
    if hospital_id is None:
        query = query.filter(ReminderEmailLog.hospital_id.is_(None))
    else:
        query = query.filter(ReminderEmailLog.hospital_id == hospital_id)
    if recipient_email:
        query = query.filter(func.lower(ReminderEmailLog.recipient_email) == recipient_email.lower())
    last_sent = query.scalar()
    if not last_sent:
        return True
    check_time = as_of if isinstance(as_of, datetime) else datetime.combine(as_of, time.min)
    interval = (
        timedelta(minutes=interval_minutes)
        if interval_minutes > 0
        else timedelta(days=interval_days)
    )
    return last_sent <= check_time - interval


def report_variables(report: ReminderReport, recipient: ReminderRecipient) -> dict:
    quarter_number = ((report.quarter_start.month - 1) // 3) + 1
    progress_percent = (
        min(round((report.data_points / report.quarterly_target) * 100), 100)
        if report.quarterly_target else 100
    )
    if report.pending_submissions == 0:
        goal_status_message = (
            "Minimum quarterly target achieved. Thank you for your contribution. "
            "Please continue submitting additional complete records and resolving "
            "any remaining data-quality issues."
        )
    else:
        goal_status_message = (
            f"{report.pending_submissions} complete patient data points remain against "
            f"this quarter's minimum target. Please complete submissions by "
            f"{(report.quarter_end - timedelta(days=1)).strftime('%d %B %Y')}."
        )
    return {
        "contact_name": html.escape(recipient.name),
        "hospital_name": html.escape(report.hospital_name),
        "quarter": f"Q{quarter_number} {report.report_date.year}",
        "report_date": report.report_date.strftime("%d %B %Y"),
        "quarter_end_date": (report.quarter_end - timedelta(days=1)).strftime("%d %B %Y"),
        "lifetime_data_points": report.lifetime_data_points,
        "data_points": report.data_points,
        "assessments_submitted": report.assessments_submitted,
        "pending_submissions": report.pending_submissions,
        "quarterly_target": report.quarterly_target,
        "progress_percent": progress_percent,
        "goal_status_message": goal_status_message,
        "current_quarter_records": report.current_quarter_records,
        "missing_consent": report.missing_consent,
        "missing_questionnaire_sessions": report.missing_questionnaire_sessions,
        "blank_questionnaire_sessions": report.blank_questionnaire_sessions,
        "incomplete_assessments": report.incomplete_assessments,
        "missing_mammogram_views": report.missing_mammogram_views,
        "missing_birads": report.missing_birads,
        "missing_density": report.missing_density,
        "missing_mammogram_reports": report.missing_mammogram_reports,
        "mammogram_quality_flags": report.mammogram_quality_flags,
        "portal_url": settings.REMINDER_PORTAL_URL,
    }


def aggregate_variables(reports: list[ReminderReport], report_date: date, recipient: ReminderRecipient) -> dict:
    quarter_start, quarter_end = quarter_bounds(report_date)
    quarter_number = ((quarter_start.month - 1) // 3) + 1
    rows = []
    for report in sorted(reports, key=lambda item: item.hospital_name.lower()):
        rows.append(
            "<tr>"
            f"<td>{html.escape(report.hospital_name)}</td>"
            f"<td align='right'>{report.lifetime_data_points}</td>"
            f"<td align='right'>{report.data_points}</td>"
            f"<td align='right'>{report.assessments_submitted}</td>"
            f"<td align='right'>{report.pending_submissions}</td>"
            f"<td align='right'>{report.current_quarter_records}</td>"
            f"<td align='right'>{report.missing_consent}</td>"
            f"<td align='right'>{report.missing_questionnaire_sessions}</td>"
            f"<td align='right'>{report.blank_questionnaire_sessions}</td>"
            f"<td align='right'>{report.missing_mammogram_views}</td>"
            f"<td align='right'>{report.missing_birads}</td>"
            f"<td align='right'>{report.missing_density}</td>"
            f"<td align='right'>{report.missing_mammogram_reports}</td>"
            f"<td align='right'>{report.mammogram_quality_flags}</td>"
            f"<td align='right'>{report.active_recipient_count}</td>"
            "</tr>"
        )
    return {
        "contact_name": html.escape(recipient.name),
        "quarter": f"Q{quarter_number} {report_date.year}",
        "report_date": report_date.strftime("%d %B %Y"),
        "hospital_rows": "".join(rows),
        "hospital_count": len(reports),
        "lifetime_data_points": sum(report.lifetime_data_points for report in reports),
        "data_points": sum(report.data_points for report in reports),
        "assessments_submitted": sum(report.assessments_submitted for report in reports),
        "pending_submissions": sum(report.pending_submissions for report in reports),
        "quarterly_target": settings.REMINDER_QUARTERLY_TARGET,
        "combined_target": settings.REMINDER_QUARTERLY_TARGET * len(reports),
        "portal_url": settings.REMINDER_PORTAL_URL,
        "quarter_end_date": (quarter_end - timedelta(days=1)).strftime("%d %B %Y"),
    }


def send_template_test_suite(
    db: Session,
    questionnaire_db: Session,
    hospital_id: str,
    dry_run: bool = False,
) -> list[dict]:
    """Send controlled format samples without creating reminder delivery logs."""
    recipient_email = settings.REMINDER_RECIPIENT_EMAIL.strip().lower()
    recipient = ReminderRecipient(recipient_email, "Pilot Reviewer")
    report_date = current_date()
    hospital_reports = build_reports(
        db,
        questionnaire_db,
        report_date,
        hospital_id=hospital_id,
    )
    if not hospital_reports:
        return []

    report = hospital_reports[0]
    pending_target = max(report.quarterly_target, report.data_points + 1)
    pending_report = replace(
        report,
        quarterly_target=pending_target,
        pending_submissions=pending_target - report.data_points,
    )
    achieved_points = max(report.data_points, report.quarterly_target)
    achieved_report = replace(
        report,
        lifetime_data_points=max(report.lifetime_data_points, achieved_points),
        data_points=achieved_points,
        pending_submissions=0,
    )
    all_reports = build_reports(db, questionnaire_db, report_date)
    aggregate_test_variables = aggregate_variables(
        all_reports,
        report_date,
        recipient,
    )
    aggregate_test_variables["quarter"] = (
        f"[TEST] {aggregate_test_variables['quarter']}"
    )
    formats = [
        (
            "hospital_target_pending",
            HOSPITAL_TEMPLATE_KEY,
            {
                **report_variables(pending_report, recipient),
                "hospital_name": (
                    f"[TEST - Target Pending] "
                    f"{html.escape(pending_report.hospital_name)}"
                ),
            },
        ),
        (
            "hospital_target_achieved",
            HOSPITAL_TEMPLATE_KEY,
            {
                **report_variables(achieved_report, recipient),
                "hospital_name": (
                    f"[TEST - Target Achieved] "
                    f"{html.escape(achieved_report.hospital_name)}"
                ),
            },
        ),
        (
            "all_hospitals_summary",
            AGGREGATE_TEMPLATE_KEY,
            aggregate_test_variables,
        ),
        (
            "delivery_failure_alert",
            FAILURE_TEMPLATE_KEY,
            {
                "report_type": "Hospital (format test)",
                "hospital_name": f"[TEST] {html.escape(report.hospital_name)}",
                "intended_recipient": "sample-recipient@hospital.example",
                "report_date": report_date.strftime("%d %B %Y"),
                "attempt_count": max(settings.REMINDER_MAX_DELIVERY_ATTEMPTS, 1),
                "last_error": (
                    "Template test only: sample delivery failure. "
                    "No hospital email failed."
                ),
            },
        ),
    ]

    results = []
    for format_name, template_key, variables in formats:
        if dry_run:
            results.append({
                "format": format_name,
                "recipient": recipient.email,
                "status": "dry_run",
            })
            continue
        try:
            send_template_email(
                db,
                template_key,
                recipient.email,
                variables,
                reply_to=settings.REMINDER_REPLY_TO or None,
                from_email=settings.REMINDER_FROM_EMAIL,
                include_configured_cc=False,
                raise_on_error=True,
            )
            results.append({
                "format": format_name,
                "recipient": recipient.email,
                "status": "sent",
            })
        except Exception as exc:
            logger.exception(
                "Reminder format test failed (format=%s, recipient=%s)",
                format_name,
                recipient.email,
            )
            results.append({
                "format": format_name,
                "recipient": recipient.email,
                "status": "failed",
                "error": str(exc)[:500],
            })
    return results


def _delivery_key(
    report_type: str,
    report_date: date,
    recipient_email: str,
    hospital_id: Optional[str],
    unique_attempt: bool,
    idempotency_period: Optional[str] = None,
) -> str:
    period = idempotency_period or report_date.isoformat()
    key = f"{report_type}:{hospital_id or 'all'}:{period}:{recipient_email.lower()}"
    return f"{key}:{uuid.uuid4().hex}" if unique_attempt else key


def _idempotency_period(as_of: datetime, interval_minutes: int) -> Optional[str]:
    if interval_minutes <= 0:
        return None
    elapsed_minutes = int(
        (as_of - datetime(1970, 1, 1)).total_seconds() // 60
    )
    return f"pilot-{interval_minutes}m-{elapsed_minutes // interval_minutes}"


def _set_log_metrics(log: ReminderEmailLog, reports: list[ReminderReport]) -> None:
    log.lifetime_data_points = sum(report.lifetime_data_points for report in reports)
    log.data_points = sum(report.data_points for report in reports)
    log.assessments_submitted = sum(report.assessments_submitted for report in reports)
    log.pending_submissions = sum(report.pending_submissions for report in reports)
    log.quarterly_target = (
        reports[0].quarterly_target if len(reports) == 1
        else sum(report.quarterly_target for report in reports)
    )
    log.missing_consent = sum(report.missing_consent for report in reports)
    log.missing_questionnaire_sessions = sum(report.missing_questionnaire_sessions for report in reports)
    log.incomplete_assessments = sum(report.incomplete_assessments for report in reports)
    log.missing_mammogram_views = sum(report.missing_mammogram_views for report in reports)
    log.missing_birads = sum(report.missing_birads for report in reports)
    log.missing_density = sum(report.missing_density for report in reports)
    log.missing_mammogram_reports = sum(report.missing_mammogram_reports for report in reports)
    log.mammogram_quality_flags = sum(report.mammogram_quality_flags for report in reports)


def _delivery_log(
    db: Session,
    report_type: str,
    report_date: date,
    quarter_start: date,
    quarter_end: date,
    recipient: ReminderRecipient,
    reports: list[ReminderReport],
    hospital_id: Optional[str],
    dry_run: bool,
    force: bool,
    idempotency_period: Optional[str] = None,
) -> tuple[ReminderEmailLog, bool]:
    idempotency_key = _delivery_key(
        report_type,
        report_date,
        recipient.email,
        hospital_id,
        unique_attempt=dry_run or force,
        idempotency_period=idempotency_period,
    )
    existing = db.query(ReminderEmailLog).filter(
        ReminderEmailLog.idempotency_key == idempotency_key
    ).first()
    if existing and existing.status == "sent":
        return existing, False
    max_attempts = max(settings.REMINDER_MAX_DELIVERY_ATTEMPTS, 1)
    if (
        existing
        and existing.status == "failed"
        and (existing.attempt_count or 0) >= max_attempts
    ):
        return existing, False
    log = existing or ReminderEmailLog(
        report_type=report_type,
        hospital_id=hospital_id,
        recipient_email=recipient.email,
        idempotency_key=idempotency_key,
        report_date=report_date,
        quarter_start=quarter_start,
        quarter_end=quarter_end,
        data_points=0,
        lifetime_data_points=0,
        assessments_submitted=0,
        pending_submissions=0,
        quarterly_target=0,
        status="pending",
    )
    if not existing:
        db.add(log)
    _set_log_metrics(log, reports)
    log.attempt_count = (log.attempt_count or 0) + (0 if dry_run else 1)
    return log, True


def _notify_exhausted_delivery(
    db: Session,
    log: ReminderEmailLog,
    variables: dict,
) -> None:
    if log.failure_notified_at or not settings.REMINDER_FAILURE_RECIPIENT_EMAIL.strip():
        return
    max_attempts = max(settings.REMINDER_MAX_DELIVERY_ATTEMPTS, 1)
    if log.status != "failed" or (log.attempt_count or 0) < max_attempts:
        return

    recipient = settings.REMINDER_FAILURE_RECIPIENT_EMAIL.strip().lower()
    hospital_name = variables.get("hospital_name") or "All hospitals"
    try:
        send_template_email(
            db,
            FAILURE_TEMPLATE_KEY,
            recipient,
            {
                "report_type": html.escape(log.report_type.title()),
                "hospital_name": hospital_name,
                "intended_recipient": html.escape(log.recipient_email),
                "report_date": log.report_date.strftime("%d %B %Y"),
                "attempt_count": log.attempt_count,
                "last_error": html.escape(log.error_message or "Unknown delivery error"),
            },
            reply_to=settings.REMINDER_REPLY_TO or None,
            from_email=settings.REMINDER_FROM_EMAIL,
            include_configured_cc=False,
            raise_on_error=True,
        )
        log.failure_notified_at = datetime.now(
            ZoneInfo(settings.REMINDER_TIMEZONE)
        ).replace(tzinfo=None)
        log.failure_notification_error = None
    except Exception as exc:
        log.failure_notification_error = str(exc)[:2000]
        logger.exception(
            "Failed to notify %s about exhausted reminder delivery %s",
            recipient,
            log.id,
        )
    db.commit()


def _send_delivery(
    db: Session,
    log: ReminderEmailLog,
    should_send: bool,
    template_key: str,
    variables: dict,
    dry_run: bool,
) -> ReminderEmailLog:
    if not should_send:
        _notify_exhausted_delivery(db, log, variables)
        return log
    if dry_run:
        log.status = "dry_run"
        db.commit()
        db.refresh(log)
        return log
    try:
        send_template_email(
            db,
            template_key,
            log.recipient_email,
            variables,
            reply_to=settings.REMINDER_REPLY_TO or None,
            from_email=settings.REMINDER_FROM_EMAIL,
            cc=reminder_cc_recipients(),
            include_configured_cc=False,
            raise_on_error=True,
        )
        log.status = "sent"
        log.sent_at = datetime.now(ZoneInfo(settings.REMINDER_TIMEZONE)).replace(tzinfo=None)
        log.error_message = None
    except Exception as exc:
        log.status = "failed"
        log.error_message = str(exc)[:2000]
        logger.exception(
            "Reminder delivery failed (type=%s, hospital=%s, recipient=%s)",
            log.report_type,
            log.hospital_id,
            log.recipient_email,
        )
    db.commit()
    db.refresh(log)
    _notify_exhausted_delivery(db, log, variables)
    db.refresh(log)
    return log


def send_report(
    db: Session,
    report: ReminderReport,
    recipient: ReminderRecipient,
    dry_run: bool = False,
    force: bool = False,
    idempotency_period: Optional[str] = None,
) -> ReminderEmailLog:
    log, should_send = _delivery_log(
        db,
        "hospital",
        report.report_date,
        report.quarter_start,
        report.quarter_end,
        recipient,
        [report],
        report.hospital_id,
        dry_run,
        force,
        idempotency_period,
    )
    return _send_delivery(
        db,
        log,
        should_send,
        HOSPITAL_TEMPLATE_KEY,
        report_variables(report, recipient),
        dry_run,
    )


def send_aggregate_report(
    db: Session,
    reports: list[ReminderReport],
    report_date: date,
    recipient: ReminderRecipient,
    dry_run: bool = False,
    force: bool = False,
    idempotency_period: Optional[str] = None,
) -> ReminderEmailLog:
    quarter_start, quarter_end = quarter_bounds(report_date)
    log, should_send = _delivery_log(
        db,
        "aggregate",
        report_date,
        quarter_start,
        quarter_end,
        recipient,
        reports,
        None,
        dry_run,
        force,
        idempotency_period,
    )
    return _send_delivery(
        db,
        log,
        should_send,
        AGGREGATE_TEMPLATE_KEY,
        aggregate_variables(reports, report_date, recipient),
        dry_run,
    )


def _all_hospitals(db: Session) -> list[Hospital]:
    excluded = {name.lower() for name in _csv_values(settings.REMINDER_EXCLUDED_HOSPITALS)}
    return [
        hospital for hospital in db.query(Hospital).order_by(Hospital.name).all()
        if hospital.name.lower() not in excluded
    ]


def build_reports(
    db: Session,
    questionnaire_db: Session,
    report_date: date,
    hospital_id: Optional[str] = None,
) -> list[ReminderReport]:
    hospitals = _all_hospitals(db)
    if hospital_id:
        hospitals = [hospital for hospital in hospitals if hospital.id == hospital_id]
    return [build_report(db, questionnaire_db, hospital, report_date) for hospital in hospitals]


def is_delivery_paused(db: Session) -> bool:
    configuration = db.query(ReminderConfiguration).filter(ReminderConfiguration.id == 1).first()
    return bool(configuration and configuration.is_paused)


def is_delivery_disabled(db: Session) -> bool:
    configuration = db.query(ReminderConfiguration).filter(ReminderConfiguration.id == 1).first()
    return bool(configuration and configuration.is_disabled)


def set_delivery_paused(db: Session, paused: bool, updated_by: str) -> ReminderConfiguration:
    configuration = db.query(ReminderConfiguration).filter(ReminderConfiguration.id == 1).first()
    if not configuration:
        configuration = ReminderConfiguration(id=1)
        db.add(configuration)
    configuration.is_paused = paused
    configuration.updated_by = updated_by.lower()
    configuration.updated_at = datetime.now(ZoneInfo(settings.REMINDER_TIMEZONE)).replace(tzinfo=None)
    db.commit()
    db.refresh(configuration)
    return configuration


def set_delivery_disabled(db: Session, disabled: bool, updated_by: str) -> ReminderConfiguration:
    configuration = db.query(ReminderConfiguration).filter(ReminderConfiguration.id == 1).first()
    if not configuration:
        configuration = ReminderConfiguration(id=1)
        db.add(configuration)
    configuration.is_disabled = disabled
    configuration.updated_by = updated_by.lower()
    configuration.updated_at = datetime.now(ZoneInfo(settings.REMINDER_TIMEZONE)).replace(tzinfo=None)
    db.commit()
    db.refresh(configuration)
    return configuration


def cleanup_delivery_logs(db: Session, as_of: datetime) -> int:
    cutoff = as_of - timedelta(days=settings.REMINDER_LOG_RETENTION_DAYS)
    deleted = db.query(ReminderEmailLog).filter(ReminderEmailLog.created_at < cutoff).delete(
        synchronize_session=False
    )
    db.commit()
    return deleted


def run_reminders(
    db: Session,
    questionnaire_db: Session,
    report_date: Optional[date] = None,
    hospital_id: Optional[str] = None,
    dry_run: bool = False,
    force: bool = False,
    include_aggregate: Optional[bool] = None,
    aggregate_only: bool = False,
) -> List[ReminderEmailLog]:
    if report_date is None:
        now = datetime.now(ZoneInfo(settings.REMINDER_TIMEZONE)).replace(tzinfo=None)
        report_date = now.date()
        due_as_of = now
    else:
        due_as_of = datetime.combine(report_date, time.min)
    if aggregate_only:
        include_aggregate = True
    elif include_aggregate is None:
        include_aggregate = hospital_id is None

    cleanup_delivery_logs(db, due_as_of)
    idempotency_period = _idempotency_period(
        due_as_of,
        settings.REMINDER_INTERVAL_MINUTES,
    )
    all_reports = build_reports(
        db,
        questionnaire_db,
        report_date,
        hospital_id=hospital_id if hospital_id and not include_aggregate else None,
    )
    if aggregate_only:
        delivery_reports = []
    else:
        delivery_reports = (
            [report for report in all_reports if report.hospital_id == hospital_id]
            if hospital_id
            else all_reports
        )

    results: list[ReminderEmailLog] = []
    for report in delivery_reports:
        recipients = hospital_recipients(db, report.hospital_id)
        if not recipients:
            logger.warning("No active PinkShield AI users for hospital %s", report.hospital_id)
        for recipient in recipients:
            if not force and not is_due(
                db,
                report.hospital_id,
                due_as_of,
                settings.REMINDER_INTERVAL_DAYS,
                settings.REMINDER_INTERVAL_MINUTES,
                recipient.email,
                "hospital",
            ):
                continue
            results.append(send_report(
                db,
                report,
                recipient,
                dry_run=dry_run,
                force=force,
                idempotency_period=idempotency_period,
            ))

    if include_aggregate and all_reports:
        for recipient in aggregate_recipients():
            if not force and not is_due(
                db,
                None,
                due_as_of,
                settings.REMINDER_INTERVAL_DAYS,
                settings.REMINDER_INTERVAL_MINUTES,
                recipient.email,
                "aggregate",
            ):
                continue
            results.append(send_aggregate_report(
                db,
                all_reports,
                report_date,
                recipient,
                dry_run=dry_run,
                force=force,
                idempotency_period=idempotency_period,
            ))
    return results
