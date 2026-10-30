"""Who may see or change a retrospective case."""
from typing import Optional, Tuple

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ..db.session import get_db
from ..models.models import User
from ..models.retro import (ASSIGN_AWAITING, ASSIGN_IN_PROGRESS, ASSIGN_RADIOLOGIST_IN_PROGRESS,
                            ASSIGN_WITH_RADIOLOGIST, RetroAssignment, RetroCase)
from ..services.retro_workflow import ROLE_ADMIN, ROLE_MAMMO, ROLE_RADIOLOGIST
from .auth import get_current_user


def role_of(user: dict) -> str:
    r = (user.get("role") or "").strip().lower()
    return {"admin": ROLE_ADMIN, "mammo tech": ROLE_MAMMO, "radiologist": ROLE_RADIOLOGIST}.get(r, "")


def authorize_case(db: Session, user: dict, case_id: int, write: bool = False) -> Tuple[str, Optional[RetroAssignment]]:
    """Return (role, assignment) or raise.

    Admin: read everything, change nothing here.
    Mammo Tech: own assigned cases; may change them until segmented, except while with the radiologist.
    Radiologist: cases escalated to them; may change them while the review is open.
    """
    role = role_of(user)
    if not role:
        raise HTTPException(status_code=403, detail="Not allowed")
    if not db.query(RetroCase.qc_id).filter(RetroCase.qc_id == case_id).first():
        raise HTTPException(status_code=404, detail="Case not found")
    a = db.query(RetroAssignment).filter(RetroAssignment.qc_case_id == case_id).first()
    if role == ROLE_ADMIN:
        if write:
            raise HTTPException(status_code=403, detail="Admins have read-only access to cases")
        return role, a
    mine = a and ((role == ROLE_MAMMO and a.qc_mammo_tech_id == user["id"]) or
                  (role == ROLE_RADIOLOGIST and a.qc_radiologist_id == user["id"]))
    if not mine:
        raise HTTPException(status_code=404, detail="Case is not assigned to you")
    if write:
        open_states = {ROLE_MAMMO: {ASSIGN_AWAITING, ASSIGN_IN_PROGRESS},
                       ROLE_RADIOLOGIST: {ASSIGN_WITH_RADIOLOGIST, ASSIGN_RADIOLOGIST_IN_PROGRESS}}[role]
        if a.qc_status not in open_states:
            raise HTTPException(status_code=409, detail=f"Case is {a.qc_status.replace('_', ' ')}; it cannot be changed now")
    return role, a


def any_role(current_user: dict = Depends(get_current_user)) -> dict:
    if not role_of(current_user):
        raise HTTPException(status_code=403, detail="Not allowed")
    return current_user


def admin_only(current_user: dict = Depends(get_current_user)) -> dict:
    if role_of(current_user) != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="The user does not have enough privileges")
    return current_user
