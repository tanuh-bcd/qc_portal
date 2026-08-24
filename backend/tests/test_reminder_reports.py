from datetime import date, datetime, timedelta

from sqlalchemy import bindparam, text

from backend.src.models.models import (
    Attachment,
    DoctorAssessment,
    Hospital,
    PatientSession,
    ReminderEmailLog,
    User,
)
from backend.src.services import reminder_reports
from backend.src.services.reminder_reports import (
    ReminderRecipient,
    aggregate_recipients,
    build_report,
    build_reports,
    hospital_recipients,
    is_due,
    quarter_bounds,
    reminder_cc_recipients,
    report_variables,
    run_reminders,
    send_report,
    send_template_test_suite,
)
from backend.tests.conftest import TestQSession, TestSession


def add_questionnaire_session(
    q_db,
    session_id,
    hospital_name,
    submitted_at,
    *,
    questionnaire_complete=True,
    consent_url=None,
    blank_answer=False,
):
    q_db.execute(text("""
        INSERT INTO session_table
            (session_id, session_start_time, session_end_time,
             snehita_lifetime_risk, risk_category, consent_url)
        VALUES (:session_id, :submitted_at, :submitted_at,
                :risk, 'Evident Risk', :consent_url)
    """), {
        "session_id": session_id,
        "submitted_at": submitted_at.isoformat(),
        "risk": "0.5" if questionnaire_complete else None,
        "consent_url": consent_url,
    })
    q_db.execute(text("""
        INSERT INTO session_data_table
            (session_data_id, session_id, question, answer, created_at)
        VALUES (:row_id, :session_id, 'Q45', :hospital_name, :submitted_at)
    """), {
        "row_id": f"{session_id}-hospital",
        "session_id": session_id,
        "hospital_name": hospital_name,
        "submitted_at": submitted_at.isoformat(),
    })
    if blank_answer:
        q_db.execute(text("""
            INSERT INTO session_data_table
                (session_data_id, session_id, question, answer, created_at)
            VALUES (:row_id, :session_id, 'Q1', '', :submitted_at)
        """), {
            "row_id": f"{session_id}-blank",
            "session_id": session_id,
            "submitted_at": submitted_at.isoformat(),
        })
    q_db.commit()


def delete_questionnaire_sessions(q_db, session_ids):
    statement = text("DELETE FROM session_data_table WHERE session_id IN :ids").bindparams(
        bindparam("ids", expanding=True)
    )
    q_db.execute(statement, {"ids": session_ids})
    statement = text("DELETE FROM session_table WHERE session_id IN :ids").bindparams(
        bindparam("ids", expanding=True)
    )
    q_db.execute(statement, {"ids": session_ids})
    q_db.commit()


def cleanup_sessions(db, q_db, session_ids):
    delete_questionnaire_sessions(q_db, session_ids)
    assessment_ids = [row[0] for row in db.query(DoctorAssessment.id).filter(
        DoctorAssessment.patient_session_id.in_(session_ids)
    ).all()]
    if assessment_ids:
        db.query(Attachment).filter(
            Attachment.assessment_id.in_(assessment_ids)
        ).delete(synchronize_session=False)
    db.query(DoctorAssessment).filter(
        DoctorAssessment.patient_session_id.in_(session_ids)
    ).delete(synchronize_session=False)
    db.query(PatientSession).filter(PatientSession.id.in_(session_ids)).delete(
        synchronize_session=False
    )
    db.commit()


def add_assessment(db, doctor, hospital, session_id, complete=True):
    assessment = DoctorAssessment(
        patient_session_id=session_id,
        hospital_id=hospital.id,
        doctor_id=doctor.id,
        mammo_birads="2",
        mammo_density="B",
        us_biopsy_birads="2" if complete else None,
        us_biopsy_density="B" if complete else None,
        clinical_findings={"right": {"birads": "2", "density": "B"}},
        routine_views_uploaded=complete,
    )
    db.add(assessment)
    db.flush()
    view_types = (
        "mammo_cc_left",
        "mammo_cc_right",
        "mammo_mlo_left",
        "mammo_mlo_right",
    ) if complete else (
        "mammo_cc_left",
        "mammo_cc_right",
        "mammo_mlo_left",
    )
    attachment_types = list(view_types) + (["mammo_reading"] if complete else [])
    db.add_all([
        Attachment(
            assessment_id=assessment.id,
            file_type=file_type,
            file_name=f"{file_type}.dcm",
            storage_url=f"gs://test/{file_type}.dcm",
        )
        for file_type in attachment_types
    ])
    return assessment


