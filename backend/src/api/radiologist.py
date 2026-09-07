import datetime
import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..db.session import get_db
from ..models.models import Assignment, Attachment, DoctorAssessment, Hospital
from ..schemas.schemas import (
    RadiologistCasesResponse, RadiologistCaseItem,
    RadiologistReviewCompleteRequest, RadiologistReviewCompleteResponse,
    ImageReviewRequest, ImageReviewResponse,
)
from .auth import get_current_user

router = APIRouter()

# The four mammography DICOM views BreastCaseReviewPanel.jsx already treats as
# "the mammography views" for a case. Only whichever of these are actually
# present as attachments on a given assessment count as its reviewable images —
# cases aren't assumed to always have all four.
REVIEWABLE_VIEW_TYPES = ["mammo_cc_left", "mammo_cc_right", "mammo_mlo_left", "mammo_mlo_right"]


def require_radiologist(current_user: dict = Depends(get_current_user)):
    if (current_user.get("role") or "").lower() != "radiologist":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Radiologist access required")
    return current_user


def _get_assignment_for_case(app_db: Session, case_id: int, radiologist_id: int) -> Assignment:
    assignment = app_db.query(Assignment).filter(
        Assignment.qc_assessment_id == case_id,
        Assignment.qc_radiologist_id == radiologist_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assigned case not found")
    return assignment


def _load_feedback(assessment: DoctorAssessment) -> dict:
    """qc_datapoint_feedback is a free Text column with no live reader/writer
    before this feature — safe to define a fresh JSON shape here. Kept as a
    top-level dict (not just the image_reviews map) so a future sibling key
    (e.g. "adjudication") can be added later without disturbing this one."""
    try:
        data = json.loads(assessment.qc_datapoint_feedback or "{}")
    except (TypeError, ValueError):
        data = {}
    data.setdefault("image_reviews", {})
    return data


def _reviewable_attachments(app_db: Session, assessment: DoctorAssessment) -> list:
    return app_db.query(Attachment).filter(
        Attachment.qc_assessment_id == assessment.qc_id,
        Attachment.qc_file_type.in_(REVIEWABLE_VIEW_TYPES),
    ).all()


def _review_progress(app_db: Session, assessment: DoctorAssessment):
    """Returns (image_reviews dict, reviewable Attachment rows, reviewed_count)."""
    feedback = _load_feedback(assessment)
    image_reviews = feedback["image_reviews"]
    attachments = _reviewable_attachments(app_db, assessment)
    reviewed_count = sum(1 for a in attachments if str(a.qc_id) in image_reviews)
    return image_reviews, attachments, reviewed_count


@router.get("/cases", response_model=RadiologistCasesResponse)
def get_my_cases(
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_radiologist),
):
    """Cases assigned to the currently authenticated Radiologist. The radiologist
    id is taken only from the verified JWT (get_current_user) — never from a
    client-supplied parameter — so one radiologist cannot request another's cases."""
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


@router.post("/cases/{case_id}/images/{attachment_id}/review", response_model=ImageReviewResponse)
def review_image(
    case_id: int,
    attachment_id: int,
    payload: ImageReviewRequest,
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_radiologist),
):
    """Saves the grade/reason for one DICOM image on an assigned case, plus
    whatever BIRADS/Density/case-notes fields were carried alongside it. The
    first review on a case flips it from Pending to In-Progress."""
    assignment = _get_assignment_for_case(app_db, case_id, current_user["id"])
    assessment = app_db.query(DoctorAssessment).filter(DoctorAssessment.qc_id == case_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Case not found")

    attachment = app_db.query(Attachment).filter(
        Attachment.qc_id == attachment_id,
        Attachment.qc_assessment_id == case_id,
        Attachment.qc_file_type.in_(REVIEWABLE_VIEW_TYPES),
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Image not found on this case")

    feedback = _load_feedback(assessment)
    feedback["image_reviews"][str(attachment_id)] = {
        "grade": payload.grade,
        "reason": payload.reason,
        "reviewed_at": datetime.datetime.utcnow().isoformat(),
        "reviewed_by": current_user["id"],
    }
    assessment.qc_datapoint_feedback = json.dumps(feedback)

    if payload.left or payload.right or payload.case_notes is not None:
        try:
            existing = assessment.qc_clinical_findings
            existing = json.loads(existing) if isinstance(existing, str) else (existing or {})
        except (TypeError, ValueError):
            existing = {}
        # Copy into fresh dict objects (top-level and each side) rather than
        # mutating the loaded object in place — SQLAlchemy's plain (non-Mutable)
        # JSON column compares the reassigned value against the originally
        # loaded object by reference/equality, so mutating-then-reassigning the
        # *same* object is silently treated as "no change" and never persisted.
        clinical_findings = {
            **existing,
            "left": dict(existing.get("left") or {}),
            "right": dict(existing.get("right") or {}),
        }
        if payload.left:
            clinical_findings["left"].update({k: v for k, v in payload.left.model_dump().items() if v is not None})
        if payload.right:
            clinical_findings["right"].update({k: v for k, v in payload.right.model_dump().items() if v is not None})
        assessment.qc_clinical_findings = clinical_findings
        if payload.case_notes is not None:
            assessment.qc_doctor_case_notes = payload.case_notes

    if assignment.qc_status == "Pending":
        assignment.qc_status = "In-Progress"

    app_db.commit()

    _, attachments, reviewed_count = _review_progress(app_db, assessment)
    total_images = len(attachments)

    return ImageReviewResponse(
        case_id=case_id,
        attachment_id=attachment_id,
        grade=payload.grade,
        reason=payload.reason,
        all_images_reviewed=(total_images > 0 and reviewed_count == total_images),
        reviewed_count=reviewed_count,
        total_images=total_images,
    )


@router.post("/cases/{case_id}/complete", response_model=RadiologistReviewCompleteResponse)
def complete_case_review(
    case_id: int,
    payload: RadiologistReviewCompleteRequest,
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(require_radiologist),
):
    """Marks an assigned case as reviewed and completed, once every reviewable
    image on it has a saved grade. The assignment must belong to the currently
    authenticated radiologist."""
    assignment = _get_assignment_for_case(app_db, case_id, current_user["id"])
    assessment = app_db.query(DoctorAssessment).filter(DoctorAssessment.qc_id == case_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Case not found")

    _, attachments, reviewed_count = _review_progress(app_db, assessment)
    if not attachments:
        raise HTTPException(status_code=400, detail="No images available on this case")
    if reviewed_count < len(attachments):
        raise HTTPException(status_code=400, detail="Unable to complete case. Please try again.")

    assignment.qc_status = "Completed"
    if payload.notes is not None:
        assignment.qc_review_notes = payload.notes
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
                qc_subject_id=next_assessment.qc_sub_ui_id or next_assessment.qc_patient_session_id,
                hospital=hospital.qc_name if hospital else None,
                case_id=next_assessment.qc_id,
                session_id=next_assessment.qc_patient_session_id,
                status=next_assignment.qc_status,
                review_notes=next_assignment.qc_review_notes,
                has_assessment=True,
            )

    return RadiologistReviewCompleteResponse(
        case_id=case_id, status=assignment.qc_status, qc_completed_at=assignment.qc_completed_at,
        next_case=next_case,
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
