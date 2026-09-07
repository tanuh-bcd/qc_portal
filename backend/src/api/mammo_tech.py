import random
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

router = APIRouter()


def require_mammo_tech(current_user: dict = Depends(get_current_user)):
    if (current_user.get("role") or "").lower() != MAMMO_TECH_ROLE_NAME.lower():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Mammo Tech access required")
    return current_user


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
    ).all()

    if not assignments:
        return RadiologistCasesResponse(user_id=mammo_tech_id, role=current_user.get("role", ""), cases=[])

    assessment_ids = [a.qc_assessment_id for a in assignments]
    assessments = {
        a.qc_id: a for a in
        app_db.query(DoctorAssessment).filter(DoctorAssessment.qc_id.in_(assessment_ids)).all()
    }
    hospitals = {h.qc_id: h.qc_name for h in app_db.query(Hospital).all()}

    cases = []
    for asg in assignments:
        assessment = assessments.get(asg.qc_assessment_id)
        if not assessment:
            continue
        qc_subject_id = assessment.qc_sub_ui_id or assessment.qc_patient_session_id
        cases.append(RadiologistCaseItem(
            qc_subject_id=qc_subject_id,
            hospital=hospitals.get(assessment.qc_hospital_id),
            case_id=assessment.qc_id,
            session_id=assessment.qc_patient_session_id,
            status=asg.qc_status,
            review_notes=asg.qc_review_notes,
            has_assessment=True,
        ))

    return RadiologistCasesResponse(user_id=mammo_tech_id, role=current_user.get("role", ""), cases=cases)


@router.post("/cases/{case_id}/review", response_model=MammoTechReviewResponse)
def review_case(
    case_id: int,
    payload: MammoTechReviewRequest,
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_mammo_tech),
):
    """Confirms or rejects an assigned case. "no" rejects it — the case stays
    assigned to this Mammo Tech, no Radiologist is touched. "yes" moves it to
    In-Progress and automatically assigns it to a random available Radiologist,
    creating (or reassigning) the Radiologist-role Assignment for the same case."""
    mammo_tech_id = current_user["id"]
    mammo_role = _get_role_by_name(app_db, MAMMO_TECH_ROLE_NAME)
    assignment = app_db.query(Assignment).filter(
        Assignment.qc_assessment_id == case_id,
        Assignment.qc_radiologist_id == mammo_tech_id,
        Assignment.qc_role_id == (mammo_role.qc_id if mammo_role else -1),
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assigned case not found")
    if assignment.qc_status != "Pending":
        raise HTTPException(status_code=400, detail=f"Case already reviewed (status: {assignment.qc_status})")

    if payload.confirmation == "no":
        assignment.qc_status = "Rejected"
        app_db.commit()
        return MammoTechReviewResponse(
            case_id=case_id, status="Rejected", assigned_to=mammo_tech_id,
            assigned_radiologist_id=None, message="Case rejected by Mammo Tech",
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
        radiologist_assignment.qc_assigned_by = mammo_tech_id
        radiologist_assignment.qc_role_id = radiologist_role.qc_id
        radiologist_assignment.qc_status = "Pending"
    else:
        app_db.add(Assignment(
            qc_assessment_id=case_id,
            qc_radiologist_id=chosen.qc_id,
            qc_assigned_by=mammo_tech_id,
            qc_status="Pending",
            qc_role_id=radiologist_role.qc_id,
        ))
    app_db.commit()

    return MammoTechReviewResponse(
        case_id=case_id, status="In-Progress", assigned_to=mammo_tech_id,
        assigned_radiologist_id=chosen.qc_id, assigned_radiologist_name=chosen.qc_full_name,
        message="Case assigned to Radiologist successfully",
    )