def test_quarter_bounds():
    assert quarter_bounds(date(2026, 7, 21)) == (date(2026, 7, 1), date(2026, 10, 1))
    assert quarter_bounds(date(2026, 12, 31)) == (date(2026, 10, 1), date(2027, 1, 1))


def test_build_report_requires_all_five_data_point_components():
    db = TestSession()
    q_db = TestQSession()
    hospital = db.query(Hospital).filter(Hospital.id == "clinic_00001").one()
    doctor = db.query(User).filter(User.email == "doctor@test.com").one()
    session_ids = ["reminder-complete", "reminder-incomplete", "reminder-old"]
    try:
        db.add_all([
            PatientSession(id=session_id, hospital_id=hospital.id)
            for session_id in session_ids
        ])
        db.flush()
        add_questionnaire_session(
            q_db, session_ids[0], hospital.name, datetime(2026, 7, 2),
            consent_url="gs://test/consent-complete.pdf",
        )
        add_questionnaire_session(
            q_db, session_ids[1], hospital.name, datetime(2026, 8, 2),
            blank_answer=True,
        )
        add_questionnaire_session(
            q_db, session_ids[2], hospital.name, datetime(2026, 6, 30),
            consent_url="gs://test/consent-old.pdf",
        )
        add_assessment(db, doctor, hospital, session_ids[0], complete=True)
        add_assessment(db, doctor, hospital, session_ids[1], complete=False)
        add_assessment(db, doctor, hospital, session_ids[2], complete=True)
        db.commit()

        report = build_report(db, q_db, hospital, date(2026, 8, 10), target=200)
        assert report.lifetime_data_points == 2
        assert report.data_points == 1
        assert report.assessments_submitted == 2
        assert report.pending_submissions == 199
        assert report.current_quarter_records == 2
        assert report.missing_consent == 1
        assert report.missing_questionnaire_sessions == 0
        assert report.blank_questionnaire_sessions == 1
        assert report.missing_mammogram_views == 1
        assert report.missing_birads == 1
        assert report.missing_density == 1
        assert report.missing_mammogram_reports == 1
        assert report.mammogram_quality_flags == 1
        assert report.active_recipient_count == 3
        assert set(report.active_recipient_emails) == {
            "admin@test.com", "doctor@test.com", "staff@test.com"
        }
    finally:
        cleanup_sessions(db, q_db, session_ids)
        q_db.close()
        db.close()


def test_pending_never_goes_below_zero():
    db = TestSession()
    q_db = TestQSession()
    hospital = db.query(Hospital).filter(Hospital.id == "clinic_00001").one()
    doctor = db.query(User).filter(User.email == "doctor@test.com").one()
    session_ids = [f"over-target-{index}" for index in range(3)]
    try:
        db.add_all([PatientSession(id=session_id, hospital_id=hospital.id) for session_id in session_ids])
        db.flush()
        for session_id in session_ids:
            add_questionnaire_session(
                q_db, session_id, hospital.name, datetime(2026, 7, 2),
                consent_url=f"gs://test/{session_id}.pdf",
            )
            add_assessment(db, doctor, hospital, session_id, complete=True)
        db.commit()
        report = build_report(db, q_db, hospital, date(2026, 8, 10), target=2)
        assert report.data_points == 3
        assert report.pending_submissions == 0
        variables = report_variables(
            report,
            ReminderRecipient("doctor@test.com", "Doctor"),
        )
        assert variables["progress_percent"] == 100
        assert variables["goal_status_message"].startswith(
            "Minimum quarterly target achieved."
        )
    finally:
        cleanup_sessions(db, q_db, session_ids)
        q_db.close()
        db.close()


