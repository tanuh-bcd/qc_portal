import datetime
import logging
import os
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db.session import get_db
from ..models.models import Role, User
from ..models.retro import (ASSIGN_AWAITING, ASSIGN_IN_PROGRESS, ASSIGN_SEGMENTED, ASSIGN_WITH_RADIOLOGIST,
                            RetroAssignment, RetroCase)
from ..services import retro_mail
from .admin import check_admin_role, MAMMO_TECH_ROLE_NAME
from .retro import assignable, filtered_cases

router = APIRouter()
logger = logging.getLogger(__name__)
MAX_MASK_BYTES = 200 * 1024 * 1024


class CaseFilter(BaseModel):
    """The table's current filters, for 'assign everything that matches'."""
    q: str = ""
    birads: Optional[str] = None
    density: Optional[str] = None
    status: Optional[str] = None
    mammo_tech_id: Optional[int] = None
    vendor: Optional[str] = None
    manufacturer: Optional[str] = None


class AssignRangeRequest(BaseModel):
    """Assign by number range, by explicit case ids, or both (ids are added to the range)."""
    mammo_tech_id: int
    from_case: Optional[int] = None  # numeric part of case_00012 -> 12
    to_case: Optional[int] = None
    case_ids: Optional[List[int]] = None
    exclude: List[int] = []          # numbers left out of the range, e.g. cases going to someone else
    reassign: bool = False           # also move cases that are still Awaiting from another Mammo Tech
    matching: Optional[CaseFilter] = None  # everything the table shows for these filters, across all pages
    expected_count: Optional[int] = None   # how many the admin saw; refuse if the list changed since


class EscalateRequest(BaseModel):
    note: str


def _mammo_techs(db: Session) -> List[User]:
    role = db.query(Role).filter(func.lower(Role.qc_name) == MAMMO_TECH_ROLE_NAME.lower()).first()
    if not role:
        return []
    return db.query(User).filter(User.qc_role_id == role.qc_id, User.qc_is_active == True).order_by(User.qc_full_name).all()  # noqa: E712


@router.get("/mammo-techs")
def list_mammo_techs(db: Session = Depends(get_db), current_user: dict = Depends(check_admin_role)):
    """Active Mammo Techs with how much retrospective work each one holds."""
    counts = {}
    for tech_id, status, n in db.query(RetroAssignment.qc_mammo_tech_id, RetroAssignment.qc_status, func.count()) \
            .group_by(RetroAssignment.qc_mammo_tech_id, RetroAssignment.qc_status).all():
        counts.setdefault(tech_id, {})[status] = n
    return [{
        "id": u.qc_id, "name": u.qc_full_name or u.qc_email, "email": u.qc_email,
        "counts": counts.get(u.qc_id, {}), "total": sum(counts.get(u.qc_id, {}).values()),
    } for u in _mammo_techs(db)]


@router.post("/assign")
def assign_cases(payload: AssignRangeRequest, db: Session = Depends(get_db),
                 current_user: dict = Depends(check_admin_role)):
    """Assign cases to one Mammo Tech.

    A case that already has a Mammo Tech is left alone, unless reassign is set and the case is still Awaiting
    (nobody has opened it). Started or finished cases are never moved, because work would be lost.
    """
    wanted = set(payload.case_ids or [])
    if payload.matching is not None:
        matched = [c.qc_id for c in assignable(filtered_cases(db, **payload.matching.model_dump())).all()]
        if len(matched) > 5000:
            raise HTTPException(status_code=400, detail="More than 5000 cases match; narrow the filters")
        if payload.expected_count is not None and payload.expected_count != len(matched):
            raise HTTPException(status_code=409, detail=f"The list changed: {len(matched)} cases match now, not "
                                                        f"{payload.expected_count}. Review it and try again.")
        wanted |= set(matched)
    have_range = payload.from_case is not None and payload.to_case is not None
    if have_range:
        if payload.from_case < 1 or payload.to_case < payload.from_case:
            raise HTTPException(status_code=400, detail="Invalid range")
        if payload.to_case - payload.from_case > 5000:
            raise HTTPException(status_code=400, detail="Range too large (max 5000 cases at a time)")
        wanted |= set(range(payload.from_case, payload.to_case + 1))
    elif not wanted and payload.matching is None:
        raise HTTPException(status_code=400, detail="Give a list of cases, or choose what to assign")
    wanted -= set(payload.exclude or [])
    tech = next((u for u in _mammo_techs(db) if u.qc_id == payload.mammo_tech_id), None)
    if not tech:
        raise HTTPException(status_code=404, detail="Active Mammo Tech not found")

    cases = db.query(RetroCase).filter(RetroCase.qc_id.in_(wanted or [0])).order_by(RetroCase.qc_id).all()
    taken = {a.qc_case_id: a for a in db.query(RetroAssignment)
             .filter(RetroAssignment.qc_case_id.in_([c.qc_id for c in cases] or [0])).all()}
    now = datetime.datetime.utcnow()
    given, moved, already, locked = [], [], [], []
    given_ids, moved_from = [], {}
    for c in cases:
        a = taken.get(c.qc_id)
        if a is None:
            db.add(RetroAssignment(qc_case_id=c.qc_id, qc_mammo_tech_id=tech.qc_id,
                                   qc_assigned_by=current_user.get("id"), qc_status=ASSIGN_AWAITING))
            given.append(c.qc_case_code)
            given_ids.append(c.qc_id)
        elif a.qc_mammo_tech_id == tech.qc_id:
            already.append(c.qc_case_code)
        elif not payload.reassign:
            already.append(c.qc_case_code)
        elif a.qc_status != ASSIGN_AWAITING:
            locked.append(c.qc_case_code)
        else:
            moved_from[c.qc_id] = a.qc_mammo_tech_id
            a.qc_mammo_tech_id, a.qc_assigned_by, a.qc_assigned_at = tech.qc_id, current_user.get("id"), now
            moved.append(c.qc_case_code)
    db.commit()
    sent = sorted(given + moved)
    if sent:
        retro_mail.notify_assigned(db, tech, len(sent), sent[0], sent[-1])
    return {"assigned": len(given), "moved": len(moved), "already_assigned": already, "locked": locked,
            "assigned_ids": given_ids, "moved_from": {str(k): v for k, v in moved_from.items()},
            "not_found": len(wanted) - len(cases), "mammo_tech": tech.qc_full_name or tech.qc_email}


@router.post("/unassign")
def unassign(case_ids: List[int], db: Session = Depends(get_db), current_user: dict = Depends(check_admin_role)):
    """Take back cases nobody has opened yet."""
    rows = db.query(RetroAssignment).filter(RetroAssignment.qc_case_id.in_(case_ids)).all()
    removed, kept = 0, []
    for a in rows:
        if a.qc_status == ASSIGN_AWAITING:
            db.delete(a)
            removed += 1
        else:
            kept.append(a.qc_case_id)
    db.commit()
    return {"unassigned": removed, "not_awaiting": kept}
