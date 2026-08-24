from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import case, func, or_, text, bindparam
from sqlalchemy.orm import Session, joinedload
from typing import List

from ...db.Qualitycheck.qc_session import get_qc_db
from ...db.session import get_db, get_questionnaire_db
from ...models.Qualitycheck.qc_models import QcHospital, QcUser, QcRole, QcDoctorAssessment, QcAssignment, QcAssignmentStatus
from ...models.models import DoctorAssessment
from ...schemas.Qualitycheck.qc_schema import (
    QcSubjectListResponse, QcAssignmentBatchResponse, QcUserResponse, QcSubjectResponse,
    QcAssignmentCreate, QcAssignmentResponse, QcUserAssignedSubject, QcAdminSubjectListItem
)
from ...core.config import settings
from ...core.security import verify_password, get_password_hash
from ..doctor import _get_attachment_flags

router = APIRouter()

qc_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/qc-login")


async def get_current_qc_user(token: str = Depends(qc_oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        email: str = payload.get("sub")
        role: str = payload.get("role")
        if email is None:
            raise credentials_exception
        return {"email": email, "role": role}
    except JWTError:
        raise credentials_exception


@router.get("/users", response_model=List[QcUserResponse])
def get_qc_users(db: Session = Depends(get_qc_db), _current=Depends(get_current_qc_user)):
    return (
        db.query(QcUser)
        .join(QcRole, QcUser.qc_role_id == QcRole.qc_id)
        .filter(QcRole.qc_name != "Admin")
        .all()
    )

@router.get("/subjects-list", response_model=QcSubjectListResponse)
def get_qc_subjects(db: Session = Depends(get_qc_db), _current=Depends(get_current_qc_user)):
    assessments = db.query(QcDoctorAssessment).order_by(QcDoctorAssessment.qc_id).all()

    assigned_ids = {
        row[0] for row in db.query(QcAssignment.qc_assessment_id).distinct().all()
    }

    subjects = [
        QcSubjectResponse(
            qc_id=a.qc_id,
            display_id=a.qc_sub_ui_id or f"QC_{a.qc_id:05d}",
            qc_patient_session_id=a.qc_patient_session_id,
            qc_created_at=a.qc_created_at,
            is_assigned=a.qc_id in assigned_ids,
        )
        for a in assessments
    ]

    return QcSubjectListResponse(total=len(subjects), subjects=subjects)

@router.post("/assignments", response_model=QcAssignmentBatchResponse)
def create_assignments(
    payload: QcAssignmentCreate,
    db: Session = Depends(get_qc_db),
    current=Depends(get_current_qc_user),
):
    if not payload.assessment_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No subjects selected")

    normalized_role = payload.role.strip().lower()

    radiologist_role = db.query(QcRole).filter(
    or_(
        func.lower(QcRole.qc_name) == normalized_role,
        QcRole.qc_id == 2,
    )
    ).first()

    if not radiologist_role:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Role '{payload.role}' not configured")

    normalized_email = payload.email.strip().lower()
    user = db.query(QcUser).filter(func.lower(QcUser.qc_email) == normalized_email).first()

    if user:
    # Existing user → promote to Radiologist + reset password + update name
        user.qc_role_id = radiologist_role.qc_id
        user.qc_password_hash = get_password_hash(payload.password)
        user.qc_full_name = payload.full_name.strip()
    else:
    # New user → create as Radiologist
        user = QcUser(
        qc_email=normalized_email,
        qc_password_hash=get_password_hash(payload.password),
        qc_role_id=radiologist_role.qc_id,
        qc_full_name=payload.full_name.strip(),
        qc_is_active=True,
    )
    db.add(user)
    db.flush()

    assessments = db.query(QcDoctorAssessment).filter(
        QcDoctorAssessment.qc_id.in_(payload.assessment_ids)
    ).all()
    found_ids = {a.qc_id for a in assessments}
    missing_ids = set(payload.assessment_ids) - found_ids
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Subjects not found: {sorted(missing_ids)}"
        )

    existing = db.query(QcAssignment).filter(
        QcAssignment.qc_assessment_id.in_(payload.assessment_ids),
        QcAssignment.qc_radiologist_id == user.qc_id,
    ).all()
    already_assigned_ids = {e.qc_assessment_id for e in existing}

    assigned_by_user = db.query(QcUser).filter(QcUser.qc_email == current["email"]).first()

    new_assignments = []
    for assessment_id in payload.assessment_ids:
        if assessment_id in already_assigned_ids:
            continue
        assignment = QcAssignment(
        qc_assessment_id=assessment_id,
        qc_radiologist_id=user.qc_id,
        qc_role_id=radiologist_role.qc_id,
        qc_assigned_by=assigned_by_user.qc_id if assigned_by_user else None,
        qc_status=QcAssignmentStatus.pending,
    )   
        db.add(assignment)
        new_assignments.append(assignment)

    user.qc_assigned = payload.assigned == "yes"

    db.commit()
    for a in new_assignments:
        db.refresh(a)

    return QcAssignmentBatchResponse(
        created=[QcAssignmentResponse(qc_id=a.qc_id, qc_status=a.qc_status.value) for a in new_assignments],
        skipped=sorted(already_assigned_ids),
    )

@router.get("/assignments/user/{user_id}", response_model=List[QcUserAssignedSubject])
def get_user_assignments(
    user_id: int,
    db: Session = Depends(get_qc_db),
    _current=Depends(get_current_qc_user),
):
    rows = (
        db.query(QcAssignment, QcDoctorAssessment, QcRole)
        .join(QcDoctorAssessment, QcAssignment.qc_assessment_id == QcDoctorAssessment.qc_id)
        .outerjoin(QcRole, QcAssignment.qc_role_id == QcRole.qc_id)
        .filter(QcAssignment.qc_radiologist_id == user_id)
        .order_by(QcAssignment.qc_id)
        .all()
    )
    return [
        QcUserAssignedSubject(
            qc_assignment_id=assignment.qc_id,
            subject_id=assessment.qc_id,
            display_id=assessment.qc_sub_ui_id or f"QC_{assessment.qc_id:05d}",
            qc_status=assignment.qc_status.value,
            role_name=role.qc_name if role else None,
            qc_patient_session_id=assessment.qc_patient_session_id,
            qc_assigned_at=assignment.qc_assigned_at,
        )
        for assignment, assessment, role in rows
    ]

@router.get("/admin/all/assignments", response_model=List[QcAdminSubjectListItem])
def get_all_assignments(
    qc_db: Session = Depends(get_qc_db),
    q_db: Session = Depends(get_questionnaire_db),
    app_db: Session = Depends(get_db),
    _current=Depends(get_current_qc_user),
):
    assignment_rows = (
        qc_db.query(QcAssignment, QcDoctorAssessment, QcUser, QcRole, QcHospital)
        .join(QcDoctorAssessment, QcAssignment.qc_assessment_id == QcDoctorAssessment.qc_id)
        .join(QcUser, QcAssignment.qc_radiologist_id == QcUser.qc_id)
        .outerjoin(QcRole, QcAssignment.qc_role_id == QcRole.qc_id)
        .outerjoin(QcHospital, QcDoctorAssessment.qc_hospital_id == QcHospital.qc_id)
        .all()
    )
    if not assignment_rows:
        return []

    session_to_assignments = {}
    session_ids = []
    for assignment, qda, user, role, hospital in assignment_rows:
        sid = qda.qc_patient_session_id
        if not sid:
            continue
        session_to_assignments.setdefault(sid, []).append((assignment, qda, user, role, hospital))
        session_ids.append(sid)
        
    session_ids = list(dict.fromkeys(session_ids))
    if not session_ids:
        return []

    rows = q_db.execute(
        text("""
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
        """).bindparams(bindparam("session_ids", expanding=True)),
        {"session_ids": session_ids},
    ).fetchall()

    result = []
    for row in rows:
        session_id = row[0]
        assessment = app_db.query(DoctorAssessment).filter(
            DoctorAssessment.patient_session_id == session_id
        ).options(joinedload(DoctorAssessment.attachments)).first()
        flags = _get_attachment_flags(assessment)

        for assignment, qda, user, role, hospital in session_to_assignments.get(session_id, []):
            result.append({
                "id": session_id,
                "display_id": qda.qc_sub_ui_id or f"QC_{qda.qc_id:05d}",
                "patient_id": row[3] or "",
                "hospital_name": row[5] or (hospital.qc_name if hospital else None),
                "qc_short_name": hospital.qc_short_name if hospital else None,   
                "consent_scanned_url": None,
                "consent_timestamp": row[1],
                "snehita_risk": row[2],
                "risk_category": row[4] or "",
                "qc_assignment_id": assignment.qc_id,
                "radiologist_id": user.qc_id,
                "radiologist_name": user.qc_full_name,
                "radiologist_email": user.qc_email,
                "role_name": role.qc_name if role else None,
                "qc_status": assignment.qc_status.value,
                "qc_assigned_at": assignment.qc_assigned_at,
                **flags,
            })

    return result