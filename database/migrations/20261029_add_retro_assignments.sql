-- Retrospective assignment + segmentation tracking (phase 2). Apply to qc_bcd_portal only,
-- after 20261028_add_retro_intake.sql. Review before running; nothing here changes existing tables.

-- Safety: make sure these tables are created in the QC schema, never in bcd_application2.
USE qc_bcd_portal;

CREATE TABLE IF NOT EXISTS qc_retro_assignments (
  qc_id INT AUTO_INCREMENT PRIMARY KEY,
  qc_case_id INT NOT NULL,
  qc_mammo_tech_id INT NOT NULL,
  qc_assigned_by INT NULL,
  qc_status VARCHAR(20) NOT NULL DEFAULT 'awaiting',  -- awaiting | in_progress | with_radiologist | segmented
  qc_assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  qc_started_at TIMESTAMP NULL,
  qc_escalated_at TIMESTAMP NULL,
  qc_escalation_note TEXT NULL,
  qc_completed_at TIMESTAMP NULL,
  UNIQUE KEY uq_retro_assignment_case (qc_case_id),
  INDEX ix_retro_assignment_tech (qc_mammo_tech_id),
  CONSTRAINT fk_retro_assign_case FOREIGN KEY (qc_case_id) REFERENCES qc_retro_cases (qc_id) ON DELETE CASCADE,
  CONSTRAINT fk_retro_assign_tech FOREIGN KEY (qc_mammo_tech_id) REFERENCES qc_users (qc_id),
  CONSTRAINT fk_retro_assign_by FOREIGN KEY (qc_assigned_by) REFERENCES qc_users (qc_id)
);

CREATE TABLE IF NOT EXISTS qc_retro_masks (
  qc_id INT AUTO_INCREMENT PRIMARY KEY,
  qc_case_id INT NOT NULL,
  qc_version INT NOT NULL DEFAULT 1,
  qc_filename VARCHAR(255) NOT NULL,
  qc_gcs_path VARCHAR(512) NOT NULL,
  qc_size_bytes BIGINT NOT NULL DEFAULT 0,
  qc_uploaded_by INT NOT NULL,
  qc_uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_retro_masks_case (qc_case_id),
  UNIQUE KEY uq_retro_mask_version (qc_case_id, qc_version),
  CONSTRAINT fk_retro_mask_case FOREIGN KEY (qc_case_id) REFERENCES qc_retro_cases (qc_id) ON DELETE CASCADE,
  CONSTRAINT fk_retro_mask_user FOREIGN KEY (qc_uploaded_by) REFERENCES qc_users (qc_id)
);
