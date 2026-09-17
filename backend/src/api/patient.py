from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, status, Form, Query, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from ..db.session import get_db, get_questionnaire_db
from ..models.models import PatientSession, Question, QuestionTranslation, QuestionOption, QuestionOptionTranslation, PatientResponse, DoctorAssessment, Attachment, Assignment
from ..schemas.schemas import QuestionResponse, QuestionOptionResponse, QuestionnaireSubmission, PatientSessionListItem, PatientSessionDetail, DoctorAssessmentCreate, DoctorAssessmentResponse
from ..core.config import settings
from .auth import get_current_user
from google.cloud import storage
from google.auth import default as auth_default, impersonated_credentials
from urllib.parse import urlparse
from typing import List, Optional
import uuid
import datetime
import pytz
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
    result = db.query(func.max(PatientSession.qc_id)).scalar()
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


def _resolve_gcs_blob(gcs_url, client):
    """Parse a `gs://bucket/path/to/object` storage URL into a GCS blob handle.

    Always reads from the configured GCP_STORAGE_BUCKET regardless of the
    bucket name embedded in the URL. This ensures QC portal reads from its
    own anonymized bucket even when URLs synced from BCD reference the
    original bucket.
    """
    if not gcs_url or not gcs_url.startswith("gs://"):
        raise HTTPException(status_code=400, detail="Invalid storage URL")

    parsed = urlparse(gcs_url)
    bucket_name = settings.GCP_STORAGE_BUCKET
    blob_path = parsed.path.lstrip("/")
    if not bucket_name or not blob_path:
        raise HTTPException(status_code=400, detail="Invalid storage URL")

    return client.bucket(bucket_name).blob(blob_path)

def _authorize_attachment_access(attachment, db, current_user):
    """
    Raises HTTPException if the current user can't view this attachment.
    Mirrors the auth branching in get_patient_session_detail():
      - super viewers: always allowed
      - radiologists/mammo techs: allowed only if assigned to this attachment's assessment
      - everyone else: allowed only if the assessment belongs to their hospital
    """
    user_role = (current_user.get("role") or "").lower()
    is_super_viewer = current_user.get("is_super_viewer", False) or \
        current_user.get("email", "").lower().endswith("@tanuh.ai")

    if is_super_viewer:
        assessment = db.query(DoctorAssessment).filter(
            DoctorAssessment.qc_id == attachment.qc_assessment_id
        ).first()
        if not assessment:
            raise HTTPException(status_code=403, detail="Not authorized to view this file")
        return

    if user_role in ("radiologist", "mammo tech"):
        is_assigned = db.query(Assignment).filter(
            Assignment.qc_assessment_id == attachment.qc_assessment_id,
            Assignment.qc_radiologist_id == current_user.get("id"),
        ).first() is not None
        if not is_assigned:
            raise HTTPException(status_code=403, detail="Not authorized to view this file")
        return
 
    hospital_id = current_user.get("hospital_id")
    if not hospital_id:
        raise HTTPException(status_code=400, detail="User hospital ID not found")
 
    assessment = db.query(DoctorAssessment).filter(
        DoctorAssessment.qc_id == attachment.qc_assessment_id,
        DoctorAssessment.qc_hospital_id == hospital_id
    ).first()
    if not assessment:
        raise HTTPException(status_code=403, detail="Not authorized to view this file")
 
 
