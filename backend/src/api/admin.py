from sqlalchemy import text
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from .doctor import _get_attachment_flags, INSTITUTE_QUESTIONS
from ..db.session import get_db, get_questionnaire_db
from ..models.models import MRMCStudy, MRMCStudyParticipant, PatientSession, User, Hospital, Role, Machine, DoctorAssessment
from ..schemas.schemas import MRMCParticipantResponse, MRMCStudyCreate, MRMCStudyResponse, PatientResponse, UserCreate, HospitalCreate, User as UserSchema, HospitalResponse, MachineCreate, MachineResponse, ClinicianOption
from ..core.security import get_password_hash
from ..core.email import send_template_email
from .auth import get_current_user

router = APIRouter()

def check_admin_role(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    user_role = current_user.get("role", "")
    if not user_role or user_role.lower() != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The user does not have enough privileges",
        )
    # Check if the admin belongs to Test hospital for certain operations
    hospital_id = current_user.get("hospital_id")
    hospital = db.query(Hospital).filter(Hospital.id == hospital_id).first()
    if hospital:
        current_user["hospital_name"] = hospital.name
    return current_user

def check_super_admin(current_user: dict = Depends(check_admin_role)):
    if current_user.get("hospital_name") != "Test":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This operation is only allowed for Test hospital admins",
        )
    return current_user

@router.post("/hospitals", response_model=HospitalResponse)
def create_hospital(
    hospital_in: HospitalCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(check_super_admin)
):
    hospital = db.query(Hospital).filter(Hospital.email == hospital_in.email).first()
    if hospital:
        raise HTTPException(
            status_code=400,
            detail="A hospital with this email already exists.",
        )
    from sqlalchemy import func
    max_id = db.query(func.max(Hospital.id)).scalar()
    if max_id and max_id.startswith("clinic_"):
        num = int(max_id.split("_")[1]) + 1
    else:
        num = 1
    new_id = f"clinic_{num:05d}"

    db_hospital = Hospital(
        id=new_id,
        name=hospital_in.name,
        short_name=hospital_in.short_name,
        contact_person=hospital_in.contact_person,
        email=hospital_in.email,
        address=hospital_in.address,
        pincode=hospital_in.pincode,
        state=hospital_in.state,
        type=hospital_in.type
    )
    db.add(db_hospital)
    db.commit()
    db.refresh(db_hospital)

    try:
        send_template_email(db, "hospital_added", hospital_in.email, {
            "hospital_name": hospital_in.name,
            "contact_person": hospital_in.contact_person,
            "contact_email": hospital_in.email,
            "address": hospital_in.address or "",
        })
    except Exception:
        pass

    return db_hospital

@router.post("/users", response_model=UserSchema)
def create_user(
    user_in: UserCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(check_admin_role)
):
    # If trying to create an Admin, only Test1 admin can do it
    role = db.query(Role).filter(Role.id == user_in.role_id).first()
    if role and role.name.lower() == 'admin':
        if current_user.get("hospital_name") != "Test":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only Test hospital admins can create other admin accounts",
            )

    user = db.query(User).filter(
        User.email == user_in.email,
        User.hospital_id == user_in.hospital_id,
        User.role_id == user_in.role_id
    ).first()
    if user:
        raise HTTPException(
            status_code=400,
            detail="A user with this email, hospital, and role already exists.",
        )
    # Verify hospital exists
    hospital = db.query(Hospital).filter(Hospital.id == user_in.hospital_id).first()
    if not hospital:
        raise HTTPException(
            status_code=404,
            detail="Hospital not found.",
        )
    # Verify role exists
    role = db.query(Role).filter(Role.id == user_in.role_id).first()
    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found.",
        )

    db_user = User(
        email=user_in.email,
        password_hash=get_password_hash(user_in.password),
        full_name=user_in.full_name,
        hospital_id=user_in.hospital_id,
        role_id=user_in.role_id,
        is_active=True
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    try:
        send_template_email(db, "user_created", user_in.email, {
            "full_name": user_in.full_name or user_in.email,
            "email": user_in.email,
            "hospital_name": hospital.name,
            "role_name": role.name,
            "temp_password": user_in.password,
        })
    except Exception:
        pass

    return db_user

@router.get("/roles")
def get_roles(
    db: Session = Depends(get_db),
    current_user: dict = Depends(check_admin_role)
):
    return db.query(Role).all()


@router.post("/machines", response_model=MachineResponse)
def create_machine(
    machine_in: MachineCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(check_admin_role)
):
    hospital = db.query(Hospital).filter(Hospital.id == machine_in.hospital_id).first()
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found.")

    if current_user.get("hospital_name") != "Test" and current_user.get("hospital_id") != machine_in.hospital_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only create machine details for your own institution.",
        )

    if machine_in.hospital_short_name and hospital.short_name and machine_in.hospital_short_name != hospital.short_name:
        raise HTTPException(
            status_code=400,
            detail="Hospital short name does not match the selected institute.",
        )

    db_machine = Machine(
        hospital_id=machine_in.hospital_id,
        hospital_short_name=machine_in.hospital_short_name or hospital.short_name,
        machine=machine_in.machine,
        make=machine_in.make,
        technology=machine_in.technology,
        no_of_machines=machine_in.no_of_machines
    )
    db.add(db_machine)
    db.commit()
    db.refresh(db_machine)
    return db_machine

