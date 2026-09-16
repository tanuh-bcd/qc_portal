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


def _converted_cache_blob(client, attachment_id: int, resolution: str, suffix: str):
    return client.bucket(settings.GCP_STORAGE_BUCKET).blob(
        f"{CONVERTED_CACHE_PREFIX}/{attachment_id}/{resolution}.{suffix}"
    )


def _load_cached_conversion(client, attachment_id: int, resolution: str):
    """Returns (png_bytes, meta) if this attachment+resolution was already
    converted and cached, else None. Two small reads against our own cache
    prefix — still far cheaper than re-downloading and re-decoding the
    original DICOM file, and skips touching the original blob entirely."""
    try:
        meta = json.loads(_converted_cache_blob(client, attachment_id, resolution, "meta.json").download_as_bytes())
        content = _converted_cache_blob(client, attachment_id, resolution, "png").download_as_bytes()
    except Exception:
        return None
    return content, meta


def _store_cached_conversion(attachment_id: int, resolution: str, content: bytes, meta: dict):
    """Writes a converted copy to the cache prefix. Called as a FastAPI
    BackgroundTask so the triggering request returns to the client without
    waiting on the extra GCS upload round-trip. Failures are logged and
    swallowed — a cache write failing just means the next view redoes the
    conversion, nothing is lost or corrupted."""
    try:
        client = _get_storage_client()
        _converted_cache_blob(client, attachment_id, resolution, "png").upload_from_string(content, content_type="image/png")
        _converted_cache_blob(client, attachment_id, resolution, "meta.json").upload_from_string(
            json.dumps(meta), content_type="application/json"
        )
    except Exception:
        logger.warning("Failed to write converted-image cache for attachment %s (%s)", attachment_id, resolution, exc_info=True)


