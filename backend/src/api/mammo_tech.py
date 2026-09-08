import datetime
import random
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session
from ..db.session import get_db
from ..models.models import Assignment, DoctorAssessment, Hospital, User
from ..schemas.schemas import (
    RadiologistCasesResponse, RadiologistCaseItem,
    MammoTechReviewRequest, MammoTechReviewResponse,
)
from .auth import get_current_user
from .admin import _get_role_by_name, RADIOLOGIST_ROLE_NAME, MAMMO_TECH_ROLE_NAME
from .radiologist import _reviewable_attachments, _merge_clinical_findings

router = APIRouter()


def require_mammo_tech(current_user: dict = Depends(get_current_user)):
    if (current_user.get("role") or "").lower() != MAMMO_TECH_ROLE_NAME.lower():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Mammo Tech access required")
    return current_user


def _mammo_tech_response(status: str) -> Optional[str]:
    if status == "Pending":
        return None
    return "No" if status == "Rejected" else "Yes"


def _get_mammo_tech_assignment(app_db: Session, case_id: int, mammo_tech_id: int) -> Assignment:
    mammo_role = _get_role_by_name(app_db, MAMMO_TECH_ROLE_NAME)
    assignment = app_db.query(Assignment).filter(
        Assignment.qc_assessment_id == case_id,
        Assignment.qc_radiologist_id == mammo_tech_id,
        Assignment.qc_role_id == (mammo_role.qc_id if mammo_role else -1),
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assigned case not found")
    return assignment


@router.get("/cases", response_model=RadiologistCasesResponse)
def get_my_cases(
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_mammo_tech),
):
    """Cases assigned to the currently authenticated Mammo Tech. The mammo tech
    id is taken only from the verified JWT — never from a client-supplied
    parameter — so one mammo tech cannot request another's cases."""
    mammo_tech_id = current_user["id"]
    mammo_role = _get_role_by_name(app_db, MAMMO_TECH_ROLE_NAME)
    assignments = app_db.query(Assignment).filter(
        Assignment.qc_radiologist_id == mammo_tech_id,
        Assignment.qc_role_id == (mammo_role.qc_id if mammo_role else -1),
    ).order_by(Assignment.qc_id.asc()).all()

    if not assignments:
        return RadiologistCasesResponse(user_id=mammo_tech_id, role=current_user.get("role", ""), cases=[])

    assessment_ids = [a.qc_assessment_id for a in assignments]
    assessments = {
        a.qc_id: a for a in
        app_db.query(DoctorAssessment).filter(DoctorAssessment.qc_id.in_(assessment_ids)).all()
    }
    hospitals = {h.qc_id: h.qc_name for h in app_db.query(Hospital).all()}
    radiologist_role = _get_role_by_name(app_db, RADIOLOGIST_ROLE_NAME)
    radiologist_assignments = app_db.query(Assignment).filter(
        Assignment.qc_assessment_id.in_(assessment_ids),
        or_(Assignment.qc_role_id.is_(None), Assignment.qc_role_id == (radiologist_role.qc_id if radiologist_role else -1)),
    ).order_by(Assignment.qc_id.asc()).all()
    radiologist_assignment_by_assessment = {a.qc_assessment_id: a for a in radiologist_assignments}
    radiologists = {u.qc_id: u for u in app_db.query(User).filter(
        User.qc_id.in_([a.qc_radiologist_id for a in radiologist_assignments])
    ).all()} if radiologist_assignments else {}

    cases = []
    for asg in assignments:
        assessment = assessments.get(asg.qc_assessment_id)
        if not assessment:
            continue
        qc_subject_id = assessment.qc_sub_ui_id or assessment.qc_patient_session_id
        assigned_radiologist = None
        if _mammo_tech_response(asg.qc_status) == "Yes":
            rad_assignment = radiologist_assignment_by_assessment.get(asg.qc_assessment_id)
            assigned_radiologist = radiologists.get(rad_assignment.qc_radiologist_id) if rad_assignment else None
        cases.append(RadiologistCaseItem(
            qc_subject_id=qc_subject_id,
            hospital=hospitals.get(assessment.qc_hospital_id),
            case_id=assessment.qc_id,
            session_id=assessment.qc_patient_session_id,
            status=asg.qc_status,
            review_notes=asg.qc_review_notes,
            has_assessment=True,
            assigned_at=asg.qc_assigned_at,
            submitted_response=_mammo_tech_response(asg.qc_status),
            assigned_radiologist_id=assigned_radiologist.qc_id if assigned_radiologist else None,
            assigned_radiologist_name=assigned_radiologist.qc_full_name if assigned_radiologist else None,
        ))

    return RadiologistCasesResponse(user_id=mammo_tech_id, role=current_user.get("role", ""), cases=cases)


