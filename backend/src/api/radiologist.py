import datetime
import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..db.session import get_db
from ..models.models import Assignment, DoctorAssessment, Hospital, Role
from ..schemas.schemas import (
    RadiologistCasesResponse, RadiologistCaseItem,
    RadiologistReviewCompleteRequest, RadiologistReviewCompleteResponse,
    RadiologistBreastReviewRequest,
)
from ..core.workflow_status import parse_notes, radiologist_display_status
from .auth import get_current_user

router = APIRouter()


def require_radiologist(current_user: dict = Depends(get_current_user)):
    if (current_user.get("role") or "").lower() != "radiologist":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Radiologist access required")
    return current_user


def _radiologist_role_id(app_db: Session):
    role = app_db.query(Role).filter(Role.qc_name == "Radiologist").first()
    return role.qc_id if role else None


def _get_own_assignment(app_db: Session, case_id: int, current_user: dict):
    """Looks up the caller's own assignment row for this case, matching either a
    role-tagged Radiologist row or a legacy (pre-Mammo-Tech) untagged one."""
    role_id = _radiologist_role_id(app_db)
    return app_db.query(Assignment).filter(
        Assignment.qc_assessment_id == case_id,
        Assignment.qc_radiologist_id == current_user["id"],
        (Assignment.qc_role_id == role_id) | (Assignment.qc_role_id.is_(None)),
    ).first()


@router.get("/cases", response_model=RadiologistCasesResponse)
def get_my_cases(
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_radiologist),
):
    """Cases assigned to the currently authenticated Radiologist. The radiologist
    id is taken only from the verified JWT (get_current_user) — never from a
    client-supplied parameter — so one radiologist cannot request another's cases."""
    radiologist_id = current_user["id"]
    role_id = _radiologist_role_id(app_db)
    assignments = app_db.query(Assignment).filter(
        Assignment.qc_radiologist_id == radiologist_id,
        (Assignment.qc_role_id == role_id) | (Assignment.qc_role_id.is_(None)),
    ).all()

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
            status=radiologist_display_status(asg),
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


@router.post("/cases/{case_id}/review-left", response_model=RadiologistReviewCompleteResponse)
def review_left_breast(
    case_id: int,
    payload: RadiologistBreastReviewRequest,
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_radiologist),
):
    """Left Breast Annotation Accepted? step of the two-stage review. Yes moves
    the radiologist on to the Right Breast step; No requires a comment and
    leaves the case In-Progress."""
    assignment = _get_own_assignment(app_db, case_id, current_user)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assigned case not found")

    notes = parse_notes(assignment.qc_review_notes)
    notes["left"] = {"accepted": payload.accepted, "comment": payload.comment}
    assignment.qc_review_notes = json.dumps(notes)
    app_db.commit()

    return RadiologistReviewCompleteResponse(
        case_id=case_id, status=radiologist_display_status(assignment), qc_completed_at=assignment.qc_completed_at
    )


@router.post("/cases/{case_id}/review-right", response_model=RadiologistReviewCompleteResponse)
def review_right_breast(
    case_id: int,
    payload: RadiologistBreastReviewRequest,
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_radiologist),
):
    """Right Breast Annotation Accepted? step of the two-stage review. Only
    reachable once Left Breast has been accepted. Yes completes the case; No
    requires a comment and leaves the case In-Progress."""
    assignment = _get_own_assignment(app_db, case_id, current_user)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assigned case not found")

    notes = parse_notes(assignment.qc_review_notes)
    if not notes.get("left", {}).get("accepted"):
        raise HTTPException(status_code=400, detail="Left Breast Annotation must be accepted before reviewing the Right Breast")

    notes["right"] = {"accepted": payload.accepted, "comment": payload.comment}
    assignment.qc_review_notes = json.dumps(notes)
    if payload.accepted:
        assignment.qc_status = "Completed"
        assignment.qc_completed_at = datetime.datetime.utcnow()
    app_db.commit()

    return RadiologistReviewCompleteResponse(
        case_id=case_id, status=radiologist_display_status(assignment), qc_completed_at=assignment.qc_completed_at
    )