@router.get("/view-url/{attachment_id}")
def get_view_url(
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    attachment = db.query(Attachment).filter(Attachment.qc_id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
 
    _authorize_attachment_access(attachment, db, current_user)

    client = _get_storage_client()
    blob = _resolve_gcs_blob(attachment.qc_storage_url, client)

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
        "file_name": attachment.qc_file_name,
        "mime_type": attachment.qc_mime_type,
    }

CONVERTED_CACHE_PREFIX = "qc-converted-cache"
SCREEN_MAX_DIM = 2000


def _cached_dicom_blob(client, attachment_id: int, resolution: str):
    return client.bucket(settings.GCP_STORAGE_BUCKET).blob(
        f"{CONVERTED_CACHE_PREFIX}/{attachment_id}/{resolution}.dcm"
    )


def _load_cached_dicom(client, attachment_id: int, resolution: str):
    try:
        return _cached_dicom_blob(client, attachment_id, resolution).download_as_bytes()
    except Exception:
        return None


def _store_cached_dicom(attachment_id: int, resolution: str, content: bytes):
    try:
        client = _get_storage_client()
        _cached_dicom_blob(client, attachment_id, resolution).upload_from_string(content, content_type="application/dicom")
    except Exception:
        logger.warning("Failed to write downsampled-DICOM cache for attachment %s (%s)", attachment_id, resolution, exc_info=True)


def _downsample_dicom_bytes(content: bytes, max_dim: int) -> bytes:
    import io
    import numpy as np
    import pydicom
    from PIL import Image

    ds = pydicom.dcmread(io.BytesIO(content))
    if ds.file_meta.TransferSyntaxUID.is_compressed:
        ds.decompress()

    array = ds.pixel_array
    is_color = array.ndim == 3 and array.shape[-1] in (3, 4)
    rows, cols = array.shape[0], array.shape[1]
    longest_edge = max(rows, cols)

    if longest_edge > max_dim:
        scale = max_dim / float(longest_edge)
        new_cols = max(1, round(cols * scale))
        new_rows = max(1, round(rows * scale))

        if is_color:
            resized = np.array(Image.fromarray(array).resize((new_cols, new_rows), Image.Resampling.LANCZOS))
        else:
            frame = array if array.ndim == 2 else array[0]
            dtype = frame.dtype
            # "F" (32-bit float) mode round-trips any integer bit depth
            # safely — PIL's native 16-bit mode ("I;16") doesn't support
            # resize reliably.
            as_float = Image.fromarray(frame.astype(np.float32), mode="F")
            resized = np.array(as_float.resize((new_cols, new_rows), Image.Resampling.LANCZOS)).astype(dtype)

        ds.PixelData = resized.tobytes()
        ds.Rows, ds.Columns = resized.shape[0], resized.shape[1]
        if getattr(ds, "PixelSpacing", None):
            try:
                ds.PixelSpacing = [type(v)(float(v) / scale) for v in ds.PixelSpacing]
            except Exception:
                pass

    ds.file_meta.TransferSyntaxUID = "1.2.840.10008.1.2.1"  # Explicit VR Little Endian
    out = io.BytesIO()
    ds.save_as(out)
    return out.getvalue()


@router.get("/view-file/{attachment_id}")
def view_file(
    attachment_id: int,
    background_tasks: BackgroundTasks,
    resolution: str = Query("screen", pattern="^(screen|full)$"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    from fastapi.responses import Response

    attachment = db.query(Attachment).filter(Attachment.qc_id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    _authorize_attachment_access(attachment, db, current_user)

    client = _get_storage_client()

    served_from_cache = False
    blob = None
    if resolution == "screen":
        cached = _load_cached_dicom(client, attachment_id, resolution)
        if cached is not None:
            content = cached
            mime = "application/dicom"
            served_from_cache = True

    if not served_from_cache:
        blob = _resolve_gcs_blob(attachment.qc_storage_url, client)
        if not blob.exists():
            raise HTTPException(
                status_code=404,
                detail=f"File not found in storage (bucket={blob.bucket.name}, path={blob.name})"
            )

        try:
            content = blob.download_as_bytes()
            mime = attachment.qc_mime_type or "application/octet-stream"

            # Some files carrying a DICOM-view qc_file_type (mammo_cc_left, etc.)
            # are actually a plain image uploaded under the wrong type — sniff
            # magic bytes rather than trusting qc_mime_type.
            if content[:2] == b"\xff\xd8":
                mime = "image/jpeg"
            elif content[:8] == b"\x89PNG\r\n\x1a\n":
                mime = "image/png"
            elif len(content) >= 132 and content[128:132] == b'DICM':
                mime = "application/dicom"
                if resolution == "screen":
                    try:
                        content = _downsample_dicom_bytes(content, SCREEN_MAX_DIM)
                        background_tasks.add_task(_store_cached_dicom, attachment_id, "screen", content)
                    except Exception:
                        
                        logger.warning("DICOM downsample failed for attachment %s, serving original bytes", attachment_id, exc_info=True)
                
        except Exception as e:
            
            logger.error("Failed to load attachment %s from storage: %s", attachment_id, e, exc_info=True)
            raise HTTPException(status_code=500, detail=f"Could not load attachment: {e}")

    headers = {
        "Content-Disposition": f'inline; filename="{attachment.qc_file_name}"',
        "Cache-Control": "private, max-age=31536000, immutable",
    }
    if not served_from_cache and blob is not None:
        try:
            etag = getattr(blob, "etag", None)
            if etag:
                headers["ETag"] = etag if etag.startswith('"') else f'"{etag}"'
        except Exception:
            logger.warning("Could not read ETag for attachment %s", attachment_id, exc_info=True)

    return Response(
        content=content,
        media_type=mime,
        headers=headers,
    )
 