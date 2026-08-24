from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List
import datetime

class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    hospital_id: str
    role_id: int

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    is_active: bool

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    full_name: Optional[str] = None
    is_super_viewer: bool = False

class TokenData(BaseModel):
    email: Optional[str] = None
    hospital_id: Optional[str] = None
    role: Optional[str] = None

class LoginRequest(BaseModel):
    hospital_name: str
    role: str
    email: EmailStr
    password: str

class ResetPasswordRequest(BaseModel):
    hospital_name: str
    role: str
    email: EmailStr
    new_password: str

class HospitalBase(BaseModel):
    name: str
    short_name: Optional[str] = None
    contact_person: str
    email: EmailStr
    address: Optional[str] = None
    pincode: Optional[str] = None
    state: Optional[str] = None
    type: Optional[str] = None

class HospitalCreate(HospitalBase):
    state: str
    type: str
    short_name: str

class HospitalResponse(HospitalBase):
    id: str

    class Config:
        from_attributes = True

class LanguageResponse(BaseModel):
    code: str
    name: str

    class Config:
        from_attributes = True

class QuestionOptionResponse(BaseModel):
    id: int
    option_value: str
    option_label: str
    sort_order: int

    class Config:
        from_attributes = True

class QuestionResponse(BaseModel):
    id: int
    section: str
    response_type: str
    input_type: Optional[str] = None
    is_required: bool = False
    min_value: Optional[str] = None
    max_value: Optional[str] = None
    placeholder: Optional[str] = None
    question_text: str
    parent_question_id: Optional[int] = None
    trigger_answer: Optional[str] = None
    options: list[QuestionOptionResponse] = []

    @field_validator('min_value', 'max_value', mode='before')
    @classmethod
    def convert_to_string(cls, v):
        if v is None:
            return None
        return str(v)

    class Config:
        from_attributes = True

class PatientResponseCreate(BaseModel):
    question: str
    answer: str

class PatientResponse(PatientResponseCreate):
    id: int
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class AttachmentResponse(BaseModel):
    id: int
    file_type: str
    file_name: str
    storage_url: str
    mime_type: Optional[str] = None

    class Config:
        from_attributes = True

class DoctorAssessmentResponse(BaseModel):
    id: int
    patient_session_id: str
    hospital_id: str
    doctor_id: int
    questionnaire_feedback: Optional[str] = None
    is_questionnaire_correct: bool
    mammo_birads: Optional[str] = None
    mammo_density: Optional[str] = None
    us_biopsy_birads: Optional[str] = None
    us_biopsy_density: Optional[str] = None
    precision_diagnosis: Optional[str] = None
    datapoint_feedback: Optional[str] = None
    clinical_findings: Optional[dict] = None
    recommendation_followup: Optional[str] = None
    routine_views_uploaded: Optional[bool] = False
    doctor_risk_class: Optional[str] = None
    doctor_case_notes: Optional[str] = None
    created_at: datetime.datetime
    attachments: List[AttachmentResponse] = []
    upload_warnings: Optional[List[str]] = None

    class Config:
        from_attributes = True

class PatientSessionListItem(BaseModel):
    id: str
    patient_id: Optional[str] = None
    hospital_name: Optional[str] = None
    consent_scanned_url: Optional[str] = None
    consent_timestamp: Optional[datetime.datetime] = None
    snehita_risk: Optional[str] = None
    risk_category: Optional[str] = None
    has_assessment: bool = False
    has_mammo_dicom: bool = False
    has_mammo_reading: Optional[str] = ""
    has_us_video: Optional[str] = ""
    has_us_reading: Optional[str] = ""
    has_biopsy: bool = False
    has_annotations: bool = False
    has_additional_docs: bool = False

    class Config:
        from_attributes = True

class PatientSessionDetail(PatientSessionListItem):
    responses: list[PatientResponse] = []
    assessment: Optional[DoctorAssessmentResponse] = None

    class Config:
        from_attributes = True

class QuestionnaireSubmission(BaseModel):
    session_id: str
    responses: list[PatientResponseCreate]

class DoctorAssessmentCreate(BaseModel):
    patient_session_id: str
    questionnaire_feedback: Optional[str] = None
    is_questionnaire_correct: bool = False
    mammo_birads: Optional[str] = None
    mammo_density: Optional[str] = None
    us_biopsy_birads: Optional[str] = None
    us_biopsy_density: Optional[str] = None
    precision_diagnosis: Optional[str] = None
    datapoint_feedback: Optional[str] = None

