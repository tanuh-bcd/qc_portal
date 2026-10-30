from sqlalchemy import Column, Integer, BigInteger, String, Text, JSON, ForeignKey, TIMESTAMP, text, Index
from sqlalchemy.orm import relationship
from ..db.session import Base


class RetroBatch(Base):
    """One folder/zip upload. Counters feed the live tally."""
    __tablename__ = "qc_retro_batches"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_uploaded_by = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=True)
    qc_source_name = Column(String(255), nullable=True)
    qc_vendor = Column(String(160), nullable=True)  # organisation supplying this upload
    # uploading -> processing -> completed | failed
    qc_status = Column(String(20), nullable=False, server_default=text("'uploading'"))
    qc_phase = Column(String(120), nullable=True)
    qc_files_received = Column(Integer, nullable=False, server_default=text("0"))
    qc_bytes_received = Column(BigInteger, nullable=False, server_default=text("0"))
    qc_total_cases = Column(Integer, nullable=False, server_default=text("0"))
    qc_checked_cases = Column(Integer, nullable=False, server_default=text("0"))
    qc_passed = Column(Integer, nullable=False, server_default=text("0"))
    qc_rejected = Column(Integer, nullable=False, server_default=text("0"))
    qc_deleted = Column(Integer, nullable=False, server_default=text("0"))
    qc_error = Column(Text, nullable=True)
    qc_created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    qc_finished_at = Column(TIMESTAMP, nullable=True)


class RetroCase(Base):
    """A retrospective case that passed every intake check (and only those)."""
    __tablename__ = "qc_retro_cases"
    __table_args__ = (
        Index("uq_retro_case_content_hash", "qc_content_hash", unique=True),
    )

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_case_code = Column(String(20), unique=True, nullable=True)  # case_00001
    qc_session_id = Column(String(36), unique=True, nullable=False)
    # sha256 over the sorted sha256 of the four views; blocks the same images
    # from being stored under two case ids.
    qc_content_hash = Column(String(64), nullable=False)
    qc_batch_id = Column(Integer, ForeignKey("qc_retro_batches.qc_id"), nullable=False)
    qc_original_name = Column(String(255), nullable=False)
    qc_modality = Column(String(10), nullable=True)
    qc_birads = Column(String(4), nullable=True)
    qc_density = Column(String(2), nullable=True)
    qc_manufacturer = Column(String(120), nullable=True)
    qc_vendor = Column(String(160), nullable=True)  # organisation that supplied the data
    qc_report_path = Column(String(512), nullable=True)
    qc_created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    files = relationship("RetroFile", back_populates="case", cascade="all, delete-orphan")


class RetroFile(Base):
    __tablename__ = "qc_retro_files"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_case_id = Column(Integer, ForeignKey("qc_retro_cases.qc_id"), nullable=False, index=True)
    qc_kind = Column(String(10), nullable=False)  # view | report
    qc_view = Column(String(5), nullable=True)  # LCC LMLO RCC RMLO
    qc_filename = Column(String(255), nullable=False)
    qc_source_path = Column(String(512), nullable=True)  # path inside the uploaded case folder
    qc_gcs_path = Column(String(512), nullable=False)
    qc_size_bytes = Column(BigInteger, nullable=False, server_default=text("0"))
    qc_sha256 = Column(String(64), nullable=True)
    qc_dicom_headers = Column(JSON, nullable=True)

    case = relationship("RetroCase", back_populates="files")


class RetroRejection(Base):
    """Audit row for every case that did not pass. No files are kept."""
    __tablename__ = "qc_retro_rejections"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_batch_id = Column(Integer, ForeignKey("qc_retro_batches.qc_id"), nullable=False, index=True)
    qc_original_name = Column(String(255), nullable=False)
    # rejected = ineligible content (not DR, BI-RADS outside 3-6, duplicate)
    # deleted  = structurally unusable (missing view, bad/unreadable report or DICOM)
    qc_outcome = Column(String(10), nullable=False)
    qc_reasons = Column(JSON, nullable=False)
    qc_created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))


# Status values stored on RetroAssignment. "Unassigned" is the absence of a row.
ASSIGN_AWAITING = "awaiting"            # assigned, mammo tech has not opened it
ASSIGN_IN_PROGRESS = "in_progress"      # mammo tech is segmenting
ASSIGN_WITH_RADIOLOGIST = "with_radiologist"  # mammo tech is unsure; waiting for the radiologist
ASSIGN_RADIOLOGIST_IN_PROGRESS = "radiologist_in_progress"  # radiologist has opened it
ASSIGN_SEGMENTED = "segmented"          # mask uploaded and confirmed
ASSIGN_REJECTED = "rejected"            # radiologist found no lesion; admin only, never returns to the Mammo Tech


