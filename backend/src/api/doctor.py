import json
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import text
from ..db.session import get_db, get_questionnaire_db
from ..models.models import DoctorAssessment, Attachment, Hospital
from ..schemas.schemas import PatientSessionListItem, PatientSessionDetail
from .auth import get_current_user
from typing import Dict, List

router = APIRouter()

_qpath = Path(__file__).resolve().parent / "questionnaire_en.json"
_Q_TEXT_MAP: Dict[str, str] = {}
if _qpath.exists():
    with open(_qpath, encoding="utf-8") as _f:
        _Q_TEXT_MAP = {k: v.get("question", k) for k, v in json.load(_f).get("questions", {}).items()}

INSTITUTE_QUESTIONS = (
    "Institute Name",
    "Institute Name:",
    "Enter the Hospital ID(If any, else leave):",
    "Q45",
)


def _get_hospital_name(app_db, hospital_id):
    hospital = app_db.query(Hospital).filter(Hospital.id == hospital_id).first()
    return hospital.name if hospital else None


def _get_attachment_flags(assessment):
    att_types = set()
    if assessment:
        for att in assessment.attachments:
            att_types.add(att.file_type)

    all_4_mammo = all(t in att_types for t in ('mammo_cc_left', 'mammo_cc_right', 'mammo_mlo_left', 'mammo_mlo_right'))
    has_mammo_reading = 'mammo_reading' in att_types
    has_us_video = 'us_video' in att_types
    has_us_reading = 'us_reading' in att_types

    smr = all_4_mammo and has_us_reading and not has_mammo_reading and not has_us_video

    return {
        "has_assessment": assessment is not None,
        "has_mammo_dicom": all_4_mammo,
        "has_mammo_reading": "SMR" if smr else ("Yes" if has_mammo_reading else ""),
        "has_us_video": "SMR" if smr else ("Yes" if has_us_video else ""),
        "has_us_reading": "SMR" if smr else ("Yes" if has_us_reading else ""),
        "has_biopsy": 'biopsy_reading' in att_types,
        "has_annotations": any(t.startswith('annot_') for t in att_types),
        "has_additional_docs": any(t.startswith('additional_') for t in att_types),
    }


