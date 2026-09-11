import datetime
import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ..db.session import get_db
from ..models.models import Assignment, Attachment, DoctorAssessment, Hospital
from ..schemas.schemas import (
    RadiologistCasesResponse, RadiologistCaseItem,
    RadiologistReviewCompleteRequest, RadiologistReviewCompleteResponse,
)
from .auth import get_current_user

router = APIRouter()
REVIEWABLE_VIEW_TYPES = ["mammo_cc_left", "mammo_cc_right", "mammo_mlo_left", "mammo_mlo_right", "mammo_reading"]


def require_radiologist(current_user: dict = Depends(get_current_user)):
    if (current_user.get("role") or "").lower() != "radiologist":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Radiologist access required")
    return current_user


def qc_subject_id(assessment: DoctorAssessment) -> str:
    if assessment.qc_sub_ui_id:
        return assessment.qc_sub_ui_id
    assessment.qc_sub_ui_id = f"QC_{assessment.qc_id:05d}"
    return assessment.qc_sub_ui_id


def _persist_derived_subject_ids(app_db: Session) -> None:
    """Commit any qc_sub_ui_id values filled in by qc_subject_id(). A collision
    means another row already holds the value, so the derived id is still
    returned in the response and the row heals on a later load."""
    try:
        app_db.commit()
    except IntegrityError:
        app_db.rollback()


def _get_assignment_for_case(app_db: Session, case_id: int, radiologist_id: int) -> Assignment:
    assignment = app_db.query(Assignment).filter(
        Assignment.qc_assessment_id == case_id,
        Assignment.qc_radiologist_id == radiologist_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assigned case not found")
    return assignment


def _reviewable_attachments(app_db: Session, assessment: DoctorAssessment) -> list:
    return app_db.query(Attachment).filter(
        Attachment.qc_assessment_id == assessment.qc_id,
        Attachment.qc_file_type.in_(REVIEWABLE_VIEW_TYPES),
    ).all()


# Ordered best-to-worst — mirrors GRADES in frontend/src/constants/caseReviewItems.js.
GRADES_BY_SEVERITY = ["Best", "Good", "Bad", "Not a Mammogram"]


def _case_review(assessment: DoctorAssessment) -> dict:
    try:
        feedback = json.loads(assessment.qc_datapoint_feedback or "{}")
    except (TypeError, ValueError):
        return {}
    case_review = feedback.get("case_review") or {}
    if case_review.get("grade"):
        return case_review
    legacy_reviews = [r for r in (feedback.get("image_reviews") or {}).values() if r and r.get("grade")]
    if not legacy_reviews:
        return {}
    worst = max(legacy_reviews, key=lambda r: GRADES_BY_SEVERITY.index(r["grade"]) if r["grade"] in GRADES_BY_SEVERITY else -1)
    return {
        "grade": worst.get("grade"),
        "reason": "; ".join(r["reason"] for r in legacy_reviews if r.get("reason")) or None,
    }


def _merge_clinical_findings(app_db: Session, assessment: DoctorAssessment, left, right, case_notes):
    if not (left or right or case_notes is not None):
        return
    try:
        existing = assessment.qc_clinical_findings
        existing = json.loads(existing) if isinstance(existing, str) else (existing or {})
    except (TypeError, ValueError):
        existing = {}
    clinical_findings = {
        **existing,
        "left": dict(existing.get("left") or {}),
        "right": dict(existing.get("right") or {}),
    }
    if left:
        clinical_findings["left"].update({k: v for k, v in left.model_dump().items() if v is not None})
    if right:
        clinical_findings["right"].update({k: v for k, v in right.model_dump().items() if v is not None})
    assessment.qc_clinical_findings = clinical_findings
    if case_notes is not None:
        assessment.qc_doctor_case_notes = case_notes


@router.get("/cases", response_model=RadiologistCasesResponse)
def get_my_cases(
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_radiologist),
):
    radiologist_id = current_user["id"]
    assignments = app_db.query(Assignment).filter(
        Assignment.qc_radiologist_id == radiologist_id
    ).order_by(Assignment.qc_id.asc()).all()

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
        cases.append(RadiologistCaseItem(
            qc_subject_id=qc_subject_id(assessment),
            hospital=hospitals.get(assessment.qc_hospital_id),
            case_id=assessment.qc_id,
            session_id=assessment.qc_patient_session_id,
            status=asg.qc_status,
            review_notes=asg.qc_review_notes,
            has_assessment=True,
            assigned_at=asg.qc_assigned_at,
            submitted_response=_case_review(assessment).get("grade"),
        ))

    # cases already holds the derived ids as plain strings, so the response is
    # correct even if this commit rolls back.
    _persist_derived_subject_ids(app_db)

    return RadiologistCasesResponse(user_id=radiologist_id, role=current_user.get("role", ""), cases=cases)


