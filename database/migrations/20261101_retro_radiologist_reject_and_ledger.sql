-- Retrospective phase 4: Radiologist can reject a case (no lesion); Admin can delete rejected cases
-- while the dashboard counts survive. Apply AFTER 20261028 .. 20261031. Run once, whole file.
-- Only alters qc_retro_assignments and creates one new table. Nothing pre-existing is touched.

USE qc_bcd_portal;

-- Status value 'rejected' needs no schema change (qc_status is VARCHAR(30)).
ALTER TABLE qc_retro_assignments
  ADD COLUMN qc_rejected_at TIMESTAMP NULL AFTER qc_completed_at,
  ADD COLUMN qc_rejected_by INT NULL AFTER qc_rejected_at,
  ADD COLUMN qc_reject_reason TEXT NULL AFTER qc_rejected_by,
  ADD CONSTRAINT fk_retro_assign_rejecter FOREIGN KEY (qc_rejected_by) REFERENCES qc_users (qc_id);

-- One row per case an admin deleted. The files and the case rows are gone; this row keeps the
-- counts (dashboard) and the content hash (so the same images cannot be uploaded again).
CREATE TABLE IF NOT EXISTS qc_retro_deleted_cases (
  qc_id INT AUTO_INCREMENT PRIMARY KEY,
  qc_case_id INT NOT NULL,                    -- id the case had; never reused (auto-increment)
  qc_case_code VARCHAR(20) NULL,
  qc_session_id VARCHAR(36) NULL,
  qc_content_hash VARCHAR(64) NOT NULL,
  qc_original_name VARCHAR(255) NULL,
  qc_modality VARCHAR(10) NULL,
  qc_birads VARCHAR(4) NULL,
  qc_density VARCHAR(2) NULL,
  qc_manufacturer VARCHAR(120) NULL,
  qc_vendor VARCHAR(160) NULL,
  qc_batch_id INT NULL,
  qc_mammo_tech_id INT NULL,
  qc_final_status VARCHAR(30) NOT NULL,       -- status when deleted, e.g. 'rejected'
  qc_reason TEXT NULL,
  qc_rejected_by INT NULL,
  qc_rejected_at TIMESTAMP NULL,
  qc_uploaded_at TIMESTAMP NULL,
  qc_deleted_by INT NULL,
  qc_deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_retro_deleted_case_id (qc_case_id),
  INDEX ix_retro_deleted_hash (qc_content_hash),
  INDEX ix_retro_deleted_status (qc_final_status)
);
