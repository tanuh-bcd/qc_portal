from sqlalchemy import Column, Float, Integer, String, ForeignKey, Boolean, TIMESTAMP, UniqueConstraint, text, Text, Enum, JSON, Index, Date, DateTime
from sqlalchemy.orm import relationship
from ..db.session import Base
import enum

class QuestionResponseType(str, enum.Enum):
    text_field = "text_field"
    option = "option"
    numbers_only = "numbers_only"

class Hospital(Base):
    __tablename__ = "qc_hospitals"

    qc_id = Column(String(20), primary_key=True, index=True)
    qc_name = Column(String(255), nullable=False)
    qc_short_name = Column(String(20), nullable=True)
    qc_contact_person = Column(String(50), nullable=False)
    qc_email = Column(String(255), nullable=False, unique=True)
    qc_address = Column(Text)
    qc_pincode = Column(String(10))
    qc_state = Column(String(100))
    qc_type = Column(String(100), nullable=True)
    qc_created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    users = relationship("User", back_populates="hospital")
    machines = relationship("Machine", back_populates="hospital", cascade="all, delete-orphan")  # renamed + uselist implicit True

class Machine(Base):
    __tablename__ = "qc_machines"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_hospital_id = Column(String(20), ForeignKey("qc_hospitals.qc_id", ondelete="CASCADE"), nullable=False, index=True)
    qc_hospital_short_name = Column(String(255), nullable=True)
    qc_machine = Column(String(255), nullable=False)
    qc_make = Column(String(255), nullable=True)
    qc_technology = Column(String(255), nullable=True)
    qc_no_of_machines = Column(Integer, default=1)
    hospital = relationship("Hospital", back_populates="machines")
class Role(Base):
    __tablename__ = "qc_roles"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_name = Column(String(50), nullable=False, unique=True)

    users = relationship("User", back_populates="role")

class User(Base):
    __tablename__ = "qc_users"
    __table_args__ = (
        Index("idx_users_email_hospital_role", "qc_email", "qc_hospital_id", "qc_role_id", unique=True),
    )

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_hospital_id = Column(String(20), ForeignKey("qc_hospitals.qc_id"))
    qc_role_id = Column(Integer, ForeignKey("qc_roles.qc_id"))
    qc_email = Column(String(255), nullable=False)
    qc_password_hash = Column(String(255), nullable=False)
    qc_full_name = Column(String(255))
    qc_is_active = Column(Boolean, default=True)

    hospital = relationship("Hospital", back_populates="users")
    role = relationship("Role", back_populates="users")

class EmailTemplate(Base):
    __tablename__ = "qc_email_templates"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_template_key = Column(String(50), nullable=False, unique=True)
    qc_subject = Column(String(255), nullable=False)
    qc_body_html = Column(Text, nullable=False)
    qc_description = Column(String(255))
    qc_created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    qc_updated_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"))

class EmailTemplateCc(Base):
    __tablename__ = "qc_email_template_cc"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_template_key = Column(String(50), ForeignKey("qc_email_templates.qc_template_key", ondelete="CASCADE"), nullable=False)
    qc_cc_email = Column(String(255), nullable=False)

class ReminderEmailLog(Base):
    __tablename__ = "reminder_email_log"
    __table_args__ = (
        Index("uq_reminder_idempotency_key", "idempotency_key", unique=True),
    )

    id = Column(Integer, primary_key=True, index=True)
    report_type = Column(String(20), nullable=False, default="hospital")
    hospital_id = Column(String(20), ForeignKey("qc_hospitals.qc_id"), nullable=True, index=True)
    recipient_email = Column(String(255), nullable=False)
    idempotency_key = Column(String(500), nullable=False)
    report_date = Column(Date, nullable=False)
    quarter_start = Column(Date, nullable=False)
    quarter_end = Column(Date, nullable=False)
    data_points = Column(Integer, nullable=False)
    lifetime_data_points = Column(Integer, nullable=False, default=0)
    assessments_submitted = Column(Integer, nullable=False)
    pending_submissions = Column(Integer, nullable=False)
    quarterly_target = Column(Integer, nullable=False, default=200)
    missing_questionnaire_sessions = Column(Integer, nullable=False, default=0)
    missing_consent = Column(Integer, nullable=False, default=0)
    missing_birads = Column(Integer, nullable=False, default=0)
    missing_density = Column(Integer, nullable=False, default=0)
    incomplete_assessments = Column(Integer, nullable=False, default=0)
    missing_mammogram_views = Column(Integer, nullable=False, default=0)
    missing_mammogram_reports = Column(Integer, nullable=False, default=0)
    mammogram_quality_flags = Column(Integer, nullable=False, default=0)
    status = Column(String(20), nullable=False, default="pending")
    attempt_count = Column(Integer, nullable=False, default=0)
    error_message = Column(Text)
    failure_notified_at = Column(DateTime)
    failure_notification_error = Column(Text)
    sent_at = Column(DateTime)
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    hospital = relationship("Hospital")


class ReminderConfiguration(Base):
    __tablename__ = "reminder_configuration"

    id = Column(Integer, primary_key=True)
    is_paused = Column(Boolean, nullable=False, default=False)
    is_disabled = Column(Boolean, nullable=False, default=False)
    updated_by = Column(String(255))
    updated_at = Column(DateTime)