@router.get("/stats")
def get_my_stats(
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_radiologist),
):
    radiologist_id = current_user["id"]
    counts = {"In-Progress": 0, "Completed": 0}
    rows = app_db.query(Assignment.qc_status).filter(
        Assignment.qc_radiologist_id == radiologist_id
    ).all()
    for (status_value,) in rows:
        counts["Completed" if status_value == "Completed" else "In-Progress"] += 1
    return counts


@router.post("/cases/{case_id}/complete", response_model=RadiologistReviewCompleteResponse)
def complete_case_review(
    case_id: int,
    payload: RadiologistReviewCompleteRequest,
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_radiologist),
):
    assignment = _get_assignment_for_case(app_db, case_id, current_user["id"])
    if assignment.qc_status == "Completed":
        raise HTTPException(status_code=400, detail="Case already completed")
    assessment = app_db.query(DoctorAssessment).filter(DoctorAssessment.qc_id == case_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Case not found")

    if not _reviewable_attachments(app_db, assessment):
        raise HTTPException(status_code=400, detail="No images available on this case")

    try:
        feedback = json.loads(assessment.qc_datapoint_feedback or "{}")
    except (TypeError, ValueError):
        feedback = {}
    feedback["case_review"] = {
        "grade": payload.grade,
        "reason": payload.reason,
        "reviewed_at": datetime.datetime.utcnow().isoformat(),
        "reviewed_by": current_user["id"],
    }
    assessment.qc_datapoint_feedback = json.dumps(feedback)

    _merge_clinical_findings(app_db, assessment, payload.left, payload.right, payload.case_notes)

    # One assignment row now carries the whole case, so only the radiologist's
    # own columns are touched here. qc_mammo_tech_id in particular must be left
    # alone — it is what keeps the case visible in the Mammo Tech's list after
    # completion.
    assignment.qc_status = "Completed"
    assignment.qc_review_notes = payload.reason
    assignment.qc_completed_at = datetime.datetime.utcnow()
    app_db.commit()

    next_assignment = app_db.query(Assignment).filter(
        Assignment.qc_radiologist_id == current_user["id"],
        Assignment.qc_status != "Completed",
        Assignment.qc_assessment_id != case_id,
    ).order_by(Assignment.qc_id.asc()).first()

    next_case = None
    if next_assignment:
        next_assessment = app_db.query(DoctorAssessment).filter(
            DoctorAssessment.qc_id == next_assignment.qc_assessment_id
        ).first()
        if next_assessment:
            hospital = app_db.query(Hospital).filter(Hospital.qc_id == next_assessment.qc_hospital_id).first()
            next_case = RadiologistCaseItem(
                qc_subject_id=qc_subject_id(next_assessment),
                hospital=hospital.qc_name if hospital else None,
                case_id=next_assessment.qc_id,
                session_id=next_assessment.qc_patient_session_id,
                status=next_assignment.qc_status,
                review_notes=next_assignment.qc_review_notes,
                has_assessment=True,
                assigned_at=next_assignment.qc_assigned_at,
            )
            _persist_derived_subject_ids(app_db)

    return RadiologistReviewCompleteResponse(
        case_id=case_id, status=assignment.qc_status, qc_completed_at=assignment.qc_completed_at,
        next_case=next_case,
    )