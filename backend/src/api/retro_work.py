"""Mammo Tech and Radiologist work on retrospective cases: notes, masks, escalation, hand-back."""
import datetime
import re
import io
import logging
import os
import tempfile
import zipfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db.session import get_db
from ..models.models import Role, User
from ..models.retro import (RetroMark, ASSIGN_REJECTED, ASSIGN_AWAITING, ASSIGN_IN_PROGRESS, ASSIGN_RADIOLOGIST_IN_PROGRESS, ASSIGN_SEGMENTED,
                            ASSIGN_WITH_RADIOLOGIST, RetroAssignment, RetroCase, RetroMask, RetroNote)
from ..services import retro_intake as intake
from ..services import retro_mail
from ..services.retro_workflow import (ROLE_ADMIN, ROLE_MAMMO, ROLE_RADIOLOGIST, progress_for_cases, read_nifti_header,
                                       user_name, view_dimensions)
from .retro_access import admin_only, any_role, authorize_case, role_of
from .auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)
MAX_MASK_BYTES = 200 * 1024 * 1024
MAX_NOTE_CHARS = 5000
RADIOLOGIST_OPEN = (ASSIGN_WITH_RADIOLOGIST, ASSIGN_RADIOLOGIST_IN_PROGRESS)


class NoteRequest(BaseModel):
    body: str


class EscalateRequest(BaseModel):
    note: str


class CompleteRequest(BaseModel):
    note: Optional[str] = None


def _require_role(user: dict, role: str):
    if role_of(user) != role:
        raise HTTPException(status_code=403, detail=f"{role.replace('_', ' ').title()} access required")


def _clean(text: Optional[str], required: bool, what: str) -> str:
    text = (text or "").strip()
    if required and not text:
        raise HTTPException(status_code=400, detail=f"{what} is required")
    if len(text) > MAX_NOTE_CHARS:
        raise HTTPException(status_code=400, detail=f"{what} is longer than {MAX_NOTE_CHARS} characters")
    return text


def _case(db: Session, case_id: int) -> RetroCase:
    return db.query(RetroCase).filter(RetroCase.qc_id == case_id).first()


def pick_radiologist(db: Session, prefer_id: Optional[int] = None) -> Optional[User]:
    """Active Radiologist with the fewest open retrospective reviews. A previous reviewer is kept if still active."""
    role = db.query(Role).filter(func.lower(Role.qc_name) == "radiologist").first()
    if not role:
        return None
    people = db.query(User).filter(User.qc_role_id == role.qc_id, User.qc_is_active == True).all()  # noqa: E712
    if not people:
        return None
    if prefer_id and any(p.qc_id == prefer_id for p in people):
        return next(p for p in people if p.qc_id == prefer_id)
    load = dict(db.query(RetroAssignment.qc_radiologist_id, func.count())
                .filter(RetroAssignment.qc_status.in_(RADIOLOGIST_OPEN)).group_by(RetroAssignment.qc_radiologist_id).all())
    return min(people, key=lambda p: (load.get(p.qc_id, 0), p.qc_id))


# ---- lists -----------------------------------------------------------------
def _case_rows(db: Session, pairs):
    progress = progress_for_cases(db, [c.qc_id for _, c in pairs])
    return [{"id": c.qc_id, "case_code": c.qc_case_code, "birads": c.qc_birads, "density": c.qc_density,
             "vendor": c.qc_vendor, "manufacturer": c.qc_manufacturer, **progress[c.qc_id]} for _, c in pairs]


