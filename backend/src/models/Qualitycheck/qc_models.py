from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, TIMESTAMP, Enum
from sqlalchemy.orm import declarative_base, relationship
import enum

QcBase = declarative_base()

class QcRole(QcBase):
    __tablename__ = "qc_roles"

    qc_id = Column(Integer, primary_key=True, autoincrement=True)
    qc_name = Column(String(50), unique=True, nullable=False)

class QcHospital(QcBase):
    __tablename__ = "qc_hospitals"

    qc_id = Column(String(20), primary_key=True)
    qc_name = Column(String(255), nullable=False)
    qc_short_name = Column(String(50), nullable=True)  

class QcUser(QcBase):
    __tablename__ = "qc_users"

    qc_id = Column(Integer, primary_key=True, autoincrement=True)
    qc_role_id = Column(Integer, ForeignKey("qc_roles.qc_id"), nullable=True)
    qc_email = Column(String(255), nullable=False)
    qc_password_hash = Column(String(255), nullable=False)
    qc_full_name = Column(String(255), nullable=True)
    qc_is_active = Column(Boolean, default=True)
    qc_hospital_id = Column(String(20), ForeignKey("qc_hospitals.qc_id"), nullable=True)
    qc_assigned = Column(Boolean, nullable=False, default=False)

    role = relationship("QcRole")

class QcDoctorAssessment(QcBase):
    __tablename__ = "qc_doctor_assessments"

    qc_id = Column(Integer, primary_key=True, autoincrement=True)
    qc_sub_ui_id = Column(String(20), nullable=True, unique=True)
    qc_doctor_id = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=False)
    qc_hospital_id = Column(String(20), ForeignKey("qc_hospitals.qc_id"), nullable=True)
    qc_patient_session_id = Column(String(36), nullable=True)
    qc_created_at = Column(TIMESTAMP, nullable=True)

class QcAssignmentStatus(str, enum.Enum):
    pending = "Pending"
    completed = "Completed"


class QcAssignment(QcBase):
    __tablename__ = "qc_assignments"

    qc_id = Column(Integer, primary_key=True, autoincrement=True)
    qc_assessment_id = Column(Integer, ForeignKey("qc_doctor_assessments.qc_id"), nullable=False)
    qc_radiologist_id = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=False)
    qc_role_id = Column(Integer, ForeignKey("qc_roles.qc_id"), nullable=True)
    qc_assigned_by = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=True)
    qc_status = Column(
        Enum(QcAssignmentStatus, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        default=QcAssignmentStatus.pending,
    )
    qc_assigned_at = Column(TIMESTAMP, nullable=True)
    qc_completed_at = Column(TIMESTAMP, nullable=True)