def _next_pending_case(app_db: Session, mammo_tech_id: int, exclude_case_id: int, mammo_role_id: int):
    next_assignment = app_db.query(Assignment).filter(
        Assignment.qc_radiologist_id == mammo_tech_id,
        Assignment.qc_role_id == mammo_role_id,
        Assignment.qc_status == "Pending",
        Assignment.qc_assessment_id != exclude_case_id,
    ).order_by(Assignment.qc_id.asc()).first()
    if not next_assignment:
        return None
    next_assessment = app_db.query(DoctorAssessment).filter(
        DoctorAssessment.qc_id == next_assignment.qc_assessment_id
    ).first()
    if not next_assessment:
        return None
    hospital = app_db.query(Hospital).filter(Hospital.qc_id == next_assessment.qc_hospital_id).first()
    return RadiologistCaseItem(
        qc_subject_id=next_assessment.qc_sub_ui_id or next_assessment.qc_patient_session_id,
        hospital=hospital.qc_name if hospital else None,
        case_id=next_assessment.qc_id,
        session_id=next_assessment.qc_patient_session_id,
        status=next_assignment.qc_status,
        review_notes=next_assignment.qc_review_notes,
        has_assessment=True,
        assigned_at=next_assignment.qc_assigned_at,
    )


@router.post("/cases/{case_id}/review", response_model=MammoTechReviewResponse)
def review_case(
    case_id: int,
    payload: MammoTechReviewRequest,
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_mammo_tech),
):
    mammo_tech_id = current_user["id"]
    mammo_role = _get_role_by_name(app_db, MAMMO_TECH_ROLE_NAME)
    assignment = _get_mammo_tech_assignment(app_db, case_id, mammo_tech_id)
    if assignment.qc_status != "Pending":
        raise HTTPException(status_code=400, detail=f"Case already reviewed (status: {assignment.qc_status})")

    assessment = app_db.query(DoctorAssessment).filter(DoctorAssessment.qc_id == case_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Case not found")
    if not _reviewable_attachments(app_db, assessment):
        raise HTTPException(status_code=400, detail="No images available on this case")

    _merge_clinical_findings(app_db, assessment, payload.left, payload.right, payload.case_notes)

    if payload.confirmation == "no":
        assignment.qc_status = "Rejected"
        app_db.commit()
        next_case = _next_pending_case(app_db, mammo_tech_id, case_id, mammo_role.qc_id if mammo_role else -1)
        return MammoTechReviewResponse(
            case_id=case_id, status="Rejected", assigned_to=mammo_tech_id,
            assigned_radiologist_id=None, message="Case rejected by Mammo Tech",
            next_case=next_case,
        )

    radiologist_role = _get_role_by_name(app_db, RADIOLOGIST_ROLE_NAME)
    available_radiologists = app_db.query(User).filter(
        User.qc_role_id == (radiologist_role.qc_id if radiologist_role else -1),
        User.qc_is_active == True,
    ).all()
    if not available_radiologists:
        # Raised before any commit, so the case stays Pending and this can be retried.
        raise HTTPException(status_code=409, detail="No available Radiologist to assign this case to")

    chosen = random.choice(available_radiologists)

    assignment.qc_status = "In-Progress"

    radiologist_assignment = app_db.query(Assignment).filter(
        Assignment.qc_assessment_id == case_id,
        or_(Assignment.qc_role_id.is_(None), Assignment.qc_role_id == radiologist_role.qc_id),
    ).first()
    if radiologist_assignment:
        radiologist_assignment.qc_radiologist_id = chosen.qc_id
        radiologist_assignment.qc_mammo_tech_id = mammo_tech_id
        radiologist_assignment.qc_assigned_by = mammo_tech_id
        radiologist_assignment.qc_role_id = radiologist_role.qc_id
        radiologist_assignment.qc_status = "Pending"
        radiologist_assignment.qc_assigned_at = datetime.datetime.utcnow()
    else:
        app_db.add(Assignment(
            qc_assessment_id=case_id,
            qc_radiologist_id=chosen.qc_id,
            qc_mammo_tech_id=mammo_tech_id,
            qc_assigned_by=mammo_tech_id,
            qc_status="Pending",
            qc_role_id=radiologist_role.qc_id,
            qc_assigned_at=datetime.datetime.utcnow(),
        ))
    app_db.commit()

    next_case = _next_pending_case(app_db, mammo_tech_id, case_id, mammo_role.qc_id if mammo_role else -1)
    return MammoTechReviewResponse(
        case_id=case_id, status="In-Progress", assigned_to=mammo_tech_id,
        assigned_radiologist_id=chosen.qc_id, assigned_radiologist_name=chosen.qc_full_name,
        message="Case assigned to Radiologist successfully",
        next_case=next_case,
    )
