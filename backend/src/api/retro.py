import datetime
import logging
import re
import threading
from pathlib import Path
from typing import List, Optional

from fastapi import Response
from fastapi.responses import FileResponse
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..db import session as db_session
from ..db.session import get_db
from ..models.models import User
from ..models.retro import (ASSIGN_REJECTED, RetroAssignment, RetroBatch, RetroCase, RetroDeletedCase, RetroFile,
                            RetroRejection, RetroMask, RetroMark, RetroNote)
from ..services.retro_workflow import progress_for_cases, STATUS_LABELS
from ..services import retro_intake as intake
from .admin import check_admin_role
from .retro_access import any_role, authorize_case

router = APIRouter()
logger = logging.getLogger(__name__)


def _safe_relative(path: str) -> Path:
    parts = [p for p in re.split(r"[\\/]+", path) if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        raise HTTPException(status_code=400, detail=f"Invalid path: {path}")
    return Path(*parts)


def _batch_or_404(db: Session, batch_id: int) -> RetroBatch:
    batch = db.query(RetroBatch).filter(RetroBatch.qc_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return batch


PROCESSING_STALE_SECONDS = 300      # a batch being checked that shows no activity this long was cut off
UPLOADING_STALE_SECONDS = 1800      # an upload nobody has sent a file to for this long was abandoned
INTERRUPTED = ("Processing was interrupted, for example because the server restarted. Cases already stored are kept. "
               "Upload the folder again to check the rest; cases that were already stored are rejected as duplicates.")


def _expire_if_stale(db: Session, b: Optional[RetroBatch]):
    """Turn a batch whose worker disappeared into 'failed' so the page stops waiting for it."""
    if not b or b.qc_status not in ("uploading", "processing"):
        return b
    age = intake.heartbeat_age(b.qc_id)
    if age is None and b.qc_created_at:
        age = (datetime.datetime.utcnow() - b.qc_created_at).total_seconds() if b.qc_status == "uploading" else 1e9
    limit = PROCESSING_STALE_SECONDS if b.qc_status == "processing" else UPLOADING_STALE_SECONDS
    if age is not None and age > limit:
        b.qc_status, b.qc_phase, b.qc_error = "failed", "Interrupted", INTERRUPTED if b.qc_status == "processing" else "The upload stopped before it was finished. Upload the folder again."
        b.qc_finished_at = datetime.datetime.utcnow()
        db.commit()
    return b


def _batch_dict(b: RetroBatch) -> dict:
    return {
        "id": b.qc_id, "source_name": b.qc_source_name, "vendor": b.qc_vendor,
        "status": b.qc_status, "phase": b.qc_phase,
        "files_received": b.qc_files_received, "bytes_received": b.qc_bytes_received,
        "total_cases": b.qc_total_cases, "checked_cases": b.qc_checked_cases,
        "passed": b.qc_passed, "rejected": b.qc_rejected, "deleted": b.qc_deleted,
        "error": b.qc_error,
        "created_at": b.qc_created_at.isoformat() if b.qc_created_at else None,
        "finished_at": b.qc_finished_at.isoformat() if b.qc_finished_at else None,
    }


@router.post("/batches")
def create_batch(
    source_name: str = Form(""),
    vendor: str = Form(""),
    db: Session = Depends(get_db),
    current_user: dict = Depends(check_admin_role),
):
    batch = RetroBatch(qc_uploaded_by=current_user.get("id"), qc_source_name=source_name[:255] or None,
                       qc_vendor=vendor[:160] or None)
    db.add(batch)
    db.commit()
    return _batch_dict(batch)


@router.post("/batches/{batch_id}/files")
async def upload_files(
    batch_id: int,
    files: List[UploadFile] = File(...),
    paths: List[str] = Form(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(check_admin_role),
):
    """Receive one chunk of a folder upload (or a single .zip). Call repeatedly."""
    batch = _batch_or_404(db, batch_id)
    if batch.qc_status != "uploading":
        raise HTTPException(status_code=409, detail="Batch is no longer accepting files")
    intake.touch_heartbeat(batch_id)
    if len(files) != len(paths):
        raise HTTPException(status_code=400, detail="files and paths must have the same length")

    raw = intake.staging_root() / str(batch_id) / "raw"
    received = 0
    for upload, rel in zip(files, paths):
        target = raw / _safe_relative(rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "wb") as out:
            while chunk := await upload.read(1 << 20):
                out.write(chunk)
                received += len(chunk)
    batch.qc_files_received += len(files)
    batch.qc_bytes_received += received
    db.commit()
    return _batch_dict(batch)


@router.post("/batches/{batch_id}/parts")
async def upload_part(
    batch_id: int,
    path: str = Form(...),
    offset: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(check_admin_role),
):
    """Append one piece of a large file (a big zip) in order. offset must equal the bytes received so far."""
    batch = _batch_or_404(db, batch_id)
    if batch.qc_status != "uploading":
        raise HTTPException(status_code=409, detail="Batch is no longer accepting files")
    intake.touch_heartbeat(batch_id)
    target = intake.staging_root() / str(batch_id) / "raw" / _safe_relative(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    have = target.stat().st_size if target.exists() else 0
    if offset != have:
        raise HTTPException(status_code=409, detail=f"Expected the part starting at byte {have}, got {offset}")
    received = 0
    with open(target, "ab") as out:
        while chunk := await file.read(1 << 20):
            out.write(chunk)
            received += len(chunk)
    if offset == 0:
        batch.qc_files_received += 1
    batch.qc_bytes_received += received
    db.commit()
    return {"path": path, "size": have + received}


@router.post("/batches/{batch_id}/finalize")
def finalize_batch(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(check_admin_role),
):
    batch = _batch_or_404(db, batch_id)
    if batch.qc_status != "uploading":
        raise HTTPException(status_code=409, detail="Batch already finalized")
    if not batch.qc_files_received:
        raise HTTPException(status_code=400, detail="No files were uploaded")
    batch.qc_status, batch.qc_phase = "processing", "Queued"
    db.commit()
    intake.touch_heartbeat(batch_id)
    threading.Thread(target=intake.process_batch, args=(batch_id, lambda: db_session.SessionLocal()),
                     daemon=True).start()
    return _batch_dict(batch)


@router.get("/batches/{batch_id}")
def get_batch(batch_id: int, db: Session = Depends(get_db), current_user: dict = Depends(check_admin_role)):
    return _batch_dict(_expire_if_stale(db, _batch_or_404(db, batch_id)))


@router.get("/batches/{batch_id}/rejections")
def batch_rejections(batch_id: int, db: Session = Depends(get_db), current_user: dict = Depends(check_admin_role)):
    rows = db.query(RetroRejection).filter(RetroRejection.qc_batch_id == batch_id).order_by(RetroRejection.qc_id).all()
    return [{"case": r.qc_original_name, "outcome": r.qc_outcome, "reasons": r.qc_reasons} for r in rows]


@router.get("/tally")
def tally(db: Session = Depends(get_db), current_user: dict = Depends(check_admin_role)):
    """Live totals across every batch, plus the most recent batch."""
    totals = db.query(
        func.coalesce(func.sum(RetroBatch.qc_total_cases), 0),
        func.coalesce(func.sum(RetroBatch.qc_checked_cases), 0),
        func.coalesce(func.sum(RetroBatch.qc_passed), 0),
        func.coalesce(func.sum(RetroBatch.qc_rejected), 0),
        func.coalesce(func.sum(RetroBatch.qc_deleted), 0),
    ).one()
    latest = _expire_if_stale(db, db.query(RetroBatch).order_by(RetroBatch.qc_id.desc()).first())
    by_birads = dict(db.query(RetroCase.qc_birads, func.count()).group_by(RetroCase.qc_birads).all())
    by_density = dict(db.query(RetroCase.qc_density, func.count()).group_by(RetroCase.qc_density).all())
    by_vendor = dict(db.query(RetroCase.qc_vendor, func.count()).group_by(RetroCase.qc_vendor).all())
    assigned = dict(db.query(RetroAssignment.qc_status, func.count()).group_by(RetroAssignment.qc_status).all())
    n_cases = db.query(func.count(RetroCase.qc_id)).scalar() or 0
    by_status = {k: 0 for k in STATUS_LABELS}
    by_status.update(assigned)
    by_status["unassigned"] = n_cases - sum(assigned.values())
    free = db.query(func.min(RetroCase.qc_id), func.max(RetroCase.qc_id)).outerjoin(
        RetroAssignment, RetroAssignment.qc_case_id == RetroCase.qc_id).filter(RetroAssignment.qc_id.is_(None)).one()
    return {
        "unassigned_range": [free[0], free[1]] if free[0] else None,
        "by_status": by_status,
        "by_birads": {k or "–": v for k, v in by_birads.items()},
        "by_density": {k or "–": v for k, v in by_density.items()},
        "by_vendor": {k or "–": v for k, v in by_vendor.items()},
        "total_cases": int(totals[0]), "checked": int(totals[1]), "passed": int(totals[2]),
        "rejected": int(totals[3]), "deleted": int(totals[4]),
        # Radiologist rejections: still-stored ones plus those an admin has since deleted, so the count never drops.
        "rejected_by_radiologist": by_status.get(ASSIGN_REJECTED, 0) + (db.query(func.count(RetroDeletedCase.qc_id)).filter(
            RetroDeletedCase.qc_final_status == ASSIGN_REJECTED).scalar() or 0),
        "deleted_by_admin": db.query(func.count(RetroDeletedCase.qc_id)).scalar() or 0,
        "latest_batch": _batch_dict(latest) if latest else None,
    }


def filtered_cases(db: Session, q: str = "", birads: Optional[str] = None, density: Optional[str] = None,
                   status: Optional[str] = None, mammo_tech_id: Optional[int] = None,
                   vendor: Optional[str] = None, manufacturer: Optional[str] = None):
    """The one place case filters are defined, so the list and 'assign everything that matches' always agree."""
    query = db.query(RetroCase).outerjoin(RetroAssignment, RetroAssignment.qc_case_id == RetroCase.qc_id)
    if status == "unassigned":
        query = query.filter(RetroAssignment.qc_id.is_(None))
    elif status:
        query = query.filter(RetroAssignment.qc_status == status)
    if mammo_tech_id:
        query = query.filter(RetroAssignment.qc_mammo_tech_id == mammo_tech_id)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(RetroCase.qc_case_code.like(like), RetroCase.qc_original_name.like(like),
                                 RetroCase.qc_manufacturer.like(like), RetroCase.qc_vendor.like(like)))
    if birads:
        query = query.filter(RetroCase.qc_birads.like(f"{birads}%"))
    if density:
        query = query.filter(RetroCase.qc_density == density.upper())
    if vendor:
        query = query.filter(RetroCase.qc_vendor == vendor)
    if manufacturer:
        query = query.filter(RetroCase.qc_manufacturer == manufacturer)
    return query


def assignable(query):
    """Cases an admin may still hand to a Mammo Tech: nobody has it, or the Mammo Tech has not opened it yet."""
    return query.filter(or_(RetroAssignment.qc_id.is_(None), RetroAssignment.qc_status == "awaiting"))


@router.get("/cases")
def list_cases(
    q: str = "",
    birads: Optional[str] = None,
    density: Optional[str] = None,
    status: Optional[str] = None,
    mammo_tech_id: Optional[int] = None,
    vendor: Optional[str] = None,
    manufacturer: Optional[str] = None,
    order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: dict = Depends(check_admin_role),
):
    query = filtered_cases(db, q, birads, density, status, mammo_tech_id, vendor, manufacturer)
    total = query.count()
    assignable_total = assignable(query).count()
    sort = RetroCase.qc_id.asc() if order == "asc" else RetroCase.qc_id.desc()
    rows = query.order_by(sort).offset((page - 1) * page_size).limit(page_size).all()
    progress = progress_for_cases(db, [c.qc_id for c in rows])
    return {
        "total": total, "assignable_total": assignable_total, "page": page, "page_size": page_size,
        "items": [{
            **progress[c.qc_id],
            "id": c.qc_id, "case_code": c.qc_case_code, "session_id": c.qc_session_id,
            "original_name": c.qc_original_name, "modality": c.qc_modality, "birads": c.qc_birads,
            "density": c.qc_density, "manufacturer": c.qc_manufacturer, "vendor": c.qc_vendor,
            "created_at": c.qc_created_at.isoformat() if c.qc_created_at else None,
        } for c in rows],
    }


@router.get("/case-facets")
def case_facets(db: Session = Depends(get_db), current_user: dict = Depends(check_admin_role)):
    """Distinct vendors and manufacturers, for the filter dropdowns."""
    def distinct(col):
        return sorted(v for (v,) in db.query(col).filter(col.isnot(None), col != "").distinct().all())
    return {"vendors": distinct(RetroCase.qc_vendor), "manufacturers": distinct(RetroCase.qc_manufacturer)}


@router.delete("/cases/{case_id}")
def delete_case(case_id: int, db: Session = Depends(get_db), current_user: dict = Depends(check_admin_role)):
    """Remove a case the Radiologist rejected: its files leave GCS and the database, a small record stays for the counts."""
    case = db.query(RetroCase).filter(RetroCase.qc_id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    a = db.query(RetroAssignment).filter(RetroAssignment.qc_case_id == case_id).first()
    if not a or a.qc_status != ASSIGN_REJECTED:
        raise HTTPException(status_code=409, detail="Only cases rejected by the Radiologist can be deleted")
    masks = db.query(RetroMask).filter(RetroMask.qc_case_id == case_id).all()
    urls = [f.qc_gcs_path for f in case.files] + [m.qc_gcs_path for m in masks]
    try:
        intake.delete_blobs(urls)
    except Exception:
        logger.exception("GCS delete failed for case %s", case_id)
        raise HTTPException(status_code=500, detail="Could not remove the files from storage. Nothing was deleted; try again.")
    db.add(RetroDeletedCase(
        qc_case_id=case.qc_id, qc_case_code=case.qc_case_code, qc_session_id=case.qc_session_id,
        qc_content_hash=case.qc_content_hash, qc_original_name=case.qc_original_name, qc_modality=case.qc_modality,
        qc_birads=case.qc_birads, qc_density=case.qc_density, qc_manufacturer=case.qc_manufacturer, qc_vendor=case.qc_vendor,
        qc_batch_id=case.qc_batch_id, qc_mammo_tech_id=a.qc_mammo_tech_id, qc_final_status=a.qc_status,
        qc_reason=a.qc_reject_reason, qc_rejected_by=a.qc_rejected_by, qc_rejected_at=a.qc_rejected_at,
        qc_uploaded_at=case.qc_created_at, qc_deleted_by=current_user["id"]))
    db.query(RetroNote).filter(RetroNote.qc_case_id == case_id).delete()
    db.query(RetroMask).filter(RetroMask.qc_case_id == case_id).delete()
    db.query(RetroAssignment).filter(RetroAssignment.qc_case_id == case_id).delete()
    db.query(RetroFile).filter(RetroFile.qc_case_id == case_id).delete()
    db.delete(case)
    db.commit()
    return {"deleted": case_id, "case_code": case.qc_case_code}


@router.get("/cases/{case_id}")
def case_detail(case_id: int, db: Session = Depends(get_db), current_user: dict = Depends(any_role)):
    role, _ = authorize_case(db, current_user, case_id)
    case = db.query(RetroCase).filter(RetroCase.qc_id == case_id).first()
    masks = db.query(RetroMask).filter(RetroMask.qc_case_id == case_id).order_by(RetroMask.qc_version.desc()).all()
    notes = db.query(RetroNote).filter(RetroNote.qc_case_id == case_id).order_by(RetroNote.qc_id).all()
    # Free-hand marks are a conversation between the Mammo Tech and the Radiologist; the admin does not get them.
    marks = [] if role == "admin" else db.query(RetroMark).filter(
        RetroMark.qc_case_id == case_id, RetroMark.qc_removed_at.is_(None)).order_by(RetroMark.qc_id).all()
    is_admin = role == "admin"
    if not is_admin:           # Mammo Tech and Radiologist never see history: only their own masks, live marks and the latest instruction from the other role
        other_notes = [n for n in notes if n.qc_author_role != role and n.qc_kind in ("escalation", "guidance")]
        masks = [m for m in masks if m.qc_role == role]
        latest = other_notes[-1] if other_notes else None
        notes = []
    else:
        latest = None
    people = [m.qc_uploaded_by for m in masks] + [n.qc_author_id for n in notes] + ([latest.qc_author_id] if latest else [])
    names = {u.qc_id: (u.qc_full_name or u.qc_email) for u in db.query(User).filter(User.qc_id.in_(people or [0])).all()}
    return {
        "viewer_role": role,
        **progress_for_cases(db, [case_id])[case_id],
        "masks": [{"id": m.qc_id, "version": m.qc_version, "view": m.qc_view, "role": m.qc_role, "filename": m.qc_filename,
                   "size_bytes": m.qc_size_bytes, "by": names.get(m.qc_uploaded_by),
                   "at": m.qc_uploaded_at.isoformat() if m.qc_uploaded_at else None} for m in masks],
        "marks": [{"id": m.qc_id, "view": m.qc_view, "role": m.qc_author_role, "by": m.qc_author_name, "shapes": m.qc_shapes,
                   "at": m.qc_created_at.isoformat() if m.qc_created_at else None,
                   "removed_at": m.qc_removed_at.isoformat() if m.qc_removed_at else None} for m in marks],
        "instruction": {"by": names.get(latest.qc_author_id), "role": latest.qc_author_role, "body": latest.qc_body,
                        "at": latest.qc_created_at.isoformat() if latest.qc_created_at else None} if latest else None,
        "notes": [{"id": n.qc_id, "role": n.qc_author_role, "kind": n.qc_kind, "by": names.get(n.qc_author_id),
                   "body": n.qc_body, "at": n.qc_created_at.isoformat() if n.qc_created_at else None} for n in notes],
        "id": case.qc_id, "case_code": case.qc_case_code, "session_id": case.qc_session_id,
        "original_name": case.qc_original_name, "modality": case.qc_modality, "birads": case.qc_birads,
        "density": case.qc_density, "manufacturer": case.qc_manufacturer, "vendor": case.qc_vendor,
        "files": [{
            "id": f.qc_id, "kind": f.qc_kind, "view": f.qc_view, "filename": f.qc_filename,
            "source_path": f.qc_source_path, "size_bytes": f.qc_size_bytes, "dicom_headers": f.qc_dicom_headers,
        } for f in sorted(case.files, key=lambda f: (f.qc_kind != "view", f.qc_view or ""))],
    }


def _file_or_404(db: Session, file_id: int) -> RetroFile:
    f = db.query(RetroFile).filter(RetroFile.qc_id == file_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    return f


@router.get("/files/{file_id}/image")
def file_image(
    file_id: int,
    center: Optional[float] = None,
    width: Optional[float] = None,
    invert: bool = False,
    thumb: bool = False,
    db: Session = Depends(get_db),
    current_user: dict = Depends(any_role),
):
    """Mammogram rendered as PNG for the viewer. thumb=true gives a small preview.

    The first request for a view downloads and decodes the DICOM once; every later picture (other windows, thumbnails)
    is made from the cached pixels, and finished PNGs are cached on disk too.
    """
    f = _file_or_404(db, file_id)
    authorize_case(db, current_user, f.qc_case_id)
    if f.qc_kind != "view":
        raise HTTPException(status_code=400, detail="Not an image")
    side = 320 if thumb else 1800
    key = f"{'x' if center is None else round(center)}-{'x' if width is None else round(width)}-{int(invert)}-{side}"
    cached = intake.png_cache_path(f.qc_id, f.qc_sha256, key)
    headers = {"Cache-Control": "private, max-age=3600"}
    if cached.exists():
        return FileResponse(cached, media_type="image/png", headers=headers)

    def header(name):
        return next((str(h.get("value", "")) for h in (f.qc_dicom_headers or []) if h.get("name") == name), "")
    try:
        cols, rows = int(header("Columns") or 0), int(header("Rows") or 0)
        plain = (header("RescaleSlope") or "1") in ("1", "1.0") and (header("RescaleIntercept") or "0") in ("0", "0.0")
        pix = intake.pixel_cache_path(f.qc_id, f.qc_sha256)
        if not pix.exists():
            intake.write_pixel_cache(pix, intake.read_from_gcs(f.qc_gcs_path))
        if cols and rows and plain:
            png = intake.render_png_from_pixels(pix, cols, rows, center, width, invert, "MONOCHROME1" in header("PhotometricInterpretation").upper(), side)
        else:
            png = intake.render_dicom_png(intake.read_from_gcs(f.qc_gcs_path), center, width, invert, side)
        cached.parent.mkdir(parents=True, exist_ok=True)
        tmp = cached.with_suffix(".tmp")
        tmp.write_bytes(png)
        tmp.replace(cached)
        intake._trim_cache(cached.parent, "*.png", 600)
    except Exception:
        logger.exception("Render failed for retro file %s", file_id)
        raise HTTPException(status_code=500, detail="Could not render image")
    return Response(content=png, media_type="image/png", headers=headers)


@router.get("/files/{file_id}/pixels")
def file_pixels(file_id: int, db: Session = Depends(get_db), current_user: dict = Depends(any_role)):
    """Raw 16-bit pixels of one view (little-endian, row-major, width x height from the DICOM header), gzip-encoded.

    The annotation tools window, zoom and magnify these in the browser, so presets and the loupe need no round trips.
    """
    f = _file_or_404(db, file_id)
    authorize_case(db, current_user, f.qc_case_id)
    if f.qc_kind != "view":
        raise HTTPException(status_code=400, detail="Not an image")
    try:
        path = intake.pixel_cache_path(f.qc_id, f.qc_sha256)
        if not path.exists():
            intake.write_pixel_cache(path, intake.read_from_gcs(f.qc_gcs_path))
    except Exception:
        logger.exception("Pixel read failed for retro file %s", file_id)
        raise HTTPException(status_code=500, detail="Could not read the image")
    return FileResponse(path, media_type="application/octet-stream",
                        headers={"Content-Encoding": "gzip", "Cache-Control": "private, max-age=3600"})


@router.get("/files/{file_id}/content")
def file_content(file_id: int, db: Session = Depends(get_db), current_user: dict = Depends(any_role)):
    """Raw report bytes (PDF or JSON)."""
    f = _file_or_404(db, file_id)
    authorize_case(db, current_user, f.qc_case_id)
    if f.qc_kind != "report":
        raise HTTPException(status_code=400, detail="Not a report")
    try:
        data = intake.read_from_gcs(f.qc_gcs_path)
    except Exception:
        logger.exception("Report read failed for retro file %s", file_id)
        raise HTTPException(status_code=500, detail="Could not read report")
    media = "application/pdf" if f.qc_filename.lower().endswith(".pdf") else "application/json"
    return Response(content=data, media_type=media, headers={"Content-Disposition": f'inline; filename="{f.qc_filename}"'})


@router.get("/files/{file_id}/url")
def file_view_url(file_id: int, db: Session = Depends(get_db), current_user: dict = Depends(check_admin_role)):
    f = db.query(RetroFile).filter(RetroFile.qc_id == file_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    from .patient import _get_storage_client, _resolve_gcs_blob
    from google.auth import default as auth_default
    try:
        blob = _resolve_gcs_blob(f.qc_gcs_path, _get_storage_client())
        credentials, _ = auth_default()
        url = blob.generate_signed_url(version="v4", expiration=datetime.timedelta(hours=1),
                                       method="GET", credentials=credentials)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Signed URL failed for retro file %s", file_id)
        raise HTTPException(status_code=500, detail="Could not generate signed URL")
    return {"view_url": url, "file_name": f.qc_filename}