class Question(Base):
    __tablename__ = "qc_questions"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_section = Column(String(100))
    qc_response_type = Column(Enum("text_field", "option", "numbers_only"), nullable=False)
    qc_input_type = Column(String(50))
    qc_is_required = Column(Boolean, default=False)
    qc_min_value = Column(String(50), nullable=True)
    qc_max_value = Column(String(50), nullable=True)
    qc_placeholder = Column(String(255), nullable=True)
    qc_question = Column(Text, nullable=True)
    qc_parent_question_id = Column(Integer, ForeignKey("qc_questions.qc_id"), nullable=True)
    qc_trigger_answer = Column(String(255), nullable=True)

    translations = relationship("QuestionTranslation", back_populates="question")
    options = relationship("QuestionOption", back_populates="question")

class QuestionTranslation(Base):
    __tablename__ = "qc_question_translations"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_question_id = Column(Integer, ForeignKey("qc_questions.qc_id", ondelete="CASCADE"), nullable=False)
    qc_language_code = Column(String(5), ForeignKey("qc_languages.qc_code"), nullable=False)
    qc_question_text = Column(Text, nullable=False)

    question = relationship("Question", back_populates="translations")

class QuestionOption(Base):
    __tablename__ = "qc_question_options"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_question_id = Column(Integer, ForeignKey("qc_questions.qc_id", ondelete="CASCADE"), nullable=False)
    qc_option_value = Column(Text, nullable=False)
    qc_sort_order = Column(Integer, default=0)

    question = relationship("Question", back_populates="options")
    translations = relationship("QuestionOptionTranslation", back_populates="option")

class QuestionOptionTranslation(Base):
    __tablename__ = "qc_question_option_translations"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_option_id = Column(Integer, ForeignKey("qc_question_options.qc_id", ondelete="CASCADE"), nullable=False)
    qc_language_code = Column(String(5), ForeignKey("qc_languages.qc_code"), nullable=False)
    qc_option_label = Column(Text, nullable=False)

    option = relationship("QuestionOption", back_populates="translations")

class PatientSession(Base):
    __tablename__ = "qc_patient_sessions"

    qc_id = Column(String(20), primary_key=True, index=True)
    qc_hospital_id = Column(String(20), ForeignKey("qc_hospitals.qc_id"))
    qc_consent_scanned_url = Column(Text)
    qc_consent_timestamp = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    hospital = relationship("Hospital")
    responses = relationship("PatientResponse", back_populates="session", cascade="all, delete-orphan")
    assessments = relationship("DoctorAssessment", back_populates="session")

class PatientResponse(Base):
    __tablename__ = "qc_patient_responses"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_hospital_id = Column(String(20), ForeignKey("qc_hospitals.qc_id"), nullable=False)
    qc_session_id = Column(String(20), ForeignKey("qc_patient_sessions.qc_id", ondelete="CASCADE"), nullable=False)
    qc_question = Column(Text, nullable=False)
    qc_answer = Column(Text, nullable=False)
    qc_created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    qc_updated_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"))

    hospital = relationship("Hospital")
    session = relationship("PatientSession", back_populates="responses")

class DoctorAssessment(Base):
    __tablename__ = "qc_doctor_assessments"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_sub_ui_id = Column(String(20), unique=True, index=True)
    qc_patient_session_id = Column(String(20), ForeignKey("qc_patient_sessions.qc_id", ondelete="CASCADE"), nullable=False)
    qc_hospital_id = Column(String(20), ForeignKey("qc_hospitals.qc_id"), nullable=False)
    qc_doctor_id = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=False)
    qc_questionnaire_feedback = Column(Text)
    qc_is_questionnaire_correct = Column(Boolean, default=False)
    qc_mammo_birads = Column(Enum('0', '1', '2', '3', '4', '5', '6'))
    qc_mammo_density = Column(Enum('A', 'B', 'C', 'D'))
    qc_us_biopsy_birads = Column(Enum('0', '1', '2', '3', '4', '5', '6'))
    qc_us_biopsy_density = Column(Enum('A', 'B', 'C', 'D'))
    qc_precision_diagnosis = Column(Enum('4A','4B','4C'))
    qc_datapoint_feedback = Column(Text)
    qc_clinical_findings = Column(JSON)
    qc_recommendation_followup = Column(Text)
    qc_routine_views_uploaded = Column(Boolean, default=False)
    qc_doctor_risk_class = Column(String(50))
    qc_doctor_case_notes = Column(Text)
    qc_created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    session = relationship("PatientSession")
    hospital = relationship("Hospital")
    doctor = relationship("User")
    attachments = relationship("Attachment", back_populates="assessment", cascade="all, delete-orphan")

class Attachment(Base):
    __tablename__ = "qc_attachments"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_assessment_id = Column(Integer, ForeignKey("qc_doctor_assessments.qc_id", ondelete="CASCADE"), nullable=False)
    qc_file_type = Column(String(50), nullable=False)  # e.g., 'mammo_dicom', 'us_video'
    qc_file_name = Column(String(255), nullable=False)
    qc_storage_url = Column(Text, nullable=False)
    qc_mime_type = Column(String(100))
    qc_created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    assessment = relationship("DoctorAssessment", back_populates="attachments")


class Assignment(Base):
    __tablename__ = "qc_assignments"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_assessment_id = Column(Integer, ForeignKey("qc_doctor_assessments.qc_id"), nullable=False)
    qc_radiologist_id = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=False)
    qc_assigned_by = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=True)
    qc_status = Column(Enum("Pending", "Completed"), nullable=False, server_default=text("'Pending'"))
    qc_assigned_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    qc_completed_at = Column(TIMESTAMP, nullable=True)
    qc_role_id = Column(Integer, ForeignKey("qc_roles.qc_id"), nullable=True)
    qc_review_notes = Column(Text, nullable=True)

    assessment = relationship("DoctorAssessment")
    radiologist = relationship("User", foreign_keys=[qc_radiologist_id])
    assigned_by_user = relationship("User", foreign_keys=[qc_assigned_by])

