from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


class QcLoginRequest(BaseModel):
    role: str
    email: str
    password: str


class QcToken(BaseModel):
    access_token: str
    token_type: str
    full_name: str
    qc_id: int


class QcRoleResponse(BaseModel):
    qc_id: int
    qc_name: str

    class Config:
        from_attributes = True


class QcUserResponse(BaseModel):
    qc_id: int
    qc_full_name: Optional[str] = None
    qc_email: str

    class Config:
        from_attributes = True


class QcSubjectResponse(BaseModel):
    qc_id: int
    display_id: str
    qc_patient_session_id: Optional[str] = None
    qc_created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


from typing import List, Literal

class QcAssignmentCreate(BaseModel):
    assessment_ids: List[int]
    full_name: str
    email: EmailStr
    password: str
    role: str = "QC Radiologist"
    assigned: Literal["yes", "no"] = "no"

class QcAssignmentResponse(BaseModel):
    qc_id: int
    qc_status: str

    class Config:
        from_attributes = True


class QcAssignmentBatchResponse(BaseModel):
    created: List[QcAssignmentResponse]
    skipped: List[int]


class QcUserAssignedSubject(BaseModel):
    qc_assignment_id: int
    subject_id: int
    display_id: str
    qc_status: str
    role_name: Optional[str] = None
    qc_patient_session_id: Optional[str] = None
    qc_assigned_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class QcAllAssignmentItem(BaseModel):
    qc_assignment_id: int
    subject_id: int
    display_id: str
    radiologist_id: int
    radiologist_name: Optional[str] = None
    radiologist_email: str
    role_name: Optional[str] = None
    qc_status: str
    qc_assigned_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class QcSubjectResponse(BaseModel):
    qc_id: int
    display_id: str
    qc_patient_session_id: Optional[str] = None
    qc_created_at: Optional[datetime] = None
    is_assigned: bool = False

class QcSubjectListResponse(BaseModel):
    total: int
    subjects: List[QcSubjectResponse]
    
class QcAdminSubjectListItem(BaseModel):
    id: str
    display_id: str
    patient_id: str
    hospital_name: Optional[str] = None
    consent_scanned_url: Optional[str] = None
    consent_timestamp: Optional[datetime] = None
    snehita_risk: Optional[str] = None      # matches your sample: "0.43" as string, not float
    risk_category: str
    has_assessment: bool
    has_mammo_dicom: bool
    has_mammo_reading: str
    has_us_video: str
    has_us_reading: str
    has_biopsy: bool
    has_annotations: bool
    has_additional_docs: bool
    qc_assignment_id: int
    radiologist_id: int
    radiologist_name: Optional[str] = None
    radiologist_email: str
    role_name: Optional[str] = None
    qc_status: str
    qc_assigned_at: Optional[datetime] = None
    qc_short_name: Optional[str] = None