def test_report_uses_assessment_when_patient_session_parent_is_missing():
    db = TestSession()
    q_db = TestQSession()
    hospital = db.query(Hospital).filter(Hospital.id == "clinic_00001").one()
    doctor = db.query(User).filter(User.email == "doctor@test.com").one()
    session_id = "orphan-assessment"
    try:
        add_questionnaire_session(
            q_db,
            session_id,
            hospital.name,
            datetime(2026, 8, 12),
            consent_url="gs://test/orphan-consent.pdf",
        )
        add_assessment(db, doctor, hospital, session_id, complete=True)
        db.commit()

        report = build_report(db, q_db, hospital, date(2026, 8, 20), target=200)

        assert report.current_quarter_records == 1
        assert report.assessments_submitted == 1
        assert report.data_points == 1
        assert report.pending_submissions == 199
        assert report.missing_mammogram_views == 0
        assert report.missing_birads == 0
        assert report.missing_density == 0
    finally:
        cleanup_sessions(db, q_db, [session_id])
        q_db.close()
        db.close()


def test_hospital_reports_go_to_every_active_account(monkeypatch):
    db = TestSession()
    monkeypatch.setattr(reminder_reports.settings, "REMINDER_RECIPIENT_EMAIL", "")
    monkeypatch.setattr(
        reminder_reports.settings,
        "REMINDER_EXCLUDED_RECIPIENT_DOMAINS",
        "tanuh.ai",
    )
    internal_email = "internal.reviewer@TANUH.AI"
    try:
        existing_user = db.query(User).filter(User.email == "admin@test.com").one()
        db.add(User(
            email=internal_email,
            password_hash="not-used",
            hospital_id="clinic_00001",
            role_id=existing_user.role_id,
            is_active=True,
            full_name="Internal Reviewer",
        ))
        db.commit()
        recipients = hospital_recipients(db, "clinic_00001")
        assert {recipient.email for recipient in recipients} == {
            "admin@test.com", "doctor@test.com", "staff@test.com"
        }
    finally:
        db.query(User).filter(User.email == internal_email).delete(
            synchronize_session=False
        )
        db.commit()
        db.close()


def test_new_hospitals_are_automatically_included_in_reports():
    db = TestSession()
    q_db = TestQSession()
    hospital_id = "clinic_00999"
    try:
        db.add(Hospital(
            id=hospital_id,
            name="Newly Added Hospital",
            contact_person="New Contact",
            email="new-hospital@example.com",
        ))
        db.commit()

        reports = build_reports(db, q_db, date(2026, 8, 20))
        report_ids = {report.hospital_id for report in reports}

        assert hospital_id in report_ids
        assert "clinic_00001" in report_ids
        assert "clinic_00002" not in report_ids
    finally:
        db.query(Hospital).filter(Hospital.id == hospital_id).delete(
            synchronize_session=False
        )
        db.commit()
        q_db.close()
        db.close()


def test_aggregate_report_uses_approved_internal_distribution(monkeypatch):
    monkeypatch.setattr(reminder_reports.settings, "REMINDER_RECIPIENT_EMAIL", "")
    monkeypatch.setattr(
        reminder_reports.settings,
        "REMINDER_AGGREGATE_RECIPIENTS",
        (
            "ashwin.rajkumar@tanuh.ai,vaishnavi.joshi@tanuh.ai,"
            "palivela.sanjana@tanuh.ai,manisha.verma@tanuh.ai,"
            "bharath.tangella@tanuh.ai,phaneendra.yalavarthy@tanuh.ai"
        ),
    )

    assert [recipient.email for recipient in aggregate_recipients()] == [
        "ashwin.rajkumar@tanuh.ai",
        "vaishnavi.joshi@tanuh.ai",
        "palivela.sanjana@tanuh.ai",
        "manisha.verma@tanuh.ai",
        "bharath.tangella@tanuh.ai",
        "phaneendra.yalavarthy@tanuh.ai",
    ]


def test_reminder_cc_uses_approved_distribution_and_deduplicates(monkeypatch):
    monkeypatch.setattr(
        reminder_reports.settings,
        "REMINDER_CC_EMAILS",
        "bcs@tanuh.ai,BCS@TANUH.AI",
    )

    assert reminder_cc_recipients() == ["bcs@tanuh.ai"]


def test_pilot_override_replaces_hospital_and_aggregate_recipients(monkeypatch):
    db = TestSession()
    monkeypatch.setattr(
        reminder_reports.settings, "REMINDER_RECIPIENT_EMAIL", "manisha.verma@tanuh.ai"
    )
    try:
        assert [item.email for item in hospital_recipients(db, "clinic_00001")] == [
            "manisha.verma@tanuh.ai"
        ]
        assert [item.email for item in aggregate_recipients()] == ["manisha.verma@tanuh.ai"]
    finally:
        db.close()


