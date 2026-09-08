from pydantic import BaseModel, EmailStr, field_validator, model_validator, Field
from typing import Optional, List, Literal
import datetime

class UserBase(BaseModel):
    qc_email: EmailStr
    qc_full_name: Optional[str] = None
    qc_hospital_id: str
    qc_role_id: int

class UserCreate(UserBase):
    password: str

class User(UserBase):
    qc_id: int
    qc_is_active: bool

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
    role: str
    email: EmailStr
    password: str

class ResetPasswordRequest(BaseModel):
    role: str
    email: EmailStr
    new_password: str

class HospitalBase(BaseModel):
    qc_name: str
    qc_short_name: Optional[str] = None
    qc_contact_person: str
    qc_email: EmailStr
    qc_address: Optional[str] = None
    qc_pincode: Optional[str] = None
    qc_state: Optional[str] = None
    qc_type: Optional[str] = None

class HospitalResponse(HospitalBase):
    qc_id: str

    class Config:
        from_attributes = True

class QuestionOptionResponse(BaseModel):
    qc_id: int
    qc_option_value: str
    qc_option_label: str
    qc_sort_order: int

    class Config:
        from_attributes = True

class QuestionResponse(BaseModel):
    qc_id: int
    qc_section: str
    qc_response_type: str
    qc_input_type: Optional[str] = None
    qc_is_required: bool = False
    qc_min_value: Optional[str] = None
    qc_max_value: Optional[str] = None
    qc_placeholder: Optional[str] = None
    qc_question_text: str
    qc_parent_question_id: Optional[int] = None
    qc_trigger_answer: Optional[str] = None
    options: list[QuestionOptionResponse] = []

    @field_validator('qc_min_value', 'qc_max_value', mode='before')
    @classmethod
    def convert_to_string(cls, v):
        if v is None:
            return None
        return str(v)

    class Config:
        from_attributes = True

class PatientResponseCreate(BaseModel):
    qc_question: str
    qc_answer: str

class PatientResponse(PatientResponseCreate):
    qc_id: int
    qc_created_at: datetime.datetime

    class Config:
        from_attributes = True


class AttachmentResponse(BaseModel):
    qc_id: int
    qc_file_type: str
    qc_file_name: str
    qc_storage_url: str
    qc_mime_type: Optional[str] = None

    class Config:
        from_attributes = True

class DoctorAssessmentResponse(BaseModel):
    qc_id: int
    qc_patient_session_id: str
    qc_hospital_id: str
    qc_doctor_id: int
    qc_questionnaire_feedback: Optional[str] = None
    qc_is_questionnaire_correct: bool
    qc_mammo_birads: Optional[str] = None
    qc_mammo_density: Optional[str] = None
    qc_us_biopsy_birads: Optional[str] = None
    qc_us_biopsy_density: Optional[str] = None
    qc_precision_diagnosis: Optional[str] = None
    qc_datapoint_feedback: Optional[str] = None
    qc_clinical_findings: Optional[dict] = None
    qc_recommendation_followup: Optional[str] = None
    qc_routine_views_uploaded: Optional[bool] = False
    qc_doctor_risk_class: Optional[str] = None
    qc_doctor_case_notes: Optional[str] = None
    qc_created_at: datetime.datetime
    attachments: List[AttachmentResponse] = []
    upload_warnings: Optional[List[str]] = None

    class Config:
        from_attributes = True

class PatientSessionListItem(BaseModel):
    qc_id: str
    patient_id: Optional[str] = None
    hospital_name: Optional[str] = None
    qc_consent_scanned_url: Optional[str] = None
    qc_consent_timestamp: Optional[datetime.datetime] = None
    snehita_risk: Optional[str] = None
    qc_risk_category: Optional[str] = None
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
    qc_patient_session_id: str
    qc_questionnaire_feedback: Optional[str] = None
    qc_is_questionnaire_correct: bool = False
    qc_mammo_birads: Optional[str] = None
    qc_mammo_density: Optional[str] = None
    qc_us_biopsy_birads: Optional[str] = None
    qc_us_biopsy_density: Optional[str] = None
    qc_precision_diagnosis: Optional[str] = None
    qc_datapoint_feedback: Optional[str] = None

