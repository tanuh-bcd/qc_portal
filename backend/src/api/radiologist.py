import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..db.session import get_db
from ..models.models import Assignment, DoctorAssessment, Hospital
from ..schemas.schemas import (
    RadiologistCasesResponse, RadiologistCaseItem,
    RadiologistReviewCompleteRequest, RadiologistReviewCompleteResponse,
)
from .auth import get_current_user

router = APIRouter()


def require_radiologist(current_user: dict = Depends(get_current_user)):
    if (current_user.get("role") or "").lower() != "radiologist":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Radiologist access required")
    return current_user


@router.get("/cases", response_model=RadiologistCasesResponse)
def get_my_cases(
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_radiologist),
):
    """Cases assigned to the currently authenticated Radiologist. The radiologist
    id is taken only from the verified JWT (get_current_user) — never from a
    client-supplied parameter — so one radiologist cannot request another's cases."""
    radiologist_id = current_user["id"]
    assignments = app_db.query(Assignment).filter(Assignment.qc_radiologist_id == radiologist_id).all()

    if not assignments:
        return RadiologistCasesResponse(user_id=radiologist_id, role=current_user.get("role", ""), cases=[])

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

    return RadiologistCasesResponse(user_id=radiologist_id, role=current_user.get("role", ""), cases=cases)


@router.post("/cases/{case_id}/complete", response_model=RadiologistReviewCompleteResponse)
def complete_case_review(
    case_id: int,
    payload: RadiologistReviewCompleteRequest,
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_radiologist),
):
    """Marks an assigned case as reviewed and completed. Mandatory notes are required
    and the assignment must belong to the currently authenticated radiologist."""
    assignment = app_db.query(Assignment).filter(
        Assignment.qc_assessment_id == case_id,
        Assignment.qc_radiologist_id == current_user["id"],
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assigned case not found")

    assignment.qc_status = "Completed"
    assignment.qc_review_notes = payload.notes
    assignment.qc_completed_at = datetime.datetime.utcnow()
    app_db.commit()

    return RadiologistReviewCompleteResponse(
        case_id=case_id, status=assignment.qc_status, qc_completed_at=assignment.qc_completed_at
    )


@router.post("/cases/{case_id}/flag", response_model=RadiologistReviewCompleteResponse)
def flag_case_review(
    case_id: int,
    payload: RadiologistReviewCompleteRequest,
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_radiologist),
):
    """Records why the radiologist isn't completing this case yet. The assignment
    stays Pending — this only leaves a note for the clinician/admin to address,
    it does not finish the radiologist's review task."""
    assignment = app_db.query(Assignment).filter(
        Assignment.qc_assessment_id == case_id,
        Assignment.qc_radiologist_id == current_user["id"],
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assigned case not found")

    assignment.qc_review_notes = payload.notes
    app_db.commit()

    return RadiologistReviewCompleteResponse(
        case_id=case_id, status=assignment.qc_status, qc_completed_at=assignment.qc_completed_at
    )
