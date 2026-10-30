"""Assignment/segmentation progress, mask validation and access rules for retrospective cases."""
import gzip
import io
import struct
from typing import Dict, Iterable, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.models import User
from ..models.retro import RetroAssignment, RetroFile, RetroMask, RetroNote

STATUS_LABELS = {
    "unassigned": "Unassigned",
    "awaiting": "Awaiting",
    "in_progress": "In progress",
    "with_radiologist": "With radiologist",
    "radiologist_in_progress": "Radiologist in progress",
    "segmented": "Segmented",
    "rejected": "Rejected by Radiologist",
}
ROLE_MAMMO, ROLE_RADIOLOGIST, ROLE_ADMIN = "mammo_tech", "radiologist", "admin"


def user_name(user) -> str:
    return (user.qc_full_name or user.qc_email) if user else ""


def _iso(value):
    return value.isoformat() if value else None


def progress_for_cases(db: Session, case_ids: Iterable[int]) -> Dict[int, dict]:
    """Assignment, annotation and note counts for the given case ids."""
    ids: List[int] = list(case_ids)
    out = {i: {"status": "unassigned", "status_label": STATUS_LABELS["unassigned"], "assignment": None,
               "annotation": {"done": False, "views": []}, "radiologist_views": [], "note_count": 0} for i in ids}
    if not ids:
        return out
    users: Dict[int, Optional[User]] = {}

    def who(uid):
        if uid not in users:
            users[uid] = db.query(User).filter(User.qc_id == uid).first()
        return users[uid]

    for a in db.query(RetroAssignment).filter(RetroAssignment.qc_case_id.in_(ids)).all():
        row = out[a.qc_case_id]
        row["status"], row["status_label"] = a.qc_status, STATUS_LABELS.get(a.qc_status, a.qc_status)
        row["assignment"] = {
            "mammo_tech_id": a.qc_mammo_tech_id, "mammo_tech_name": user_name(who(a.qc_mammo_tech_id)),
            "assigned_by": user_name(who(a.qc_assigned_by)) if a.qc_assigned_by else None,
            "assigned_at": _iso(a.qc_assigned_at), "started_at": _iso(a.qc_started_at),
            "escalated_at": _iso(a.qc_escalated_at), "escalation_note": a.qc_escalation_note,
            "radiologist_id": a.qc_radiologist_id,
            "radiologist_name": user_name(who(a.qc_radiologist_id)) if a.qc_radiologist_id else None,
            "radiologist_assigned_at": _iso(a.qc_radiologist_assigned_at),
            "radiologist_started_at": _iso(a.qc_radiologist_started_at),
            "radiologist_completed_at": _iso(a.qc_radiologist_completed_at),
            "radiologist_reviewed": bool(a.qc_radiologist_completed_at),
            "completed_at": _iso(a.qc_completed_at),
            "rejected_at": _iso(a.qc_rejected_at), "reject_reason": a.qc_reject_reason,
            "rejected_by": user_name(who(a.qc_rejected_by)) if a.qc_rejected_by else None,
        }
    masks = db.query(RetroMask).filter(RetroMask.qc_case_id.in_(ids)).order_by(RetroMask.qc_version).all()
    latest: Dict[Tuple[int, str, str], RetroMask] = {}
    for m in masks:  # ascending version, so the last write per (case, role, view) wins
        latest[(m.qc_case_id, m.qc_role, m.qc_view or "")] = m
    for (cid, role, view), m in latest.items():
        if role == ROLE_RADIOLOGIST:
            out[cid]["radiologist_views"].append(view)
            continue
        info = out[cid]["annotation"]
        info["views"].append(view)
        if not info.get("at") or (m.qc_uploaded_at and m.qc_uploaded_at.isoformat() > info["at"]):
            info["at"], info["by"] = _iso(m.qc_uploaded_at), user_name(who(m.qc_uploaded_by))
    for cid, row in out.items():
        row["annotation"]["views"].sort()
        row["radiologist_views"].sort()
        row["annotation"]["done"] = row["status"] == "segmented"
        if not row["annotation"]["done"] and row["annotation"]["views"]:
            row["annotation"]["draft"] = True  # masks exist but the Mammo Tech has not finished
    for cid, n in db.query(RetroNote.qc_case_id, func.count()) \
            .filter(RetroNote.qc_case_id.in_(ids)).group_by(RetroNote.qc_case_id).all():
        out[cid]["note_count"] = n
    return out


def read_nifti_header(data: bytes) -> Tuple[str, Tuple[int, int, int]]:
    """Check a gzipped NIfTI-1 file and return (problem, (nx, ny, nz)). problem is '' when fine."""
    if data[:2] != b"\x1f\x8b":
        return "File is not gzip-compressed (.nii.gz expected)", (0, 0, 0)
    try:
        head = gzip.GzipFile(fileobj=io.BytesIO(data)).read(348)
    except Exception:
        return "File is corrupt or truncated gzip", (0, 0, 0)
    if len(head) < 348:
        return "File is too small to be a NIfTI image", (0, 0, 0)
    for order in ("<", ">"):
        if struct.unpack(f"{order}i", head[:4])[0] == 348 and head[344:347] in (b"n+1", b"ni1"):
            dims = struct.unpack(f"{order}8h", head[40:56])
            nz = dims[3] if dims[0] >= 3 else 1
            return "", (dims[1], dims[2], nz)
    return "Not a valid NIfTI-1 header", (0, 0, 0)


def validate_nifti_gz(data: bytes) -> str:
    return read_nifti_header(data)[0]


def view_dimensions(db: Session, case_id: int, view: str) -> Optional[Tuple[int, int]]:
    """(columns, rows) of a view's DICOM from the stored header cache, or None if unknown."""
    f = db.query(RetroFile).filter(RetroFile.qc_case_id == case_id, RetroFile.qc_kind == "view",
                                   RetroFile.qc_view == view).first()
    if not f or not f.qc_dicom_headers:
        return None
    vals = {h.get("name"): h.get("value") for h in f.qc_dicom_headers}
    try:
        return int(vals["Columns"]), int(vals["Rows"])
    except (KeyError, TypeError, ValueError):
        return None