class MachineBase(BaseModel):
    qc_machine: str
    qc_make: Optional[str] = None
    qc_technology: Optional[str] = None
    qc_no_of_machines: int = 1

    @field_validator('qc_no_of_machines')
    @classmethod
    def validate_no_of_machines(cls, v):
        if v <= 0:
            raise ValueError('no_of_machines must be a positive number')
        return v

class UserResponse(BaseModel):
    qc_id: int
    qc_full_name: str
    qc_email: str

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

class RadiologistOption(BaseModel):
    id: int
    full_name: Optional[str] = None
    email: str

    class Config:
        from_attributes = True


class SubjectListItem(BaseModel):
    assessment_id: int
    qc_subject_id: str
    session_id: Optional[str] = None
    hospital_name: Optional[str] = None
    risk_category: Optional[str] = None
    has_assessment: bool = True
    assignment_status: str = "Unassigned"
    radiologist_id: Optional[int] = None
    radiologist_name: Optional[str] = None
    radiologist_email: Optional[str] = None


class AssignRadiologistRequest(BaseModel):
    radiologist_id: int
    subject_ids: List[str]


class AssignMammoTechRequest(BaseModel):
    mammo_tech_id: int
    subject_ids: List[str]


class AssignmentListItem(BaseModel):
    assignment_id: int
    assessment_id: int
    qc_subject_id: str
    session_id: Optional[str] = None
    hospital_name: Optional[str] = None
    risk_category: Optional[str] = None
    has_assessment: bool = True
    radiologist_id: int
    radiologist_name: Optional[str] = None
    radiologist_email: Optional[str] = None
    mammo_tech_id: Optional[int] = None
    mammo_tech_name: Optional[str] = None
    mammo_tech_email: Optional[str] = None
    assigned_at: Optional[datetime.datetime] = None
    status: str
    review_notes: Optional[str] = None
    submitted_response: Optional[str] = None
    assigned_radiologist_id: Optional[int] = None
    assigned_radiologist_name: Optional[str] = None


class QCUserCreateRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    role: str
    hospital_id: Optional[str] = None
    cases: Optional[List[str]] = []


class QCUserResponse(BaseModel):
    id: int
    full_name: Optional[str] = None
    email: str
    role: str
    hospital_id: Optional[str] = None
    assigned_cases: int = 0
    failed_cases: List[str] = []


class RadiologistCaseItem(BaseModel):
    qc_subject_id: str
    hospital: Optional[str] = None
    case_id: int
    session_id: str
    status: str
    review_notes: Optional[str] = None
    has_assessment: bool = True
    assigned_at: Optional[datetime.datetime] = None
    submitted_response: Optional[str] = None
    assigned_radiologist_id: Optional[int] = None
    assigned_radiologist_name: Optional[str] = None


class RadiologistCasesResponse(BaseModel):
    success: bool = True
    user_id: int
    role: str
    cases: List[RadiologistCaseItem]


class BreastFindingsUpdate(BaseModel):
    birads: Optional[str] = None
    birads_4_sub: Optional[str] = None
    density: Optional[str] = None


class RadiologistReviewCompleteRequest(BaseModel):
    grade: Literal["Best", "Good", "Bad", "Not a Mammogram"]
    reason: Optional[str] = None
    left: Optional[BreastFindingsUpdate] = None
    right: Optional[BreastFindingsUpdate] = None
    case_notes: Optional[str] = None

    @model_validator(mode="after")
    def reason_required_for_bad_grades(self):
        if self.grade in ("Bad", "Not a Mammogram") and not (self.reason or "").strip():
            raise ValueError("A reason is required when the grade is Bad or Not a Mammogram")
        return self


class RadiologistReviewCompleteResponse(BaseModel):
    case_id: int
    status: str
    qc_completed_at: Optional[datetime.datetime] = None
    next_case: Optional[RadiologistCaseItem] = None


class MammoTechReviewRequest(BaseModel):
    confirmation: Literal["yes", "no"]
    left: Optional[BreastFindingsUpdate] = None
    right: Optional[BreastFindingsUpdate] = None
    case_notes: Optional[str] = None


class MammoTechReviewResponse(BaseModel):
    case_id: int
    status: str
    assigned_to: int
    assigned_radiologist_id: Optional[int] = None
    assigned_radiologist_name: Optional[str] = None
    message: str
    next_case: Optional[RadiologistCaseItem] = None
