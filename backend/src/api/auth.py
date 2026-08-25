from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from ..db.session import get_db
from ..models.models import User, Hospital, Role
from ..schemas.schemas import Token, LoginRequest, HospitalResponse, TokenData, ResetPasswordRequest
from ..core.security import verify_password, create_access_token, get_password_hash
from ..core.email import send_template_email
from ..core.config import settings
from typing import List

router = APIRouter()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/qc/auth/login")

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    # DEBUG: Validating token
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        email: str = payload.get("sub")
        hospital_id: int = payload.get("hospital_id")
        role: str = payload.get("role")
        is_super_viewer: bool = payload.get("is_super_viewer", False)
        if email is None:
            raise credentials_exception

        user = db.query(User).filter(User.qc_email == email, User.qc_hospital_id == hospital_id).first()
        if not user:
            user = db.query(User).filter(User.qc_email == email).first()
        if not user:
            raise credentials_exception

        token_data = {"email": email, "hospital_id": hospital_id, "role": role, "id": user.qc_id,
                      "is_super_viewer": is_super_viewer}
    except JWTError:
        raise credentials_exception
    except Exception:
        raise credentials_exception
    return token_data

EXCLUDED_INSTITUTIONS = ('Tanuh Foundation',)


@router.get("/hospitals", response_model=List[HospitalResponse])
def get_hospitals(questionnaire: bool = False, db: Session = Depends(get_db)):
    query = db.query(Hospital)
    if questionnaire:
        query = query.filter(~Hospital.qc_name.in_(EXCLUDED_INSTITUTIONS))
    return query.all()

@router.post("/login", response_model=Token)
def login(login_data: LoginRequest, db: Session = Depends(get_db)):
    # 1. Find Role
    role = db.query(Role).filter(Role.qc_name == login_data.role).first()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid role",
        )

    # 2. Find User
    user = db.query(User).filter(
        User.qc_email == login_data.email,
        User.qc_role_id == role.qc_id
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

    # 4. Create Token
    is_super_viewer = user.qc_email.lower().endswith("@tanuh.ai")
    access_token = create_access_token(
        data={"sub": user.qc_email, "hospital_id": user.qc_hospital_id, "role": role.qc_name,
              "is_super_viewer": is_super_viewer}
    )
    return {"access_token": access_token, "token_type": "bearer", "full_name": user.qc_full_name or "",
            "is_super_viewer": is_super_viewer}

@router.post("/reset-password")
def reset_password(data: ResetPasswordRequest, db: Session = Depends(get_db)):
    role = db.query(Role).filter(Role.qc_name == data.role).first()
    if not role:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")

    # Matches the /login lookup (email + role only) — Radiologists aren't scoped
    # to a hospital, so a hospital filter here would never match their account.
    user = db.query(User).filter(
        User.qc_email == data.email,
        User.qc_role_id == role.qc_id
    ).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No account found with these details")

    if not user.qc_is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Account is inactive")

    user.qc_password_hash = get_password_hash(data.new_password)
    db.commit()

    try:
        send_template_email(db, "password_reset", data.email, {
            "full_name": user.qc_full_name or data.email,
            "email": data.email,
            "hospital_name": user.hospital.qc_name if user.hospital else "",
            "role_name": data.role,
        })
    except Exception:
        pass

    return {"msg": "Password has been reset successfully"}