@router.get("/hospital-summary")
def get_hospital_summary(
    q_db: Session = Depends(get_questionnaire_db),
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    is_super_viewer = current_user.get("is_super_viewer", False) or \
        current_user.get("email", "").lower().endswith("@tanuh.ai")
    if not is_super_viewer:
        raise HTTPException(status_code=403, detail="Not authorized")

    hospitals = app_db.query(Hospital).filter(
        ~Hospital.name.in_(('Test', 'Tanuh Foundation'))
    ).order_by(Hospital.name).all()
    if not hospitals:
        return []

    valid_names = [h.name for h in hospitals]
    params = {"inst_questions": INSTITUTE_QUESTIONS, "valid_names": tuple(valid_names)}

    session_hosp_rows = q_db.execute(text("""
        SELECT s.session_id, sd_inst.answer AS hospital_name
        FROM session_table s
        JOIN (
            SELECT session_id, MIN(answer) AS answer
            FROM session_data_table
            WHERE question IN :inst_questions
              AND answer IN :valid_names
            GROUP BY session_id
        ) sd_inst ON s.session_id = sd_inst.session_id
        WHERE s.snehita_lifetime_risk IS NOT NULL
    """), params).fetchall()

    subject_counts = {}
    hospital_by_session = {}
    for row in session_hosp_rows:
        sid, hname = row[0], row[1]
        subject_counts[hname] = subject_counts.get(hname, 0) + 1
        hospital_by_session[sid] = hname

    assessment_counts = {}
    all_ids = list(hospital_by_session.keys())
    if all_ids:
        assessed_rows = app_db.query(DoctorAssessment.patient_session_id).filter(
            DoctorAssessment.patient_session_id.in_(all_ids)
        ).all()
        for r in assessed_rows:
            hname = hospital_by_session.get(r[0])
            if hname:
                assessment_counts[hname] = assessment_counts.get(hname, 0) + 1

    result = []
    for h in hospitals:
        result.append({
            "hospital_name": h.name,
            "short_name": h.short_name,
            "state": h.state,
            "subject_count": subject_counts.get(h.name, 0),
            "assessment_count": assessment_counts.get(h.name, 0),
        })

    return result


SORT_COLUMN_MAP = {
    "date": "s.session_start_time",
    "risk": "FIELD(s.risk_category, 'Baseline Risk', 'Evident Risk', 'Significant Risk', 'High Risk')",
    "assessment": None,
}


def _build_order_clause(sort_param):
    if not sort_param:
        return "s.session_start_time DESC"

    clauses = []
    for part in sort_param.split(","):
        part = part.strip()
        if ":" in part:
            key, direction = part.split(":", 1)
        else:
            key, direction = part, "asc"

        key = key.strip().lower()
        direction = direction.strip().upper()
        if direction not in ("ASC", "DESC"):
            direction = "ASC"

        col = SORT_COLUMN_MAP.get(key)
        if col:
            clauses.append(f"{col} {direction}")

    return ", ".join(clauses) if clauses else "s.session_start_time DESC"


@router.get("/sessions", response_model=List[PatientSessionListItem])
def get_patient_sessions(
    sort: str = None,
    hospital_name: str = None,
    q_db: Session = Depends(get_questionnaire_db),
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    is_super_viewer = current_user.get("is_super_viewer", False) or \
        current_user.get("email", "").lower().endswith("@tanuh.ai")
    order_clause = _build_order_clause(sort)

    if is_super_viewer:
        if hospital_name:
            valid_names = [hospital_name]
        else:
            valid_names = [
                h.name for h in
                app_db.query(Hospital.name).filter(
                    ~Hospital.name.in_(('Test', 'Tanuh Foundation'))
                ).all()
            ]
        if not valid_names:
            return []

        rows = q_db.execute(text(f"""
            SELECT s.session_id, s.session_start_time, s.snehita_lifetime_risk,
                   pid.answer AS patient_id, s.risk_category,
                   hosp.answer AS hospital_name
            FROM session_table s
            JOIN (
                SELECT session_id, MIN(answer) AS answer
                FROM session_data_table
                WHERE question IN ('Institute Name', 'Institute Name:',
                                   'Enter the Hospital ID(If any, else leave):', 'Q45')
                  AND answer IN :valid_names
                GROUP BY session_id
            ) hosp ON s.session_id = hosp.session_id
            LEFT JOIN (
                SELECT session_id, MIN(answer) AS answer
                FROM session_data_table
                WHERE question IN ('Enter your Patient ID(if any, else leave):',
                                   'Enter your subject ID:', 'Q44')
                GROUP BY session_id
            ) pid ON s.session_id = pid.session_id
            WHERE s.snehita_lifetime_risk IS NOT NULL
            ORDER BY {order_clause}
        """), {"valid_names": tuple(valid_names)}).fetchall()
    else:
        hospital_id = current_user.get("hospital_id")
        if not hospital_id:
            raise HTTPException(status_code=400, detail="User hospital ID not found")

        hospital_name = _get_hospital_name(app_db, hospital_id)
        if not hospital_name:
            raise HTTPException(status_code=400, detail="Hospital not found")

        rows = q_db.execute(text(f"""
            SELECT s.session_id, s.session_start_time, s.snehita_lifetime_risk,
                   pid.answer AS patient_id, s.risk_category,
                   NULL AS hospital_name
            FROM session_table s
            JOIN session_data_table sd ON s.session_id = sd.session_id
            LEFT JOIN session_data_table pid ON s.session_id = pid.session_id
              AND pid.question IN ('Enter your Patient ID(if any, else leave):', 'Enter your subject ID:', 'Q44')
            WHERE sd.question IN :q1
              AND sd.answer = :hospital_name
              AND s.snehita_lifetime_risk IS NOT NULL
            ORDER BY {order_clause}
        """), {"q1": INSTITUTE_QUESTIONS, "hospital_name": hospital_name}).fetchall()

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

    if sort and "assessment" in sort:
        for part in sort.split(","):
            part = part.strip()
            if part.startswith("assessment"):
                direction = "asc"
                if ":" in part:
                    direction = part.split(":")[1].strip().lower()
                result.sort(
                    key=lambda x: (1 if x["has_assessment"] else 0),
                    reverse=(direction == "desc")
                )
                break

    return result


@router.get("/sessions/{session_id}", response_model=PatientSessionDetail)
def get_patient_session_detail(
    session_id: str,
    q_db: Session = Depends(get_questionnaire_db),
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    hospital_id = current_user.get("hospital_id")
    if not hospital_id:
        raise HTTPException(status_code=400, detail="User hospital ID not found")

    session_row = q_db.execute(text(
        "SELECT session_id, session_start_time, snehita_lifetime_risk, risk_category FROM session_table WHERE session_id = :sid"
    ), {"sid": session_id}).fetchone()

    patient_id_row = q_db.execute(text(
        "SELECT answer FROM session_data_table WHERE session_id = :sid AND question IN ('Enter your Patient ID(if any, else leave):', 'Enter your subject ID:', 'Q44') LIMIT 1"
    ), {"sid": session_id}).fetchone()

    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found")

    response_rows = q_db.execute(text(
        "SELECT session_data_id, question, answer, created_at FROM session_data_table WHERE session_id = :sid ORDER BY created_at ASC"
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
