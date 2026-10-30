-- Retrospective phase 3: radiologist review, case notes, per-view masks, source paths.
-- Apply to qc_bcd_portal AFTER 20261028_add_retro_intake.sql and 20261029_add_retro_assignments.sql.
-- Only alters/creates qc_retro_* tables created by those two files. Nothing pre-existing is touched.
-- Not idempotent: run once.

-- Safety: make sure these tables are created in the QC schema, never in bcd_application2.
USE qc_bcd_portal;

-- Folder path of each file inside the uploaded case (e.g. DICOM/abc.dcm, redacted_report.pdf)
ALTER TABLE qc_retro_files
  ADD COLUMN qc_source_path VARCHAR(512) NULL AFTER qc_filename;

-- Status values: awaiting | in_progress | with_radiologist | radiologist_in_progress | segmented
-- ('radiologist_in_progress' is 23 chars, so widen from VARCHAR(20))
ALTER TABLE qc_retro_assignments
  MODIFY COLUMN qc_status VARCHAR(30) NOT NULL DEFAULT 'awaiting',
  ADD COLUMN qc_radiologist_id INT NULL AFTER qc_status,
  ADD COLUMN qc_radiologist_assigned_at TIMESTAMP NULL AFTER qc_radiologist_id,
  ADD COLUMN qc_radiologist_started_at TIMESTAMP NULL AFTER qc_radiologist_assigned_at,
  ADD COLUMN qc_radiologist_completed_at TIMESTAMP NULL AFTER qc_radiologist_started_at,
  ADD INDEX ix_retro_assignment_radiologist (qc_radiologist_id),
  ADD CONSTRAINT fk_retro_assign_radiologist FOREIGN KEY (qc_radiologist_id) REFERENCES qc_users (qc_id);

-- One mask per breast view per author role. qc_version stays a case-wide counter, so the
-- existing UNIQUE (qc_case_id, qc_version) still holds.
ALTER TABLE qc_retro_masks
  ADD COLUMN qc_view VARCHAR(5) NULL AFTER qc_version,
  ADD COLUMN qc_role VARCHAR(20) NOT NULL DEFAULT 'mammo_tech' AFTER qc_view;

CREATE TABLE IF NOT EXISTS qc_retro_notes (
  qc_id INT AUTO_INCREMENT PRIMARY KEY,
  qc_case_id INT NOT NULL,
  qc_author_id INT NOT NULL,
  qc_author_role VARCHAR(20) NOT NULL,
  qc_kind VARCHAR(20) NOT NULL DEFAULT 'clinical',  -- clinical | escalation | guidance
  qc_body TEXT NOT NULL,
  qc_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_retro_notes_case (qc_case_id),
  CONSTRAINT fk_retro_note_case FOREIGN KEY (qc_case_id) REFERENCES qc_retro_cases (qc_id) ON DELETE CASCADE,
  CONSTRAINT fk_retro_note_author FOREIGN KEY (qc_author_id) REFERENCES qc_users (qc_id)
);