def test_due_check_is_per_recipient_and_uses_last_successful_delivery():
    db = TestSession()
    report_date = date(2026, 8, 20)
    try:
        db.query(ReminderEmailLog).filter(
            ReminderEmailLog.hospital_id == "clinic_00001"
        ).delete(synchronize_session=False)
        db.add(ReminderEmailLog(
            report_type="hospital",
            hospital_id="clinic_00001",
            recipient_email="doctor@test.com",
            idempotency_key="due-check-doctor",
            report_date=date(2026, 8, 10),
            quarter_start=date(2026, 7, 1),
            quarter_end=date(2026, 10, 1),
            lifetime_data_points=10,
            data_points=10,
            assessments_submitted=8,
            pending_submissions=190,
            quarterly_target=200,
            status="sent",
            sent_at=datetime.combine(report_date - timedelta(days=13), datetime.min.time()),
        ))
        db.commit()
        assert is_due(
            db, "clinic_00001", report_date, 14,
            recipient_email="doctor@test.com",
        ) is False
        assert is_due(
            db, "clinic_00001", report_date, 14,
            recipient_email="admin@test.com",
        ) is True
    finally:
        db.query(ReminderEmailLog).filter(
            ReminderEmailLog.idempotency_key == "due-check-doctor"
        ).delete(synchronize_session=False)
        db.commit()
        db.close()


def test_due_check_supports_five_minute_pilot_interval():
    db = TestSession()
    as_of = datetime(2026, 8, 20, 9, 0)
    try:
        db.add(ReminderEmailLog(
            report_type="hospital",
            hospital_id="clinic_00001",
            recipient_email="manisha.verma@tanuh.ai",
            idempotency_key="five-minute-check",
            report_date=date(2026, 8, 20),
            quarter_start=date(2026, 7, 1),
            quarter_end=date(2026, 10, 1),
            lifetime_data_points=10,
            data_points=10,
            assessments_submitted=8,
            pending_submissions=190,
            quarterly_target=200,
            status="sent",
            sent_at=as_of - timedelta(minutes=4),
        ))
        db.commit()
        assert is_due(
            db, "clinic_00001", as_of, 14, interval_minutes=5,
            recipient_email="manisha.verma@tanuh.ai",
        ) is False
        log = db.query(ReminderEmailLog).filter(
            ReminderEmailLog.idempotency_key == "five-minute-check"
        ).one()
        log.sent_at = as_of - timedelta(minutes=5)
        db.commit()
        assert is_due(
            db, "clinic_00001", as_of, 14, interval_minutes=5,
            recipient_email="manisha.verma@tanuh.ai",
        ) is True
    finally:
        db.query(ReminderEmailLog).filter(
            ReminderEmailLog.idempotency_key == "five-minute-check"
        ).delete(synchronize_session=False)
        db.commit()
        db.close()


def test_send_report_records_success_and_prevents_duplicate(monkeypatch):
    db = TestSession()
    q_db = TestQSession()
    hospital = db.query(Hospital).filter(Hospital.id == "clinic_00001").one()
    report_date = date(2026, 9, 1)
    recipient = ReminderRecipient("doctor@test.com", "Doctor")
    calls = []
    monkeypatch.setattr(
        reminder_reports.settings,
        "REMINDER_CC_EMAILS",
        "bcs@tanuh.ai",
    )

    def fake_send(*args, **kwargs):
        calls.append((args, kwargs))
        return True

    monkeypatch.setattr(reminder_reports, "send_template_email", fake_send)
    try:
        db.query(ReminderEmailLog).filter(
            ReminderEmailLog.report_date == report_date,
            ReminderEmailLog.recipient_email == recipient.email,
        ).delete(synchronize_session=False)
        db.commit()
        report = build_report(db, q_db, hospital, report_date, target=200)
        first = send_report(db, report, recipient)
        second = send_report(db, report, recipient)
        assert first.status == "sent"
        assert first.sent_at is not None
        assert second.id == first.id
        assert len(calls) == 1
        assert calls[0][0][3]["pending_submissions"] == 200
        assert calls[0][1]["include_configured_cc"] is False
        assert calls[0][1]["from_email"] == "PinkShieldAI <breastcancerscreening@tanuh.ai>"
        assert calls[0][1]["cc"] == ["bcs@tanuh.ai"]
    finally:
        db.query(ReminderEmailLog).filter(
            ReminderEmailLog.report_date == report_date,
            ReminderEmailLog.recipient_email == recipient.email,
        ).delete(synchronize_session=False)
        db.commit()
        db.close()
        q_db.close()


