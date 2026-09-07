import datetime
import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..db.session import get_db
from ..models.models import Assignment, DoctorAssessment, Hospital, Role
from ..schemas.schemas import MammoTechCasesResponse, MammoTechCaseItem, MammoTechReviewRequest
from ..core.workflow_status import mammo_tech_display_status
from .auth import get_current_user

router = APIRouter()

MAMMO_TECH_ROLE_NAME = "Mammo Tech"


def require_mammo_tech(current_user: dict = Depends(get_current_user)):
    if (current_user.get("role") or "").lower() != MAMMO_TECH_ROLE_NAME.lower():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Mammo Tech access required")
    return current_user


def _mammo_tech_role_id(app_db: Session):
    role = app_db.query(Role).filter(Role.qc_name == MAMMO_TECH_ROLE_NAME).first()
    return role.qc_id if role else None


@router.get("/cases", response_model=MammoTechCasesResponse)
def get_my_cases(
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_mammo_tech),
):
    """Cases assigned to the currently authenticated Mammo Tech. The user id is
    taken only from the verified JWT — never a client-supplied parameter — so one
    Mammo Tech cannot request another's cases."""
    mammo_tech_id = current_user["id"]
    role_id = _mammo_tech_role_id(app_db)
    if role_id is None:
        return MammoTechCasesResponse(user_id=mammo_tech_id, role=current_user.get("role", ""), cases=[])

    assignments = app_db.query(Assignment).filter(
        Assignment.qc_radiologist_id == mammo_tech_id,
        Assignment.qc_role_id == role_id,
    ).all()
    if not assignments:
        return MammoTechCasesResponse(user_id=mammo_tech_id, role=current_user.get("role", ""), cases=[])

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
        cases.append(MammoTechCaseItem(
            qc_subject_id=qc_subject_id,
            hospital=hospitals.get(assessment.qc_hospital_id),
            case_id=assessment.qc_id,
            session_id=assessment.qc_patient_session_id,
            status=mammo_tech_display_status(asg),
            has_assessment=True,
        ))

    return MammoTechCasesResponse(user_id=mammo_tech_id, role=current_user.get("role", ""), cases=cases)


@router.post("/cases/{case_id}/review", response_model=MammoTechCaseItem)
def review_case(
    case_id: int,
    payload: MammoTechReviewRequest,
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_mammo_tech),
):
    """Records the Mammo Tech's image-quality decision. Yes -> Accepted (case
    becomes eligible for Radiologist assignment); No -> Rejected, workflow stops."""
    role_id = _mammo_tech_role_id(app_db)
    assignment = app_db.query(Assignment).filter(
        Assignment.qc_assessment_id == case_id,
        Assignment.qc_radiologist_id == current_user["id"],
        Assignment.qc_role_id == role_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assigned case not found")

    assignment.qc_status = "Completed"
    assignment.qc_review_notes = json.dumps({"quality_accepted": payload.quality_accepted})
    assignment.qc_completed_at = datetime.datetime.utcnow()
    app_db.commit()

    assessment = app_db.query(DoctorAssessment).filter(DoctorAssessment.qc_id == case_id).first()
    hospital = app_db.query(Hospital).filter(Hospital.qc_id == assessment.qc_hospital_id).first() if assessment else None
    qc_subject_id = (assessment.qc_sub_ui_id or assessment.qc_patient_session_id) if assessment else str(case_id)

    return MammoTechCaseItem(
        qc_subject_id=qc_subject_id,
        hospital=hospital.qc_name if hospital else None,
        case_id=case_id,
        session_id=assessment.qc_patient_session_id if assessment else "",
        status=mammo_tech_display_status(assignment),
        has_assessment=assessment is not None,
    )
