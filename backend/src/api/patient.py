from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, status, Form
from sqlalchemy.orm import Session, joinedload
from ..db.session import get_db, get_questionnaire_db
from ..models.models import PatientSession, Question, QuestionTranslation, QuestionOption, QuestionOptionTranslation, PatientResponse, DoctorAssessment, Attachment
from ..schemas.schemas import QuestionResponse, QuestionOptionResponse, QuestionnaireSubmission, PatientSessionListItem, PatientSessionDetail, DoctorAssessmentCreate, DoctorAssessmentResponse
from ..core.config import settings
from .auth import get_current_user
from google.cloud import storage
from google.auth import default as auth_default, impersonated_credentials
from typing import List, Optional
import uuid
import datetime
import pytz
import json
import time
import logging

logger = logging.getLogger(__name__)

_SA_EMAIL = "tanuh-bcd-portal@bcd-prototypes.iam.gserviceaccount.com"

router = APIRouter()

GCS_BASE_PREFIX = "tanuh-data-capture"

FILE_TYPE_MAP = {
    "mammo_dicom": "mammogram",
    "mammo_cc_left": "mammogram",
    "mammo_cc_right": "mammogram",
    "mammo_mlo_left": "mammogram",
    "mammo_mlo_right": "mammogram",
    "mammo_reading": "mammogram-report",
    "annot_cc_left": "annotation",
    "annot_cc_right": "annotation",
    "annot_mlo_left": "annotation",
    "annot_mlo_right": "annotation",
    "us_video": "ultrasound",
    "us_reading": "ultrasound-report",
    "biopsy_reading": "biopsy",
    "consent": "consent",
}

ADDITIONAL_DOC_PREFIXES = (
    "additional_histopathology",
    "additional_ihc",
    "additional_prior_imaging",
    "additional_other_imaging",
    "additional_mammo_views",
)

def _resolve_doc_type(file_type):
    if file_type in FILE_TYPE_MAP:
        return FILE_TYPE_MAP[file_type]
    for prefix in ADDITIONAL_DOC_PREFIXES:
        if file_type.startswith(prefix):
            return "additional-docs"
    return file_type

def get_ist_now():
    return datetime.datetime.now(pytz.timezone('Asia/Kolkata'))

def generate_subject_id(db):
    from sqlalchemy import func
    result = db.query(func.max(PatientSession.id)).scalar()
    if result and result.startswith("subject_"):
        num = int(result.split("_")[1]) + 1
    else:
        num = 1
    return f"subject_{num:05d}"

def build_blob_path(clinic_id, subject_id, file_type, original_filename, ist_now, seq=None):
    doc_type = _resolve_doc_type(file_type)
    extension = original_filename.rsplit('.', 1)[-1] if '.' in original_filename else 'bin'
    upload_date = ist_now.strftime("%Y%m%d")
    detail = f"{file_type}-{seq}" if seq is not None else file_type
    doc_name = f"{clinic_id}_{subject_id}_{detail}_{upload_date}.{extension}"
    return f"{GCS_BASE_PREFIX}/{clinic_id}/{subject_id}/{doc_type}/{doc_name}"

def upload_to_gcs(file_content, destination_blob_name):
    if not settings.GCP_STORAGE_BUCKET:
        raise Exception("GCP_STORAGE_BUCKET not configured")

    storage_client = storage.Client()
    bucket = storage_client.bucket(settings.GCP_STORAGE_BUCKET)
    blob = bucket.blob(destination_blob_name)
    blob.upload_from_string(file_content, content_type="application/octet-stream")
    return f"gs://{settings.GCP_STORAGE_BUCKET}/{destination_blob_name}"

def _get_storage_client():
    return storage.Client()


@router.post("/upload-url")
def generate_upload_url(
    request: Request,
    file_type: str = Form(...),
    file_name: str = Form(...),
    session_id: str = Form(...),
    current_user: dict = Depends(get_current_user)
):
    hospital_id = current_user.get("hospital_id")
    if not hospital_id:
        raise HTTPException(status_code=400, detail="User hospital ID not found")

    if not settings.GCP_STORAGE_BUCKET:
        raise HTTPException(status_code=500, detail="GCP_STORAGE_BUCKET not configured")

    ist_now = get_ist_now()
    blob_path = build_blob_path(hospital_id, session_id, file_type, file_name, ist_now)

    origin = request.headers.get("origin", "")

    try:
        client = _get_storage_client()
        bucket = client.bucket(settings.GCP_STORAGE_BUCKET)
        blob = bucket.blob(blob_path)

        upload_url = blob.create_resumable_upload_session(
            content_type="application/octet-stream",
            origin=origin,
        )
    except Exception as e:
        print(f"Failed to create upload session: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Could not generate upload URL: {str(e)}"
        )

    gcs_url = f"gs://{settings.GCP_STORAGE_BUCKET}/{blob_path}"
    return {
        "upload_url": upload_url,
        "gcs_url": gcs_url,
        "blob_path": blob_path,
    }