def test_new_five_minute_period_can_send_another_pilot_email(monkeypatch):
    db = TestSession()
    q_db = TestQSession()
    hospital = db.query(Hospital).filter(Hospital.id == "clinic_00001").one()
    recipient = ReminderRecipient("manisha.verma@tanuh.ai", "Pilot Reviewer")
    report_date = date(2026, 9, 2)
    calls = []

    monkeypatch.setattr(
        reminder_reports,
        "send_template_email",
        lambda *args, **kwargs: calls.append((args, kwargs)) or True,
    )
    try:
        db.query(ReminderEmailLog).filter(
            ReminderEmailLog.report_date == report_date,
            ReminderEmailLog.recipient_email == recipient.email,
        ).delete(synchronize_session=False)
        db.commit()
        report = build_report(db, q_db, hospital, report_date, target=200)

        first = send_report(db, report, recipient, idempotency_period="pilot-5m-100")
        duplicate = send_report(db, report, recipient, idempotency_period="pilot-5m-100")
        next_period = send_report(db, report, recipient, idempotency_period="pilot-5m-101")

        assert first.status == "sent"
        assert duplicate.id == first.id
        assert next_period.id != first.id
        assert len(calls) == 2
    finally:
        db.query(ReminderEmailLog).filter(
            ReminderEmailLog.report_date == report_date,
            ReminderEmailLog.recipient_email == recipient.email,
        ).delete(synchronize_session=False)
        db.commit()
        db.close()
        q_db.close()


def test_failure_notification_is_sent_after_initial_attempt_and_two_retries(monkeypatch):
    db = TestSession()
    q_db = TestQSession()
    hospital = db.query(Hospital).filter(Hospital.id == "clinic_00001").one()
    recipient = ReminderRecipient("doctor@test.com", "Doctor")
    report_date = date(2026, 9, 3)
    calls = []

    def fake_send(*args, **kwargs):
        template_key = args[1]
        calls.append((template_key, args[2], args[3], kwargs))
        if template_key == reminder_reports.FAILURE_TEMPLATE_KEY:
            return True
        raise RuntimeError("test SMTP delivery failure")

    monkeypatch.setattr(reminder_reports, "send_template_email", fake_send)
    monkeypatch.setattr(
        reminder_reports.settings,
        "REMINDER_FAILURE_RECIPIENT_EMAIL",
        "vaishnavi.joshi@tanuh.ai",
    )
    monkeypatch.setattr(
        reminder_reports.settings,
        "REMINDER_MAX_DELIVERY_ATTEMPTS",
        3,
    )
    try:
        db.query(ReminderEmailLog).filter(
            ReminderEmailLog.report_date == report_date,
            ReminderEmailLog.recipient_email == recipient.email,
        ).delete(synchronize_session=False)
        db.commit()
        report = build_report(db, q_db, hospital, report_date, target=200)

        send_report(db, report, recipient)
        send_report(db, report, recipient)
        exhausted = send_report(db, report, recipient)
        repeated = send_report(db, report, recipient)

        assert exhausted.id == repeated.id
        assert exhausted.status == "failed"
        assert exhausted.attempt_count == 3
        assert exhausted.failure_notified_at is not None
        assert exhausted.failure_notification_error is None
        assert [call[0] for call in calls].count(
            reminder_reports.HOSPITAL_TEMPLATE_KEY
        ) == 3
        failure_calls = [
            call for call in calls
            if call[0] == reminder_reports.FAILURE_TEMPLATE_KEY
        ]
        assert len(failure_calls) == 1
        assert failure_calls[0][1] == "vaishnavi.joshi@tanuh.ai"
        assert failure_calls[0][2]["attempt_count"] == 3
        assert "cc" not in failure_calls[0][3]
    finally:
        db.query(ReminderEmailLog).filter(
            ReminderEmailLog.report_date == report_date,
            ReminderEmailLog.recipient_email == recipient.email,
        ).delete(synchronize_session=False)
        db.commit()
        db.close()
        q_db.close()