def require_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "Admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user

@router.post("/mrmc-studies", response_model=MRMCStudyResponse)
def create_mrmc_study(
    data: MRMCStudyCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin)
):
    if data.arbiter_user_id in data.reader_user_ids:
        raise HTTPException(
            status_code=400,
            detail="A user cannot be assigned as both reader and arbiter"
        )
    if len(data.reader_user_ids) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least 2 readers (C1, C2) are required"
        )
    if not data.subject_ids:
        raise HTTPException(
            status_code=400,
            detail="At least one subject/case is required"
        )
    if not data.institution_ids:
        raise HTTPException(
            status_code=400,
            detail="At least one institution is required"
        )

    study = MRMCStudy(
        name=data.name,
        hospital_id=current_user["hospital_id"],
        created_by=current_user["id"]
    )
    db.add(study)
    db.flush()  # populates study.id before commit

    for uid in data.reader_user_ids:
        db.add(MRMCStudyParticipant(
            study_id=study.id,
            user_id=uid,
            is_reader=True,
            assigned_count=len(data.subject_ids)
        ))
    db.add(MRMCStudyParticipant(
        study_id=study.id,
        user_id=data.arbiter_user_id,
        is_arbiter=True,
        assigned_count=0  
    ))

    for session_id in data.subject_ids:
        # STOPGAP: case-linking disabled until MRMCStudyCase exists.
        # db.add(MRMCStudyCase(study_id=study.id, session_id=session_id))
        pass

    for institution_id in data.institution_ids:
        # STOPGAP: institution-linking disabled until MRMCStudyInstitution
        # exists. Needs a migration:
        #   class MRMCStudyInstitution(Base):
        #       __tablename__ = "mrmc_study_institutions"
        #       id = Column(Integer, primary_key=True)
        #       study_id = Column(Integer, ForeignKey("mrmc_studies.id"))
        #       hospital_id = Column(String, ForeignKey("hospitals.id"))
        # db.add(MRMCStudyInstitution(study_id=study.id, hospital_id=institution_id))
        pass

    db.commit()
    db.refresh(study)
    return study

@router.get("/mrmc-studies/participants", response_model=List[MRMCParticipantResponse])
def get_study_participants(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin)
):
    rows = (
        db.query(MRMCStudyParticipant, User.full_name)
        .join(User, MRMCStudyParticipant.user_id == User.id)
        .join(MRMCStudy, MRMCStudyParticipant.study_id == MRMCStudy.id)
        .filter(MRMCStudy.hospital_id == current_user["hospital_id"])
        .all()
    )

    aggregated = {}
    for p, full_name in rows:
        entry = aggregated.setdefault(p.user_id, {
            "user_id": p.user_id,
            "full_name": full_name,
            "is_reader": False,
            "is_arbiter": False,
            "assigned_count": 0,
            "submitted_count": 0,
            "kappa_scores": []
        })
        entry["is_reader"] = entry["is_reader"] or p.is_reader
        entry["is_arbiter"] = entry["is_arbiter"] or p.is_arbiter
        entry["assigned_count"] += p.assigned_count or 0
        entry["submitted_count"] += p.submitted_count or 0
        if p.kappa_score is not None:
            entry["kappa_scores"].append(p.kappa_score)

    return [
        MRMCParticipantResponse(
            user_id=e["user_id"],
            full_name=e["full_name"],
            is_reader=e["is_reader"],
            is_arbiter=e["is_arbiter"],
            assigned_count=e["assigned_count"],
            submitted_count=e["submitted_count"],
            kappa_score=(sum(e["kappa_scores"]) / len(e["kappa_scores"])) if e["kappa_scores"] else None
        )
        for e in aggregated.values()
    ]
