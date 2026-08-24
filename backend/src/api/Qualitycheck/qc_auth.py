from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from ...db.Qualitycheck.qc_session import get_qc_db
from ...models.Qualitycheck.qc_models import QcUser, QcRole
from ...schemas.Qualitycheck.qc_schema import QcLoginRequest, QcToken, QcRoleResponse
from ...core.security import verify_password, create_access_token

router = APIRouter()

@router.post("/qc-login", response_model=QcToken)
def qc_login(login_data: QcLoginRequest, db: Session = Depends(get_qc_db)):
    role = db.query(QcRole).filter(QcRole.qc_name == login_data.role).first()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid role",
        )

    user = db.query(QcUser).filter(
        QcUser.qc_email == login_data.email,
        QcUser.qc_role_id == role.qc_id
    ).first()

    if not user or not verify_password(login_data.password, user.qc_password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if not user.qc_is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user",
        )

    access_token = create_access_token(
        data={"sub": user.qc_email, "role": role.qc_name, "is_qc_user": True}
    )
    return {
    "access_token": access_token,
    "token_type": "bearer",
    "full_name": user.qc_full_name or "",
    "qc_id": user.qc_id,
}

@router.get("/qc-roles", response_model=List[QcRoleResponse])
def get_qc_roles(db: Session = Depends(get_qc_db)):
    return db.query(QcRole).all()