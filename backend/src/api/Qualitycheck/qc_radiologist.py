from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import text
from typing import List

from ...db.session import get_db, get_questionnaire_db
from ...models.models import DoctorAssessment
from ...schemas.schemas import PatientSessionListItem, PatientSessionDetail

# Reuse existing doctor-endpoint logic instead of duplicating it
from ..doctor import _get_attachment_flags, _Q_TEXT_MAP

from ...db.Qualitycheck.qc_session import get_qc_db
from ...models.Qualitycheck.qc_models import QcAssignment, QcDoctorAssessment
from .qc_admin import get_current_qc_user

router = APIRouter()


@router.get("/radiologist/{user_id}/subjects", response_model=List[PatientSessionListItem])
def get_radiologist_subjects(
    user_id: int,
    qc_db: Session = Depends(get_qc_db),
    q_db: Session = Depends(get_questionnaire_db),
    app_db: Session = Depends(get_db),
    _current=Depends(get_current_qc_user),
):
    assignment_rows = (
        qc_db.query(QcAssignment, QcDoctorAssessment)
        .join(QcDoctorAssessment, QcAssignment.qc_assessment_id == QcDoctorAssessment.qc_id)
        .filter(QcAssignment.qc_radiologist_id == user_id)
        .all()
    )

    session_ids = [
        qda.qc_patient_session_id
        for _assignment, qda in assignment_rows
        if qda.qc_patient_session_id
    ]
    if not session_ids:
        return []

    rows = q_db.execute(text("""
        SELECT s.session_id, s.session_start_time, s.snehita_lifetime_risk,
               pid.answer AS patient_id, s.risk_category,
               hosp.answer AS hospital_name
        FROM session_table s
        LEFT JOIN (
            SELECT session_id, MIN(answer) AS answer
            FROM session_data_table
            WHERE question IN ('Institute Name', 'Institute Name:',
                               'Enter the Hospital ID(If any, else leave):', 'Q45')
            GROUP BY session_id
        ) hosp ON s.session_id = hosp.session_id
        LEFT JOIN (
            SELECT session_id, MIN(answer) AS answer
            FROM session_data_table
            WHERE question IN ('Enter your Patient ID(if any, else leave):',
                               'Enter your subject ID:', 'Q44')
            GROUP BY session_id
        ) pid ON s.session_id = pid.session_id
        WHERE s.session_id IN :session_ids
        ORDER BY s.session_start_time DESC
    """), {"session_ids": tuple(session_ids)}).fetchall()

    result = []
    for row in rows:
        session_id = row[0]
        assessment = app_db.query(DoctorAssessment).filter(
            DoctorAssessment.patient_session_id == session_id
        ).options(joinedload(DoctorAssessment.attachments)).first()

        flags = _get_attachment_flags(assessment)
        result.append({
            "id": session_id,
            "patient_id": row[3] or "",
            "hospital_name": row[5] or None,
            "consent_scanned_url": None,
            "consent_timestamp": row[1],
            "snehita_risk": row[2],
            "risk_category": row[4] or "",
            **flags,
        })

    return result


@router.get("/radiologist/{user_id}/subjects/{session_id}", response_model=PatientSessionDetail)
def get_radiologist_subject_detail(
    user_id: int,
    session_id: str,
    qc_db: Session = Depends(get_qc_db),
    q_db: Session = Depends(get_questionnaire_db),
    app_db: Session = Depends(get_db),
    _current=Depends(get_current_qc_user),
):
    # Authorization: this subject must actually be assigned to this radiologist.
    # (The doctor endpoint doesn't need this check — it scopes by hospital instead —
    # but here a radiologist could otherwise guess arbitrary session IDs.)
    is_assigned = (
        qc_db.query(QcAssignment)
        .join(QcDoctorAssessment, QcAssignment.qc_assessment_id == QcDoctorAssessment.qc_id)
        .filter(
            QcAssignment.qc_radiologist_id == user_id,
            QcDoctorAssessment.qc_patient_session_id == session_id,
        )
        .first()
    )
    if not is_assigned:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Subject not assigned to this user")

    session_row = q_db.execute(text(
        "SELECT session_id, session_start_time, snehita_lifetime_risk, risk_category "
        "FROM session_table WHERE session_id = :sid"
    ), {"sid": session_id}).fetchone()

    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found")

    patient_id_row = q_db.execute(text(
        "SELECT answer FROM session_data_table WHERE session_id = :sid "
        "AND question IN ('Enter your Patient ID(if any, else leave):', 'Enter your subject ID:', 'Q44') LIMIT 1"
    ), {"sid": session_id}).fetchone()

    response_rows = q_db.execute(text(
        "SELECT session_data_id, question, answer, created_at FROM session_data_table "
        "WHERE session_id = :sid ORDER BY created_at ASC"
    ), {"sid": session_id}).fetchall()

    responses = []
    for r in response_rows:
        raw_question = r[1] or ""
        responses.append({
            "id": abs(hash(r[0])) % 2147483647,
            "question": _Q_TEXT_MAP.get(raw_question, raw_question),
            "answer": r[2] or "",
            "created_at": r[3],
        })

    assessment = app_db.query(DoctorAssessment).filter(
        DoctorAssessment.patient_session_id == session_id
    ).options(joinedload(DoctorAssessment.attachments)).first()

    flags = _get_attachment_flags(assessment)

    return {
        "id": session_id,
        "patient_id": (patient_id_row[0] if patient_id_row else "") or "",
        "consent_scanned_url": None,
        "consent_timestamp": session_row[1],
        "snehita_risk": session_row[2],
        "risk_category": session_row[3] or "",
        "responses": responses,
        "assessment": assessment,
        **flags,
    }