@router.get("/view-url/{attachment_id}")
def get_view_url(
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    hospital_id = current_user.get("hospital_id")
    if not hospital_id:
        raise HTTPException(status_code=400, detail="User hospital ID not found")

    attachment = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    is_super_viewer = current_user.get("is_super_viewer", False) or \
        current_user.get("email", "").lower().endswith("@tanuh.ai")

    if is_super_viewer:
        assessment = db.query(DoctorAssessment).filter(
            DoctorAssessment.id == attachment.assessment_id
        ).first()
    else:
        assessment = db.query(DoctorAssessment).filter(
            DoctorAssessment.id == attachment.assessment_id,
            DoctorAssessment.hospital_id == hospital_id
        ).first()
    if not assessment:
        raise HTTPException(status_code=403, detail="Not authorized to view this file")

    gcs_url = attachment.storage_url
    if not gcs_url or not gcs_url.startswith("gs://"):
        raise HTTPException(status_code=400, detail="Invalid storage URL")

    parts = gcs_url.split("/")
    stored_bucket = parts[2] if len(parts) > 2 else None
    blob_path = "/".join(parts[3:])

    use_bucket = stored_bucket or settings.GCP_STORAGE_BUCKET
    client = _get_storage_client()
    bucket = client.bucket(use_bucket)
    blob = bucket.blob(blob_path)

    try:
        credentials, _ = auth_default()
        if not hasattr(credentials, 'sign_bytes'):
            signing_creds = impersonated_credentials.Credentials(
                source_credentials=credentials,
                target_principal=_SA_EMAIL,
                target_scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )
        else:
            signing_creds = credentials

        signed_url = blob.generate_signed_url(
            version="v4",
            expiration=datetime.timedelta(hours=1),
            method="GET",
            credentials=signing_creds,
        )
    except Exception as e:
        logger.warning("Signed URL generation failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not generate signed URL")

    return {
        "view_url": signed_url,
        "file_name": attachment.file_name,
        "mime_type": attachment.mime_type,
    }


@router.get("/view-file/{attachment_id}")
def view_file(
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    from fastapi.responses import Response

    hospital_id = current_user.get("hospital_id")
    if not hospital_id:
        raise HTTPException(status_code=400, detail="User hospital ID not found")

    attachment = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    is_super_viewer = current_user.get("is_super_viewer", False) or \
        current_user.get("email", "").lower().endswith("@tanuh.ai")

    if is_super_viewer:
        assessment = db.query(DoctorAssessment).filter(
            DoctorAssessment.id == attachment.assessment_id
        ).first()
    else:
        assessment = db.query(DoctorAssessment).filter(
            DoctorAssessment.id == attachment.assessment_id,
            DoctorAssessment.hospital_id == hospital_id
        ).first()
    if not assessment:
        raise HTTPException(status_code=403, detail="Not authorized to view this file")

    gcs_url = attachment.storage_url
    if not gcs_url or not gcs_url.startswith("gs://"):
        raise HTTPException(status_code=400, detail="Invalid storage URL")

    parts = gcs_url.split("/")
    stored_bucket = parts[2] if len(parts) > 2 else None
    blob_path = "/".join(parts[3:])

    use_bucket = stored_bucket or settings.GCP_STORAGE_BUCKET
    client = _get_storage_client()
    bucket = client.bucket(use_bucket)
    blob = bucket.blob(blob_path)

    if not blob.exists():
        raise HTTPException(
            status_code=404,
            detail=f"File not found in storage (bucket={use_bucket}, path={blob_path})"
        )

    content = blob.download_as_bytes()
    mime = attachment.mime_type or "application/octet-stream"

    if len(content) >= 132 and content[128:132] == b'DICM':
        mime = "application/dicom"
        try:
            import pydicom
            import io

            ds = pydicom.dcmread(io.BytesIO(content))
            transfer_syntax = ds.file_meta.TransferSyntaxUID

            is_compressed = transfer_syntax not in (
                "1.2.840.10008.1.2",
                "1.2.840.10008.1.2.1",
                "1.2.840.10008.1.2.2",
            )
            if is_compressed:
                ds.decompress()
                ds.file_meta.TransferSyntaxUID = "1.2.840.10008.1.2"
                out_buf = io.BytesIO()
                ds.save_as(out_buf)
                content = out_buf.getvalue()
        except Exception:
            pass

    return Response(
        content=content,
        media_type=mime,
        headers={
            "Content-Disposition": f'inline; filename="{attachment.file_name}"',
        },
    )


@router.post("/upload-complete")
def record_upload(
    session_id: str = Form(...),
    file_type: str = Form(...),
    file_name: str = Form(...),
    gcs_url: str = Form(...),
    mime_type: str = Form(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    hospital_id = current_user.get("hospital_id")
    doctor_id = current_user.get("id")

    assessment = db.query(DoctorAssessment).filter(
        DoctorAssessment.patient_session_id == session_id
    ).first()

    if not assessment:
        assessment = DoctorAssessment(
            patient_session_id=session_id,
            hospital_id=hospital_id,
            doctor_id=doctor_id,
        )
        db.add(assessment)
        db.flush()

    if file_type.startswith("additional_"):
        att = Attachment(
            assessment_id=assessment.id,
            file_type=file_type,
            file_name=file_name,
            storage_url=gcs_url,
            mime_type=mime_type,
        )
        db.add(att)
    else:
        att = db.query(Attachment).filter(
            Attachment.assessment_id == assessment.id,
            Attachment.file_type == file_type
        ).first()

        if att:
            att.file_name = file_name
            att.storage_url = gcs_url
            att.mime_type = mime_type
        else:
            att = Attachment(
                assessment_id=assessment.id,
                file_type=file_type,
                file_name=file_name,
                storage_url=gcs_url,
                mime_type=mime_type,
            )
            db.add(att)

    db.commit()
    db.refresh(att)
    return {
        "success": True,
        "attachment": {
            "id": att.id,
            "file_type": att.file_type,
            "file_name": att.file_name,
            "mime_type": att.mime_type,
        },
    }


@router.get("/questions", response_model=List[QuestionResponse])
def get_questions(lang: str = "en", db: Session = Depends(get_db)):
    # Optimized query with joinedload to fetch translations and options in fewer queries
    questions = db.query(Question).options(
        joinedload(Question.translations),
        joinedload(Question.options).joinedload(QuestionOption.translations)
    ).order_by(Question.id).all()
    
    response = []
    for q in questions:
        # Find the translation for the requested language or fallback to English
        trans = next((t for t in q.translations if t.language_code == lang), None)
        if not trans and lang != "en":
            trans = next((t for t in q.translations if t.language_code == "en"), None)
        
        # Use q.question from questions table if lang is 'en' or translation is not found
        question_text = q.question if (lang == "en" and q.question) else (trans.question_text if trans else q.question)
        
        if not question_text:
            continue
            
        options = []
        for opt in q.options:
            opt_trans = next((t for t in opt.translations if t.language_code == lang), None)
            if not opt_trans and lang != "en":
                opt_trans = next((t for t in opt.translations if t.language_code == "en"), None)
            
            if opt_trans:
                options.append(QuestionOptionResponse(
                    id=opt.id,
                    option_value=opt.option_value,
                    option_label=opt_trans.option_label,
                    sort_order=opt.sort_order
                ))
        
        response.append(QuestionResponse(
            id=q.id,
            section=q.section,
            response_type=q.response_type,
            input_type=q.input_type,
            is_required=q.is_required,
            min_value=q.min_value,
            max_value=q.max_value,
            placeholder=q.placeholder,
            question_text=question_text,
            parent_question_id=q.parent_question_id,
            trigger_answer=q.trigger_answer,
            options=sorted(options, key=lambda x: x.sort_order)
        ))
    
    return response

@router.post("/consent")
async def upload_consent(
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    start_time = time.time()
    try:
        hospital_id = current_user.get("hospital_id")
        if not hospital_id:
             raise HTTPException(status_code=400, detail="User hospital ID not found")

        gcs_url = None
        ist_now = get_ist_now()

        subject_id = generate_subject_id(db)

        if file:
            content = await file.read()
            extension = file.filename.rsplit('.', 1)[-1] if '.' in file.filename else 'jpg'
            upload_date = ist_now.strftime("%Y%m%d")
            consent_blob = f"{GCS_BASE_PREFIX}/consent/{hospital_id}_{subject_id}_consent_{upload_date}.{extension}"
            gcs_url = upload_to_gcs(content, consent_blob)

        new_session = PatientSession(
            id=subject_id,
            hospital_id=hospital_id,
            consent_scanned_url=gcs_url,
            consent_timestamp=ist_now
        )
        db.add(new_session)
        db.commit()
        db.refresh(new_session)
        
        duration = time.time() - start_time
        print(f"Time taken for POST /api/v1/patient/consent: {duration:.4f} seconds")
        
        return {"id": new_session.id, "consent_scanned_url": gcs_url}
        
    except Exception as e:
        duration = time.time() - start_time
        print(f"Time taken for POST /api/v1/patient/consent (FAILED): {duration:.4f} seconds")
        print(f"Error uploading consent: {e}")
        error_detail = str(e)
        if "403" in error_detail:
            error_detail = "Permission denied: Service account does not have write access to GCS bucket."
        elif "not configured" in error_detail:
            error_detail = "GCS bucket is not configured in settings."
            
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not upload consent: {error_detail}"
        )

@router.post("/questionnaire")
async def submit_questionnaire(
    submission: QuestionnaireSubmission,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    try:
        hospital_id = current_user.get("hospital_id")
        if not hospital_id:
            raise HTTPException(status_code=400, detail="User hospital ID not found")
        
        # Verify session exists and belongs to the hospital
        session = db.query(PatientSession).filter(
            PatientSession.id == submission.session_id,
            PatientSession.hospital_id == hospital_id
        ).first()
        
        if not session:
            raise HTTPException(status_code=404, detail="Patient session not found")
        
        # Save responses
        for resp in submission.responses:
            new_response = PatientResponse(
                hospital_id=hospital_id,
                session_id=submission.session_id,
                question=resp.question,
                answer=resp.answer
            )
            db.add(new_response)
        
        db.commit()
        return {"status": "success", "message": "Questionnaire responses saved"}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error saving questionnaire: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not save questionnaire responses: {str(e)}"
        )

@router.post("/assessment", response_model=DoctorAssessmentResponse)
async def create_doctor_assessment(
    patient_session_id: str = Form(...),
    questionnaire_feedback: Optional[str] = Form(None),
    is_questionnaire_correct: bool = Form(False),
    mammo_birads: Optional[str] = Form(None),
    mammo_density: Optional[str] = Form(None),
    us_biopsy_birads: Optional[str] = Form(None),
    us_biopsy_density: Optional[str] = Form(None),
    precision_diagnosis: Optional[str] = Form(None),
    datapoint_feedback: Optional[str] = Form(None),
    clinical_findings: Optional[str] = Form(None),
    recommendation_followup: Optional[str] = Form(None),
    routine_views_uploaded: bool = Form(False),
    doctor_risk_class: Optional[str] = Form(None),
    doctor_case_notes: Optional[str] = Form(None),
    mammo_cc_left: Optional[UploadFile] = File(None),
    mammo_cc_right: Optional[UploadFile] = File(None),
    mammo_mlo_left: Optional[UploadFile] = File(None),
    mammo_mlo_right: Optional[UploadFile] = File(None),
    mammo_dicom: List[UploadFile] = File([]),
    mammo_reading: Optional[UploadFile] = File(None),
    us_video: Optional[UploadFile] = File(None),
    us_reading: Optional[UploadFile] = File(None),
    biopsy_doc: Optional[UploadFile] = File(None),
    annot_cc_left: Optional[UploadFile] = File(None),
    annot_cc_right: Optional[UploadFile] = File(None),
    annot_mlo_left: Optional[UploadFile] = File(None),
    annot_mlo_right: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    q_db: Session = Depends(get_questionnaire_db),
    current_user: dict = Depends(get_current_user)
):
    # Phase 1: Save assessment data (always persisted, even if file uploads fail)
    try:
        hospital_id = current_user.get("hospital_id")
        doctor_id = current_user.get("id")
        user_role = current_user.get("role")

        if not hospital_id or not doctor_id:
            raise HTTPException(status_code=400, detail="User hospital ID or doctor ID not found")

        from sqlalchemy import text as sql_text
        session_row = q_db.execute(sql_text(
            "SELECT session_id FROM session_table WHERE session_id = :sid"
        ), {"sid": patient_session_id}).fetchone()

        if not session_row:
            raise HTTPException(status_code=404, detail="Patient session not found")

        assessment = db.query(DoctorAssessment).filter(
            DoctorAssessment.patient_session_id == patient_session_id
        ).first()

        if assessment:
            is_admin = (user_role or '').lower() == 'admin'
            if assessment.hospital_id != hospital_id and not is_admin:
                raise HTTPException(
                    status_code=403,
                    detail="Not authorized to edit another hospital's assessment",
                )

            assessment.questionnaire_feedback = questionnaire_feedback
            assessment.is_questionnaire_correct = is_questionnaire_correct
            assessment.mammo_birads = mammo_birads
            assessment.mammo_density = mammo_density
            assessment.us_biopsy_birads = us_biopsy_birads
            assessment.us_biopsy_density = us_biopsy_density
            assessment.precision_diagnosis = precision_diagnosis
            assessment.datapoint_feedback = datapoint_feedback
            assessment.clinical_findings = json.loads(clinical_findings) if clinical_findings else None
            assessment.recommendation_followup = recommendation_followup
            assessment.routine_views_uploaded = routine_views_uploaded
            assessment.doctor_risk_class = doctor_risk_class
            assessment.doctor_case_notes = doctor_case_notes
        else:
            assessment = DoctorAssessment(
                patient_session_id=patient_session_id,
                hospital_id=hospital_id,
                doctor_id=doctor_id,
                questionnaire_feedback=questionnaire_feedback,
                is_questionnaire_correct=is_questionnaire_correct,
                mammo_birads=mammo_birads,
                mammo_density=mammo_density,
                us_biopsy_birads=us_biopsy_birads,
                us_biopsy_density=us_biopsy_density,
                precision_diagnosis=precision_diagnosis,
                datapoint_feedback=datapoint_feedback,
                clinical_findings=json.loads(clinical_findings) if clinical_findings else None,
                recommendation_followup=recommendation_followup,
                routine_views_uploaded=routine_views_uploaded,
                doctor_risk_class=doctor_risk_class,
                doctor_case_notes=doctor_case_notes,
            )
            db.add(assessment)

        db.commit()
        db.refresh(assessment)

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error saving doctor assessment: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not save doctor assessment: {str(e)}"
        )

    # Phase 2: Upload files (failures are non-fatal — assessment data is already saved)
    upload_warnings = []
    ist_now = get_ist_now()

    async def handle_upload(file: UploadFile, file_type: str, replace: bool = False, seq=None):
        try:
            if replace:
                db.query(Attachment).filter(
                    Attachment.assessment_id == assessment.id,
                    Attachment.file_type == file_type
                ).delete()

            content = await file.read()
            destination_blob_name = build_blob_path(hospital_id, patient_session_id, file_type, file.filename, ist_now, seq=seq)
            gcs_url = upload_to_gcs(content, destination_blob_name)

            attachment = Attachment(
                assessment_id=assessment.id,
                file_type=file_type,
                file_name=file.filename,
                storage_url=gcs_url,
                mime_type=file.content_type
            )
            db.add(attachment)
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"File upload failed for {file_type}: {e}")
            upload_warnings.append(f"Failed to upload {file_type}: {str(e)}")

    file_uploads = []
    for idx, dicom_file in enumerate(mammo_dicom, start=1):
        if dicom_file.filename:
            file_uploads.append((dicom_file, "mammo_dicom", False, idx))

    for file_obj, file_type in [
        (mammo_cc_left, "mammo_cc_left"), (mammo_cc_right, "mammo_cc_right"),
        (mammo_mlo_left, "mammo_mlo_left"), (mammo_mlo_right, "mammo_mlo_right"),
        (mammo_reading, "mammo_reading"), (us_video, "us_video"),
        (us_reading, "us_reading"), (annot_cc_left, "annot_cc_left"),
        (annot_cc_right, "annot_cc_right"), (annot_mlo_left, "annot_mlo_left"),
        (annot_mlo_right, "annot_mlo_right"),
    ]:
        if file_obj and file_obj.filename:
            file_uploads.append((file_obj, file_type, True, None))

    if biopsy_doc and biopsy_doc.filename:
        file_uploads.append((biopsy_doc, "biopsy_reading", True, None))

    for file_obj, file_type, replace, seq in file_uploads:
        await handle_upload(file_obj, file_type, replace=replace, seq=seq)

    db.refresh(assessment)
    assessment.upload_warnings = upload_warnings if upload_warnings else None
    return assessment