def _resize_png_bytes(png_bytes: bytes, max_dim: int) -> bytes:
    """Downscales a PNG so its longest edge is at most max_dim, preserving
    aspect ratio — a no-op if it's already smaller. Used for the default
    on-screen view so the browser isn't decoding/transferring full sensor
    resolution before the reviewer has zoomed in to actually need it."""
    import io
    from PIL import Image

    image = Image.open(io.BytesIO(png_bytes))
    image.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def _decode_dicom_to_png(content: bytes) -> tuple:
    """Decodes DICOM pixel data and re-encodes it as PNG, entirely in memory —
    nothing is written back to GCS/storage, this only shapes the response for
    this one request. Applies the same VOI windowing (window center/width, or
    a VOI LUT sequence if present) and MONOCHROME1 inversion the viewer used
    to do by hand in the browser, but via pydicom's own implementation so LUT
    sequences (which the old client-side code never handled) also work.
    Raises on any failure — the caller falls back to serving the original
    (possibly still-compressed) DICOM bytes untouched.

    Returns (png_bytes, meta) — meta carries the original DICOM's own
    dimensions/bit depth/compression so the viewer's info panel can still
    show them even though the response itself is now a plain PNG."""
    import io
    import numpy as np
    import pydicom
    from pydicom.pixels import apply_voi_lut
    from PIL import Image

    ds = pydicom.dcmread(io.BytesIO(content))
    is_compressed = ds.file_meta.TransferSyntaxUID.is_compressed
    if is_compressed:
        ds.decompress()

    array = ds.pixel_array
    meta = {
        "rows": int(getattr(ds, "Rows", 0) or 0),
        "cols": int(getattr(ds, "Columns", 0) or 0),
        "bits_allocated": int(getattr(ds, "BitsAllocated", 0) or 0),
        "compressed": is_compressed,
    }

    if array.ndim == 3 and array.shape[-1] in (3, 4):
        image = Image.fromarray(array.astype(np.uint8)).convert("RGB")
    else:
        if array.ndim > 2:
            # Defensive fallback for an unexpected multi-frame file — the
            # viewer (old and new) only ever displays a single frame.
            array = array[0]
        windowed = apply_voi_lut(array, ds).astype(np.float64)
        lo, hi = windowed.min(), windowed.max()
        scaled = ((windowed - lo) / (hi - lo) * 255.0) if hi > lo else np.zeros_like(windowed)
        if getattr(ds, "PhotometricInterpretation", "MONOCHROME2") == "MONOCHROME1":
            scaled = 255.0 - scaled
        image = Image.fromarray(scaled.astype(np.uint8), mode="L")

    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue(), meta


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

    # A converted PNG is a deterministic function of the original file, and
    # attachments are immutable once uploaded, so a cache hit here skips
    # touching the original file (and re-running pydicom) entirely — this is
    # what makes every view *after* the first one, by *any* user, fast.
    served_from_cache = False
    dicom_meta = None
    cached = _load_cached_conversion(client, attachment_id, resolution)
    if cached:
        content, dicom_meta = cached
        mime = "image/png"
        served_from_cache = True
    else:
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
            # magic bytes rather than trusting qc_mime_type, same as the viewer
            # used to do client-side before this conversion moved server-side.
            if content[:2] == b"\xff\xd8":
                mime = "image/jpeg"
            elif content[:8] == b"\x89PNG\r\n\x1a\n":
                mime = "image/png"
            elif len(content) >= 132 and content[128:132] == b'DICM':
                mime = "application/dicom"
                try:
                    full_png, dicom_meta = _decode_dicom_to_png(content)
                    mime = "image/png"
                    screen_png = _resize_png_bytes(full_png, SCREEN_MAX_DIM)
                    # The decode is already done — cache both resolutions now
                    # so a future request for *either* is a cache hit, not
                    # just the one actually requested this time.
                    background_tasks.add_task(_store_cached_conversion, attachment_id, "full", full_png, dicom_meta)
                    background_tasks.add_task(_store_cached_conversion, attachment_id, "screen", screen_png, dicom_meta)
                    content = full_png if resolution == "full" else screen_png
                except Exception:
                    # Conversion failed (e.g. an unsupported transfer syntax) —
                    # fall back to serving the original DICOM bytes, decompressed
                    # to raw where possible, exactly as before this feature.
                    logger.warning("DICOM->PNG conversion failed for attachment %s, falling back to raw DICOM", attachment_id, exc_info=True)
                    try:
                        import pydicom
                        import io

                        ds = pydicom.dcmread(io.BytesIO(content))
                        if ds.file_meta.TransferSyntaxUID.is_compressed:
                            ds.decompress()
                            ds.file_meta.TransferSyntaxUID = "1.2.840.10008.1.2"
                            out_buf = io.BytesIO()
                            ds.save_as(out_buf)
                            content = out_buf.getvalue()
                    except Exception:
                        pass
        except Exception as e:
            # Log the full traceback server-side (an unhandled crash here can
            # otherwise surface to the browser as a bare connection failure,
            # which Chrome mislabels as a CORS error since no response — CORS
            # headers included — ever gets sent) and return a clean, properly
            # CORS-headered error response instead.
            logger.error("Failed to load attachment %s from storage: %s", attachment_id, e, exc_info=True)
            raise HTTPException(status_code=500, detail=f"Could not load attachment: {e}")

    headers = {
        # Attachments are immutable once uploaded (no re-upload/replace path
        # exists for an existing attachment id), so the browser can cache
        # this response indefinitely and skip re-downloading on every
        # revisit of the same image within a session.
        "Content-Disposition": f'inline; filename="{attachment.qc_file_name}"',
        "Cache-Control": "private, max-age=31536000, immutable",
    }
    if not served_from_cache:
        try:
            etag = getattr(blob, "etag", None)
            if etag:
                headers["ETag"] = etag if etag.startswith('"') else f'"{etag}"'
        except Exception:
            logger.warning("Could not read ETag for attachment %s", attachment_id, exc_info=True)

    # The response body is now a plain PNG once converted, so the original
    # DICOM's own dimensions/bit depth/compression (still meaningful to a
    # reviewer) travel as headers instead — see main.py's CORS
    # expose_headers, which is what makes these readable from the frontend.
    if dicom_meta:
        headers["X-Dicom-Rows"] = str(dicom_meta["rows"])
        headers["X-Dicom-Cols"] = str(dicom_meta["cols"])
        headers["X-Dicom-Bits-Allocated"] = str(dicom_meta["bits_allocated"])
        headers["X-Dicom-Compressed"] = "true" if dicom_meta["compressed"] else "false"

    return Response(
        content=content,
        media_type=mime,
        headers=headers,
    )
 