@router.get("/my-cases")
def my_cases(status: Optional[str] = None, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    _require_role(current_user, ROLE_MAMMO)
    q = db.query(RetroAssignment, RetroCase).join(RetroCase, RetroCase.qc_id == RetroAssignment.qc_case_id) \
        .filter(RetroAssignment.qc_mammo_tech_id == current_user["id"],
                RetroAssignment.qc_status.notin_([ASSIGN_SEGMENTED, ASSIGN_REJECTED]))   # finished cases leave the list
    if status:
        q = q.filter(RetroAssignment.qc_status == status)
    return _case_rows(db, q.order_by(RetroCase.qc_id).all())


@router.get("/radiologist-cases")
def radiologist_cases(status: Optional[str] = None, db: Session = Depends(get_db),
                      current_user: dict = Depends(get_current_user)):
    _require_role(current_user, ROLE_RADIOLOGIST)
    q = db.query(RetroAssignment, RetroCase).join(RetroCase, RetroCase.qc_id == RetroAssignment.qc_case_id) \
        .filter(RetroAssignment.qc_radiologist_id == current_user["id"],
                RetroAssignment.qc_status != ASSIGN_REJECTED)
    if status:
        q = q.filter(RetroAssignment.qc_status == status)
    return _case_rows(db, q.order_by(RetroAssignment.qc_escalated_at, RetroCase.qc_id).all())


# ---- Mammo Tech ------------------------------------------------------------
@router.post("/cases/{case_id}/start")
def start_case(case_id: int, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    _require_role(current_user, ROLE_MAMMO)
    _, a = authorize_case(db, current_user, case_id)
    if a.qc_status == ASSIGN_AWAITING:
        a.qc_status, a.qc_started_at = ASSIGN_IN_PROGRESS, datetime.datetime.utcnow()
        db.commit()
    return progress_for_cases(db, [case_id])[case_id]


@router.post("/cases/{case_id}/escalate")
def escalate_case(case_id: int, payload: EscalateRequest, db: Session = Depends(get_db),
                  current_user: dict = Depends(get_current_user)):
    """Mammo Tech is unsure whether there is a lesion; hand the case to a Radiologist."""
    _require_role(current_user, ROLE_MAMMO)
    _, a = authorize_case(db, current_user, case_id, write=True)
    note = _clean(payload.note, True, "A note describing the doubt")
    rad = pick_radiologist(db, a.qc_radiologist_id)
    if not rad:
        raise HTTPException(status_code=409, detail="No active Radiologist is available. Ask an admin.")
    now = datetime.datetime.utcnow()
    a.qc_status, a.qc_escalated_at, a.qc_escalation_note = ASSIGN_WITH_RADIOLOGIST, now, note
    a.qc_radiologist_id, a.qc_radiologist_assigned_at = rad.qc_id, now
    a.qc_radiologist_started_at = a.qc_radiologist_completed_at = None
    a.qc_started_at = a.qc_started_at or now
    db.add(RetroNote(qc_case_id=case_id, qc_author_id=current_user["id"], qc_author_role=ROLE_MAMMO,
                     qc_kind="escalation", qc_body=note))
    db.commit()
    tech = db.query(User).filter(User.qc_id == current_user["id"]).first()
    retro_mail.notify_escalated(db, rad, _case(db, case_id).qc_case_code, user_name(tech), note)
    return progress_for_cases(db, [case_id])[case_id]


@router.post("/cases/{case_id}/complete")
def complete_case(case_id: int, payload: CompleteRequest = CompleteRequest(), db: Session = Depends(get_db),
                  current_user: dict = Depends(get_current_user)):
    """Mammo Tech confirms the segmentation is finished."""
    _require_role(current_user, ROLE_MAMMO)
    _, a = authorize_case(db, current_user, case_id, write=True)
    has_mask = db.query(RetroMask.qc_id).filter(RetroMask.qc_case_id == case_id, RetroMask.qc_role == ROLE_MAMMO).first()
    if not has_mask:
        raise HTTPException(status_code=400, detail="Save at least one segmentation mask before finishing")
    note = _clean(payload.note, False, "Note")
    if note:
        db.add(RetroNote(qc_case_id=case_id, qc_author_id=current_user["id"], qc_author_role=ROLE_MAMMO,
                         qc_kind="clinical", qc_body=note))
    now = datetime.datetime.utcnow()
    a.qc_status, a.qc_completed_at, a.qc_started_at = ASSIGN_SEGMENTED, now, a.qc_started_at or now
    db.commit()
    return progress_for_cases(db, [case_id])[case_id]


# ---- Radiologist -----------------------------------------------------------
@router.post("/cases/{case_id}/radiologist/start")
def radiologist_start(case_id: int, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    _require_role(current_user, ROLE_RADIOLOGIST)
    _, a = authorize_case(db, current_user, case_id)
    if a.qc_status == ASSIGN_WITH_RADIOLOGIST:
        a.qc_status, a.qc_radiologist_started_at = ASSIGN_RADIOLOGIST_IN_PROGRESS, datetime.datetime.utcnow()
        db.commit()
    return progress_for_cases(db, [case_id])[case_id]


@router.post("/cases/{case_id}/radiologist/complete")
def radiologist_complete(case_id: int, payload: CompleteRequest, db: Session = Depends(get_db),
                         current_user: dict = Depends(get_current_user)):
    """Radiologist is done: the case goes back to the Mammo Tech with the guidance note and mask."""
    _require_role(current_user, ROLE_RADIOLOGIST)
    _, a = authorize_case(db, current_user, case_id, write=True)
    note = _clean(payload.note, True, "A summary note for the Mammo Tech")
    now = datetime.datetime.utcnow()
    a.qc_status, a.qc_radiologist_completed_at = ASSIGN_IN_PROGRESS, now
    a.qc_radiologist_started_at = a.qc_radiologist_started_at or now
    db.add(RetroNote(qc_case_id=case_id, qc_author_id=current_user["id"], qc_author_role=ROLE_RADIOLOGIST,
                     qc_kind="guidance", qc_body=note))
    db.commit()
    tech = db.query(User).filter(User.qc_id == a.qc_mammo_tech_id).first()
    rad = db.query(User).filter(User.qc_id == current_user["id"]).first()
    retro_mail.notify_returned(db, tech, _case(db, case_id).qc_case_code, user_name(rad))
    return progress_for_cases(db, [case_id])[case_id]


@router.post("/cases/{case_id}/radiologist/reject")
def radiologist_reject(case_id: int, payload: CompleteRequest, db: Session = Depends(get_db),
                       current_user: dict = Depends(get_current_user)):
    """Radiologist confirms there is no lesion. The case leaves both work lists and waits with the admin."""
    _require_role(current_user, ROLE_RADIOLOGIST)
    _, a = authorize_case(db, current_user, case_id, write=True)
    reason = _clean(payload.note, True, "A reason for rejecting the case")
    now = datetime.datetime.utcnow()
    a.qc_status, a.qc_rejected_at, a.qc_rejected_by, a.qc_reject_reason = ASSIGN_REJECTED, now, current_user["id"], reason
    a.qc_radiologist_started_at = a.qc_radiologist_started_at or now
    db.add(RetroNote(qc_case_id=case_id, qc_author_id=current_user["id"], qc_author_role=ROLE_RADIOLOGIST,
                     qc_kind="rejection", qc_body=reason))
    db.commit()
    return {"id": case_id, "status": ASSIGN_REJECTED}


# ---- Notes and masks (both roles) -------------------------------------------
@router.post("/cases/{case_id}/notes")
def add_note(case_id: int, payload: NoteRequest, db: Session = Depends(get_db), current_user: dict = Depends(any_role)):
    role, _ = authorize_case(db, current_user, case_id)
    if role == ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Admins have read-only access to cases")
    body = _clean(payload.body, True, "Note")
    db.add(RetroNote(qc_case_id=case_id, qc_author_id=current_user["id"], qc_author_role=role, qc_kind="clinical", qc_body=body))
    db.commit()
    return {"ok": True}


MAX_SHAPES, MAX_POINTS = 300, 6000


def _clean_shapes(shapes):
    """Accept only well-formed pen / circle / arrow shapes; the page is untrusted input."""
    if not isinstance(shapes, list) or len(shapes) > MAX_SHAPES:
        raise HTTPException(status_code=400, detail=f"At most {MAX_SHAPES} marks per view")
    out = []
    num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) < 1e6
    for s in shapes:
        if not isinstance(s, dict) or s.get("type") not in ("pen", "circle", "arrow"):
            raise HTTPException(status_code=400, detail="Unknown mark type")
        color, width = str(s.get("color", ""))[:9], s.get("width", 4)
        if not re.fullmatch(r"#[0-9a-fA-F]{3,8}", color) or not num(width):
            raise HTTPException(status_code=400, detail="Invalid mark colour or width")
        item = {"type": s["type"], "color": color, "width": max(1, min(20, width))}
        if s["type"] == "pen":
            pts = s.get("pts")
            if not isinstance(pts, list) or not 2 <= len(pts) <= MAX_POINTS or not all(
                    isinstance(p, dict) and num(p.get("x")) and num(p.get("y")) for p in pts):
                raise HTTPException(status_code=400, detail="Invalid pen stroke")
            item["pts"] = [{"x": round(p["x"], 1), "y": round(p["y"], 1)} for p in pts]
        else:
            b = s.get("box")
            if not isinstance(b, dict) or not all(num(b.get(k)) for k in ("x0", "y0", "x1", "y1")):
                raise HTTPException(status_code=400, detail="Invalid shape")
            item["box"] = {k: round(b[k], 1) for k in ("x0", "y0", "x1", "y1")}
        out.append(item)
    return out


class MarksRequest(BaseModel):
    view: str
    shapes: list


@router.put("/cases/{case_id}/marks")
def save_marks(case_id: int, payload: MarksRequest, db: Session = Depends(get_db), current_user: dict = Depends(any_role)):
    """Replace this person's live marks on one view. The previous set is kept (stamped removed) for the admin's history."""
    role, _ = authorize_case(db, current_user, case_id, write=True)
    view = payload.view.upper()
    if view not in intake.STANDARD_VIEWS:
        raise HTTPException(status_code=400, detail="view must be one of LCC, LMLO, RCC, RMLO")
    shapes = _clean_shapes(payload.shapes)
    now = datetime.datetime.utcnow()
    db.query(RetroMark).filter(RetroMark.qc_case_id == case_id, RetroMark.qc_view == view, RetroMark.qc_author_role == role,
                               RetroMark.qc_removed_at.is_(None)).update({"qc_removed_at": now, "qc_removed_by": current_user["id"]})
    if shapes:
        me = db.query(User).filter(User.qc_id == current_user["id"]).first()
        db.add(RetroMark(qc_case_id=case_id, qc_view=view, qc_author_id=current_user["id"], qc_author_role=role,
                         qc_author_name=user_name(me), qc_shapes=shapes))
    db.commit()
    return {"ok": True, "count": len(shapes)}


@router.post("/cases/{case_id}/marks/clear-other")
def clear_other_marks(case_id: int, payload: NoteRequest, db: Session = Depends(get_db), current_user: dict = Depends(any_role)):
    """Remove the other role's live marks on a view (payload.body = view), so a fresh set can be drawn."""
    role, _ = authorize_case(db, current_user, case_id, write=True)
    other = ROLE_RADIOLOGIST if role == ROLE_MAMMO else ROLE_MAMMO
    view = (payload.body or "").upper()
    q = db.query(RetroMark).filter(RetroMark.qc_case_id == case_id, RetroMark.qc_author_role == other, RetroMark.qc_removed_at.is_(None))
    if view in intake.STANDARD_VIEWS:
        q = q.filter(RetroMark.qc_view == view)
    n = q.update({"qc_removed_at": datetime.datetime.utcnow(), "qc_removed_by": current_user["id"]})
    db.commit()
    return {"ok": True, "removed": n}


@router.post("/cases/{case_id}/masks")
async def upload_mask(case_id: int, view: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db),
                      current_user: dict = Depends(any_role)):
    """Save a segmentation mask (.nii.gz) for one view. Saving again creates a new version."""
    role, a = authorize_case(db, current_user, case_id, write=True)
    if role == ROLE_RADIOLOGIST:
        raise HTTPException(status_code=403, detail="Radiologists mark the lesion with the free-hand tools; only the Mammo Tech saves a mask")
    view = view.upper()
    if view not in intake.STANDARD_VIEWS:
        raise HTTPException(status_code=400, detail="view must be one of LCC, LMLO, RCC, RMLO")
    if not (file.filename or "").lower().endswith(".nii.gz"):
        raise HTTPException(status_code=400, detail="Mask must be a .nii.gz file")
    data = await file.read(MAX_MASK_BYTES + 1)
    if len(data) > MAX_MASK_BYTES:
        raise HTTPException(status_code=413, detail="Mask is larger than 200 MB")
    problem, (nx, ny, nz) = read_nifti_header(data)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    expected = view_dimensions(db, case_id, view)
    if expected and (nz != 1 or (nx, ny) != expected):
        raise HTTPException(status_code=400, detail=(
            f"Mask is {nx} x {ny}{'' if nz == 1 else f' x {nz}'} but the {view} image is {expected[0]} x {expected[1]} "
            "(columns x rows). The mask must match the image size exactly."))

    case = _case(db, case_id)
    version = (db.query(func.max(RetroMask.qc_version)).filter(RetroMask.qc_case_id == case_id).scalar() or 0) + 1
    filename = f"{case.qc_case_code}_{view}_{role}_v{version}.nii.gz"
    with tempfile.NamedTemporaryFile(suffix=".nii.gz", delete=False) as tmp:
        tmp.write(data)
    try:
        url = intake.upload_to_gcs(Path(tmp.name), f"{intake.RETRO_GCS_PREFIX}{case.qc_case_code}/segmentation/{filename}")
    except Exception:
        logger.exception("Mask upload failed for case %s", case_id)
        raise HTTPException(status_code=500, detail="Could not store the mask")
    finally:
        os.unlink(tmp.name)

    now = datetime.datetime.utcnow()
    db.add(RetroMask(qc_case_id=case_id, qc_version=version, qc_view=view, qc_role=role, qc_filename=filename,
                     qc_gcs_path=url, qc_size_bytes=len(data), qc_uploaded_by=current_user["id"]))
    if role == ROLE_MAMMO and a.qc_status == ASSIGN_AWAITING:
        a.qc_status, a.qc_started_at = ASSIGN_IN_PROGRESS, now
    if role == ROLE_RADIOLOGIST and a.qc_status == ASSIGN_WITH_RADIOLOGIST:
        a.qc_status, a.qc_radiologist_started_at = ASSIGN_RADIOLOGIST_IN_PROGRESS, now
    db.commit()
    return progress_for_cases(db, [case_id])[case_id]


@router.get("/cases/{case_id}/masks/{mask_id}/data")
def mask_data(case_id: int, mask_id: int, db: Session = Depends(get_db), current_user: dict = Depends(any_role)):
    """Mask bytes for the in-browser editor (no file download). Assignees see their own work and the other role's."""
    authorize_case(db, current_user, case_id)
    mask = db.query(RetroMask).filter(RetroMask.qc_id == mask_id, RetroMask.qc_case_id == case_id).first()
    if not mask:
        raise HTTPException(status_code=404, detail="Mask not found")
    try:
        data = intake.read_from_gcs(mask.qc_gcs_path)
    except Exception:
        logger.exception("Mask read failed %s", mask_id)
        raise HTTPException(status_code=500, detail="Could not read mask")
    return Response(content=data, media_type="application/octet-stream")


@router.get("/cases/{case_id}/masks/{mask_id}/download")
def download_mask(case_id: int, mask_id: int, db: Session = Depends(get_db), current_user: dict = Depends(admin_only)):
    """Only an admin can download a mask file, and never for a rejected case."""
    _, a = authorize_case(db, current_user, case_id)
    if a and a.qc_status == ASSIGN_REJECTED:
        raise HTTPException(status_code=409, detail="This case was rejected by the Radiologist; nothing can be downloaded")
    mask = db.query(RetroMask).filter(RetroMask.qc_id == mask_id, RetroMask.qc_case_id == case_id).first()
    if not mask:
        raise HTTPException(status_code=404, detail="Mask not found")
    try:
        data = intake.read_from_gcs(mask.qc_gcs_path)
    except Exception:
        logger.exception("Mask read failed %s", mask_id)
        raise HTTPException(status_code=500, detail="Could not read mask")
    return Response(content=data, media_type="application/gzip",
                    headers={"Content-Disposition": f'attachment; filename="{mask.qc_filename}"'})


@router.get("/cases/{case_id}/masks.zip")
def download_masks_zip(case_id: int, db: Session = Depends(get_db), current_user: dict = Depends(admin_only)):
    """Latest mask per view and author role, in one zip."""
    _, a = authorize_case(db, current_user, case_id)
    if a and a.qc_status == ASSIGN_REJECTED:
        raise HTTPException(status_code=409, detail="This case was rejected by the Radiologist; nothing can be downloaded")
    latest = {}
    for m in db.query(RetroMask).filter(RetroMask.qc_case_id == case_id).order_by(RetroMask.qc_version).all():
        latest[(m.qc_role, m.qc_view)] = m
    if not latest:
        raise HTTPException(status_code=404, detail="No masks saved for this case")
    buf = io.BytesIO()
    try:
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:  # .nii.gz is already compressed
            for m in latest.values():
                z.writestr(m.qc_filename, intake.read_from_gcs(m.qc_gcs_path))
    except Exception:
        logger.exception("Mask zip failed for case %s", case_id)
        raise HTTPException(status_code=500, detail="Could not read the masks")
    code = _case(db, case_id).qc_case_code
    return Response(content=buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{code}_masks.zip"'})