class RetroAssignment(Base):
    """One row per case once an admin assigns it to a Mammo Tech."""
    __tablename__ = "qc_retro_assignments"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_case_id = Column(Integer, ForeignKey("qc_retro_cases.qc_id"), nullable=False, unique=True)
    qc_mammo_tech_id = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=False, index=True)
    qc_assigned_by = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=True)
    qc_status = Column(String(30), nullable=False, server_default=text("'awaiting'"))
    qc_radiologist_id = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=True, index=True)
    qc_radiologist_assigned_at = Column(TIMESTAMP, nullable=True)
    qc_radiologist_started_at = Column(TIMESTAMP, nullable=True)
    qc_radiologist_completed_at = Column(TIMESTAMP, nullable=True)
    qc_assigned_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    qc_started_at = Column(TIMESTAMP, nullable=True)
    qc_escalated_at = Column(TIMESTAMP, nullable=True)
    qc_escalation_note = Column(Text, nullable=True)
    qc_completed_at = Column(TIMESTAMP, nullable=True)
    qc_rejected_at = Column(TIMESTAMP, nullable=True)
    qc_rejected_by = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=True)
    qc_reject_reason = Column(Text, nullable=True)

    case = relationship("RetroCase")


class RetroDeletedCase(Base):
    """Kept after an admin deletes a case: feeds the dashboard counts and blocks re-uploading the same images."""
    __tablename__ = "qc_retro_deleted_cases"

    qc_id = Column(Integer, primary_key=True)
    qc_case_id = Column(Integer, nullable=False, unique=True)
    qc_case_code = Column(String(20), nullable=True)
    qc_session_id = Column(String(36), nullable=True)
    qc_content_hash = Column(String(64), nullable=False, index=True)
    qc_original_name = Column(String(255), nullable=True)
    qc_modality = Column(String(10), nullable=True)
    qc_birads = Column(String(4), nullable=True)
    qc_density = Column(String(2), nullable=True)
    qc_manufacturer = Column(String(120), nullable=True)
    qc_vendor = Column(String(160), nullable=True)
    qc_batch_id = Column(Integer, nullable=True)
    qc_mammo_tech_id = Column(Integer, nullable=True)
    qc_final_status = Column(String(30), nullable=False, index=True)
    qc_reason = Column(Text, nullable=True)
    qc_rejected_by = Column(Integer, nullable=True)
    qc_rejected_at = Column(TIMESTAMP, nullable=True)
    qc_uploaded_at = Column(TIMESTAMP, nullable=True)
    qc_deleted_by = Column(Integer, nullable=True)
    qc_deleted_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))


class RetroMask(Base):
    """Segmentation mask (.nii.gz) uploaded by a Mammo Tech. Versions are kept."""
    __tablename__ = "qc_retro_masks"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_case_id = Column(Integer, ForeignKey("qc_retro_cases.qc_id"), nullable=False, index=True)
    qc_version = Column(Integer, nullable=False, server_default=text("1"))  # case-wide counter
    qc_view = Column(String(5), nullable=True)  # LCC LMLO RCC RMLO
    qc_role = Column(String(20), nullable=False, server_default=text("'mammo_tech'"))  # mammo_tech | radiologist
    qc_filename = Column(String(255), nullable=False)
    qc_gcs_path = Column(String(512), nullable=False)
    qc_size_bytes = Column(BigInteger, nullable=False, server_default=text("0"))
    qc_uploaded_by = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=False)
    qc_uploaded_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))


class RetroMark(Base):
    """Free-hand marks on one view. Never edited in place: a new save or a clear stamps qc_removed_at."""
    __tablename__ = "qc_retro_marks"

    qc_id = Column(Integer, primary_key=True)
    qc_case_id = Column(Integer, ForeignKey("qc_retro_cases.qc_id"), nullable=False, index=True)
    qc_view = Column(String(5), nullable=False)
    qc_author_id = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=False)
    qc_author_role = Column(String(20), nullable=False)
    qc_author_name = Column(String(160), nullable=True)
    qc_shapes = Column(JSON, nullable=False)
    qc_created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    qc_removed_at = Column(TIMESTAMP, nullable=True)
    qc_removed_by = Column(Integer, nullable=True)


class RetroNote(Base):
    """Free-text thread on a case: Mammo Tech doubts, Radiologist clinical notes and guidance."""
    __tablename__ = "qc_retro_notes"

    qc_id = Column(Integer, primary_key=True, index=True)
    qc_case_id = Column(Integer, ForeignKey("qc_retro_cases.qc_id"), nullable=False, index=True)
    qc_author_id = Column(Integer, ForeignKey("qc_users.qc_id"), nullable=False)
    qc_author_role = Column(String(20), nullable=False)  # mammo_tech | radiologist
    qc_kind = Column(String(20), nullable=False, server_default=text("'clinical'"))  # clinical | escalation | guidance
    qc_body = Column(Text, nullable=False)
    qc_created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