class MachineBase(BaseModel):
    machine: str
    make: Optional[str] = None
    technology: Optional[str] = None
    no_of_machines: int = 1

    @field_validator('no_of_machines')
    @classmethod
    def validate_no_of_machines(cls, v):
        if v <= 0:
            raise ValueError('no_of_machines must be a positive number')
        return v

class MachineCreate(MachineBase):
    hospital_id: str
    hospital_short_name: Optional[str] = None

class MachineResponse(MachineBase):
    id: int
    hospital_id: str
    hospital_short_name: Optional[str] = None

    class Config:
        from_attributes = True

class UserResponse(BaseModel):
    id: int
    full_name: str
    email: str

    class Config:
        from_attributes = True

class MRMCStudyCreate(BaseModel):
    name: str
    institution_ids: List[str]
    subject_ids: List[str]
    reader_user_ids: List[int]
    arbiter_user_id: int
class MRMCParticipantResponse(BaseModel):
    user_id: int
    full_name: str
    is_reader: bool
    is_arbiter: bool
    assigned_count: int
    submitted_count: int
    kappa_score: Optional[float]

    class Config:
        from_attributes = True

class MRMCStudyResponse(BaseModel):
    id: int
    name: str
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class ClinicianOption(BaseModel):
    id: int
    full_name: str

    class Config:
        from_attributes = True

class SubjectOption(BaseModel):
    id: str  # patient_session_id
    class Config:
        from_attributes = True

class SubjectAssignment(BaseModel):
    patient_session_id: str
    is_included: bool = True
    reader_user_id: Optional[int] = None
    arbiter_user_id: Optional[int] = None

    @field_validator("arbiter_user_id")
    @classmethod
    def reader_ne_arbiter(cls, v, info):
        if v is not None and v == info.data.get("reader_user_id"):
            raise ValueError("Reader and arbiter cannot be the same clinician")
        return v
    
class RiskCategoryResponse(BaseModel):
    id: int
    risk_category: str
    lifetime_risk_percentage: str
    description: Optional[str] = None
    recommendation: Optional[str] = None
    version_number: int
    display_order: int

    class Config:
        from_attributes = True


class RiskCategoryVersionResponse(BaseModel):
    version_number: int
    is_active: bool
    started_at: Optional[datetime.datetime] = None
    ended_at: Optional[datetime.datetime] = None
    created_at: datetime.datetime
    categories: List[RiskCategoryResponse] = []

    class Config:
        from_attributes = True


class RiskCategoryItemCreate(BaseModel):
    risk_category: str
    lifetime_risk_percentage: str
    description: Optional[str] = None
    recommendation: Optional[str] = None
    display_order: int = 0


class RiskCategoryVersionCreate(BaseModel):
    categories: List[RiskCategoryItemCreate]

class ModelWeightResponse(BaseModel):
    id: int
    feature_name: str
    weight_value: float
    version_number: int

    class Config:
        from_attributes = True


class ModelWeightItemCreate(BaseModel):
    feature_name: str
    weight_value: float


class ModelWeightsVersionCreate(BaseModel):
    weights: List[ModelWeightItemCreate]


class ModelWeightsVersionResponse(BaseModel):
    version_number: int
    is_active: bool
    started_at: Optional[datetime.datetime] = None
    ended_at: Optional[datetime.datetime] = None
    created_at: datetime.datetime
    weights: List[ModelWeightResponse] = []

    class Config:
        from_attributes = True

class RiskThresholdResponse(BaseModel):
    id: int
    risk_category: str
    min_percentage: Optional[float] = None 
    max_percentage: Optional[float] = None
    version_number: int

    class Config:
        from_attributes = True


class RiskThresholdItemCreate(BaseModel):
    risk_category: str
    min_percentage: Optional[float] = None
    max_percentage: Optional[float] = None


class RiskThresholdsVersionCreate(BaseModel):
    thresholds: List[RiskThresholdItemCreate]


class RiskThresholdsVersionResponse(BaseModel):
    version_number: int
    is_active: bool
    started_at: Optional[datetime.datetime] = None
    ended_at: Optional[datetime.datetime] = None
    created_at: datetime.datetime
    thresholds: List[RiskThresholdResponse] = []

    class Config:
        from_attributes = True