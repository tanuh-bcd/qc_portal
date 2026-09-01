import json
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import text
from ..db.session import get_db, get_questionnaire_db
from ..db.sql_compat import expand_in
from ..models.models import DoctorAssessment, Attachment, Hospital, Assignment
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
    hospital = app_db.query(Hospital).filter(Hospital.qc_id == hospital_id).first()
    return hospital.qc_name if hospital else None


def _get_attachment_flags(assessment):
    att_types = set()
    if assessment:
        for att in assessment.attachments:
            att_types.add(att.qc_file_type)

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
        ~Hospital.qc_name.in_(('Test', 'Tanuh Foundation'))
    ).order_by(Hospital.qc_name).all()
    if not hospitals:
        return []

    valid_names = [h.qc_name for h in hospitals]
    params = {}
    inst_ph = expand_in("iq", INSTITUTE_QUESTIONS, params)
    vn_ph = expand_in("vn", valid_names, params)

    session_hosp_rows = q_db.execute(text(f"""
        SELECT s.qc_session_id, sd_inst.answer AS hospital_name
        FROM qc_session_table s
        JOIN (
            SELECT qc_session_id, MIN(qc_answer) AS answer
            FROM qc_session_data_table
            WHERE qc_question IN {inst_ph}
              AND qc_answer IN {vn_ph}
            GROUP BY qc_session_id
        ) sd_inst ON s.qc_session_id = sd_inst.qc_session_id
        WHERE s.qc_snehita_lifetime_risk IS NOT NULL
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
        assessed_rows = app_db.query(DoctorAssessment.qc_patient_session_id).filter(
            DoctorAssessment.qc_patient_session_id.in_(all_ids)
        ).all()
        for r in assessed_rows:
            hname = hospital_by_session.get(r[0])
            if hname:
                assessment_counts[hname] = assessment_counts.get(hname, 0) + 1

    result = []
    for h in hospitals:
        result.append({
            "hospital_name": h.qc_name,
            "qc_short_name": h.qc_short_name,
            "qc_state": h.qc_state,
            "subject_count": subject_counts.get(h.qc_name, 0),
            "assessment_count": assessment_counts.get(h.qc_name, 0),
        })

    return result


SORT_COLUMN_MAP = {
    "date": "s.qc_session_start_time",
    "risk": "FIELD(s.qc_risk_category, 'Baseline Risk', 'Evident Risk', 'Significant Risk', 'High Risk')",
    "assessment": None,
}


def _build_order_clause(sort_param):
    if not sort_param:
        return "s.qc_session_start_time DESC"

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

    return ", ".join(clauses) if clauses else "s.qc_session_start_time DESC"


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
                h.qc_name for h in
                app_db.query(Hospital.qc_name).filter(
                    ~Hospital.qc_name.in_(('Test', 'Tanuh Foundation'))
                ).all()
            ]
        if not valid_names:
            return []

        params = {}
        vn_ph = expand_in("vn", valid_names, params)
        rows = q_db.execute(text(f"""
            SELECT s.qc_session_id, s.qc_session_start_time, s.qc_snehita_lifetime_risk,
                   pid.answer AS patient_id, s.qc_risk_category,
                   hosp.answer AS hospital_name
            FROM qc_session_table s
            JOIN (
                SELECT qc_session_id, MIN(qc_answer) AS answer
                FROM qc_session_data_table
                WHERE qc_question IN ('Institute Name', 'Institute Name:',
                                   'Enter the Hospital ID(If any, else leave):', 'Q45')
                  AND qc_answer IN {vn_ph}
                GROUP BY qc_session_id
            ) hosp ON s.qc_session_id = hosp.qc_session_id
            LEFT JOIN (
                SELECT qc_session_id, MIN(qc_answer) AS answer
                FROM qc_session_data_table
                WHERE qc_question IN ('Enter your Patient ID(if any, else leave):',
                                   'Enter your subject ID:', 'Q44')
                GROUP BY qc_session_id
            ) pid ON s.qc_session_id = pid.qc_session_id
            WHERE s.qc_snehita_lifetime_risk IS NOT NULL
            ORDER BY {order_clause}
        """), params).fetchall()
    else:
        hospital_id = current_user.get("hospital_id")
        if not hospital_id:
            raise HTTPException(status_code=400, detail="User hospital ID not found")

        hospital_name = _get_hospital_name(app_db, hospital_id)
        if not hospital_name:
            raise HTTPException(status_code=400, detail="Hospital not found")

        params = {"hospital_name": hospital_name}
        q1_ph = expand_in("q1", INSTITUTE_QUESTIONS, params)
        rows = q_db.execute(text(f"""
            SELECT s.qc_session_id, s.qc_session_start_time, s.qc_snehita_lifetime_risk,
                   pid.qc_answer AS patient_id, s.qc_risk_category,
                   NULL AS hospital_name
            FROM qc_session_table s
            JOIN qc_session_data_table sd ON s.qc_session_id = sd.qc_session_id
            LEFT JOIN qc_session_data_table pid ON s.qc_session_id = pid.qc_session_id
              AND pid.qc_question IN ('Enter your Patient ID(if any, else leave):', 'Enter your subject ID:', 'Q44')
            WHERE sd.qc_question IN {q1_ph}
              AND sd.qc_answer = :hospital_name
              AND s.qc_snehita_lifetime_risk IS NOT NULL
            ORDER BY {order_clause}
        """), params).fetchall()

    result = []
    for row in rows:
        session_id = row[0]
        assessment = app_db.query(DoctorAssessment).filter(
            DoctorAssessment.qc_patient_session_id == session_id
        ).options(joinedload(DoctorAssessment.attachments)).first()

        flags = _get_attachment_flags(assessment)
        result.append({
            "qc_id": session_id,
            "patient_id": row[3] or "",
            "hospital_name": row[5] or None,
            "qc_consent_scanned_url": None,
            "qc_consent_timestamp": row[1],
            "snehita_risk": row[2],
            "qc_risk_category": row[4] or "",
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
    user_role = (current_user.get("role") or "").lower()
    is_super_viewer = current_user.get("is_super_viewer", False) or \
        current_user.get("email", "").lower().endswith("@tanuh.ai")

    if user_role == "radiologist":
        # Radiologists aren't scoped to a hospital — they're authorized per-case via
        # qc_assignments instead, since they review cases assigned to them across hospitals.
        assessment_for_auth = app_db.query(DoctorAssessment).filter(
            DoctorAssessment.qc_patient_session_id == session_id
        ).first()
        is_assigned = assessment_for_auth is not None and app_db.query(Assignment).filter(
            Assignment.qc_assessment_id == assessment_for_auth.qc_id,
            Assignment.qc_radiologist_id == current_user.get("id"),
        ).first() is not None
        if not is_assigned:
            raise HTTPException(status_code=403, detail="Not authorized to view this case")
    elif not hospital_id and not is_super_viewer:
        raise HTTPException(status_code=400, detail="User hospital ID not found")

    session_row = q_db.execute(text(
        "SELECT qc_session_id, qc_session_start_time, qc_snehita_lifetime_risk, qc_risk_category FROM qc_session_table WHERE qc_session_id = :sid"
    ), {"sid": session_id}).fetchone()

    patient_id_row = q_db.execute(text(
        "SELECT qc_answer FROM qc_session_data_table WHERE qc_session_id = :sid AND qc_question IN ('Enter your Patient ID(if any, else leave):', 'Enter your subject ID:', 'Q44') LIMIT 1"
    ), {"sid": session_id}).fetchone()

    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found")

    response_rows = q_db.execute(text(
        "SELECT qc_session_data_id, qc_question, qc_answer, qc_created_at FROM qc_session_data_table WHERE qc_session_id = :sid ORDER BY qc_created_at ASC"
    ), {"sid": session_id}).fetchall()

    responses = []
    for r in response_rows:
        raw_question = r[1] or ""
        responses.append({
            "qc_id": abs(hash(r[0])) % 2147483647,
            "qc_question": _Q_TEXT_MAP.get(raw_question, raw_question),
            "qc_answer": r[2] or "",
            "qc_created_at": r[3],
        })

    assessment = app_db.query(DoctorAssessment).filter(
        DoctorAssessment.qc_patient_session_id == session_id
    ).options(joinedload(DoctorAssessment.attachments)).first()

    flags = _get_attachment_flags(assessment)

    return {
        "qc_id": session_id,
        "patient_id": (patient_id_row[0] if patient_id_row else "") or "",
        "qc_consent_scanned_url": None,
        "qc_consent_timestamp": session_row[1],
        "snehita_risk": session_row[2],
        "qc_risk_category": session_row[3] or "",
        "responses": responses,
        "assessment": assessment,
        **flags,
    }