@router.get("/users/clinicians", response_model=List[ClinicianOption])
def get_clinicians(
    institution_id: List[str] = Query(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(check_admin_role)
):
    clinicians = (
        db.query(User.id, User.full_name)
        .filter(
            User.role_id == 2,
            User.hospital_id.in_(institution_id)
        )
        .order_by(User.full_name)
        .all()
    )

    return [
        ClinicianOption(id=u.id, full_name=u.full_name)
        for u in clinicians
    ]

def _get_subject_hospital(q_db: Session, app_db: Session, session_id: str):
    row = q_db.execute(text("""
        SELECT answer FROM session_data_table
        WHERE session_id = :sid AND question IN :inst_questions
        LIMIT 1
    """), {"sid": session_id, "inst_questions": INSTITUTE_QUESTIONS}).fetchone()
    if not row:
        return None
    return app_db.query(Hospital).filter(Hospital.name == row[0]).first()


def _get_subject_patient_id(q_db: Session, session_id: str):
    row = q_db.execute(text("""
        SELECT answer FROM session_data_table
        WHERE session_id = :sid
          AND question IN ('Enter your Patient ID(if any, else leave):', 'Enter your subject ID:', 'Q44')
        LIMIT 1
    """), {"sid": session_id}).fetchone()
    return row[0] if row else None


class SubjectCaseData(BaseModel):
    patient_session_id: str
    patient_id: Optional[str] = None
    ethnicity: Optional[str] = None
    age: Optional[str] = None
    state: Optional[str] = None
    machine: Optional[str] = None
    brand: Optional[str] = None
    institution: Optional[str] = None

CASE_DATA_QUESTIONS = {
    "age": "What is your current age? (Please enter a number - years)",
    "state": "Which state or union territory best represents the place where you have lived for a significant part of your life?",
    "ethnicity": "Please select your ethnicity:",
}

def _missing(v):
    return v if v not in (None, "", "null") else None

def _build_case_data(q_db: Session, app_db: Session, session_id: str) -> SubjectCaseData:
    rows = q_db.execute(
        text("SELECT question, answer FROM session_data_table WHERE session_id = :sid"),
        {"sid": session_id}
    ).fetchall()
    responses = {r[0]: r[1] for r in rows}

    hospital = _get_subject_hospital(q_db, app_db, session_id)
    machine = app_db.query(Machine).filter(Machine.hospital_id == hospital.id).first() if hospital else None

    return SubjectCaseData(
        patient_session_id=session_id,
        patient_id=_missing(_get_subject_patient_id(q_db, session_id)),
        ethnicity=_missing(responses.get(CASE_DATA_QUESTIONS["ethnicity"])),
        age=_missing(responses.get(CASE_DATA_QUESTIONS["age"])),
        state=_missing(responses.get(CASE_DATA_QUESTIONS["state"])),
        machine=_missing(machine.machine if machine else None),
        brand=_missing(machine.make if machine else None),
        institution=_missing(hospital.name if hospital else None),
    )


@router.post("/subjects/case-data", response_model=List[SubjectCaseData])
def get_subjects_case_data(
    session_ids: List[str],
    q_db: Session = Depends(get_questionnaire_db),
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(check_admin_role)
):
    return [_build_case_data(q_db, app_db, sid) for sid in session_ids]


class SubjectOption(BaseModel):
    id: str
    subject_id: str


@router.get("/subjects", response_model=List[SubjectOption])
def get_available_subjects(
    institution_id: List[str] = Query(...),
    q_db: Session = Depends(get_questionnaire_db),
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(check_admin_role)
):
    hospitals = app_db.query(Hospital).filter(Hospital.id.in_(institution_id)).all()
    valid_names = [h.name for h in hospitals]
    if not valid_names:
        return []

    rows = q_db.execute(text("""
        SELECT s.session_id, pid.answer AS patient_id
        FROM session_table s
        JOIN (
            SELECT session_id, MIN(answer) AS answer
            FROM session_data_table
            WHERE question IN :inst_questions
              AND answer IN :valid_names
            GROUP BY session_id
        ) hosp ON s.session_id = hosp.session_id
        LEFT JOIN (
            SELECT session_id, MIN(answer) AS answer
            FROM session_data_table
            WHERE question IN ('Enter your Patient ID(if any, else leave):', 'Enter your subject ID:', 'Q44')
            GROUP BY session_id
        ) pid ON s.session_id = pid.session_id
        WHERE s.snehita_lifetime_risk IS NOT NULL
    """), {"inst_questions": INSTITUTE_QUESTIONS, "valid_names": tuple(valid_names)}).fetchall()

    result = []
    for session_id, patient_id in rows:
        assessment = app_db.query(DoctorAssessment).filter(
            DoctorAssessment.patient_session_id == session_id
        ).options(joinedload(DoctorAssessment.attachments)).first()
        flags = _get_attachment_flags(assessment)
        if flags["has_mammo_dicom"]:
            result.append(SubjectOption(id=session_id, subject_id=patient_id or session_id))
    return result


@router.get("/subjects/{session_id}/clinicians", response_model=List[ClinicianOption])
def get_subject_clinicians(
    session_id: str,
    q_db: Session = Depends(get_questionnaire_db),
    app_db: Session = Depends(get_db),
    current_user: dict = Depends(check_admin_role)
):
    hospital = _get_subject_hospital(q_db, app_db, session_id)
    if not hospital:
        raise HTTPException(status_code=404, detail="Could not resolve subject's institution")
    clinicians = (
        app_db.query(User.id, User.full_name)
        .filter(User.role_id == 2, User.hospital_id == hospital.id)
        .order_by(User.full_name)
        .all()
    )
    return [ClinicianOption(id=u.id, full_name=u.full_name) for u in clinicians]