def test_aggregate_only_sends_one_summary_to_pilot_override(monkeypatch):
    db = TestSession()
    q_db = TestQSession()
    report_date = date(2026, 9, 4)
    calls = []
    monkeypatch.setattr(
        reminder_reports.settings,
        "REMINDER_CC_EMAILS",
        "bcs@tanuh.ai",
    )

    monkeypatch.setattr(
        reminder_reports.settings,
        "REMINDER_RECIPIENT_EMAIL",
        "manisha.verma@tanuh.ai",
    )
    monkeypatch.setattr(
        reminder_reports,
        "send_template_email",
        lambda *args, **kwargs: calls.append((args, kwargs)) or True,
    )
    try:
        db.query(ReminderEmailLog).filter(
            ReminderEmailLog.report_date == report_date,
            ReminderEmailLog.recipient_email == "manisha.verma@tanuh.ai",
        ).delete(synchronize_session=False)
        db.commit()

        results = run_reminders(
            db,
            q_db,
            report_date=report_date,
            aggregate_only=True,
        )

        assert len(results) == 1
        assert results[0].report_type == "aggregate"
        assert results[0].hospital_id is None
        assert results[0].recipient_email == "manisha.verma@tanuh.ai"
        assert results[0].status == "sent"
        assert len(calls) == 1
        assert calls[0][0][1] == reminder_reports.AGGREGATE_TEMPLATE_KEY
        assert calls[0][1]["cc"] == ["bcs@tanuh.ai"]
    finally:
        db.query(ReminderEmailLog).filter(
            ReminderEmailLog.report_date == report_date,
            ReminderEmailLog.recipient_email == "manisha.verma@tanuh.ai",
        ).delete(synchronize_session=False)
        db.commit()
        db.close()
        q_db.close()


def test_template_test_suite_sends_all_formats_without_delivery_logs(monkeypatch):
    db = TestSession()
    q_db = TestQSession()
    calls = []

    monkeypatch.setattr(
        reminder_reports.settings,
        "REMINDER_RECIPIENT_EMAIL",
        "manisha.verma@tanuh.ai",
    )
    monkeypatch.setattr(
        reminder_reports,
        "send_template_email",
        lambda *args, **kwargs: calls.append((args, kwargs)) or True,
    )
    try:
        initial_log_count = db.query(ReminderEmailLog).count()
        results = send_template_test_suite(
            db,
            q_db,
            hospital_id="clinic_00001",
        )

        assert [result["format"] for result in results] == [
            "hospital_target_pending",
            "hospital_target_achieved",
            "all_hospitals_summary",
            "delivery_failure_alert",
        ]
        assert all(result["status"] == "sent" for result in results)
        assert all(
            result["recipient"] == "manisha.verma@tanuh.ai"
            for result in results
        )
        assert len(calls) == 4
        assert [call[0][1] for call in calls] == [
            reminder_reports.HOSPITAL_TEMPLATE_KEY,
            reminder_reports.HOSPITAL_TEMPLATE_KEY,
            reminder_reports.AGGREGATE_TEMPLATE_KEY,
            reminder_reports.FAILURE_TEMPLATE_KEY,
        ]
        assert all("cc" not in call[1] for call in calls)
        assert db.query(ReminderEmailLog).count() == initial_log_count
    finally:
        db.close()
        q_db.close()


def test_template_test_suite_dry_run_does_not_call_smtp(monkeypatch):
    db = TestSession()
    q_db = TestQSession()
    calls = []

    monkeypatch.setattr(
        reminder_reports.settings,
        "REMINDER_RECIPIENT_EMAIL",
        "manisha.verma@tanuh.ai",
    )
    monkeypatch.setattr(
        reminder_reports,
        "send_template_email",
        lambda *args, **kwargs: calls.append((args, kwargs)) or True,
    )
    try:
        results = send_template_test_suite(
            db,
            q_db,
            hospital_id="clinic_00001",
            dry_run=True,
        )

        assert len(results) == 4
        assert all(result["status"] == "dry_run" for result in results)
        assert calls == []
    finally:
        db.close()
        q_db.close()
