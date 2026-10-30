-- Retrospective intake (phase 1). Apply to qc_bcd_portal only. Review before running.
-- Only cases that pass every intake check are stored in qc_retro_cases.

-- Safety: make sure these tables are created in the QC schema, never in bcd_application2.
USE qc_bcd_portal;

CREATE TABLE IF NOT EXISTS qc_retro_batches (
  qc_id INT AUTO_INCREMENT PRIMARY KEY,
  qc_uploaded_by INT NULL,
  qc_source_name VARCHAR(255) NULL,
  qc_vendor VARCHAR(160) NULL,
  qc_status VARCHAR(20) NOT NULL DEFAULT 'uploading',
  qc_phase VARCHAR(120) NULL,
  qc_files_received INT NOT NULL DEFAULT 0,
  qc_bytes_received BIGINT NOT NULL DEFAULT 0,
  qc_total_cases INT NOT NULL DEFAULT 0,
  qc_checked_cases INT NOT NULL DEFAULT 0,
  qc_passed INT NOT NULL DEFAULT 0,
  qc_rejected INT NOT NULL DEFAULT 0,
  qc_deleted INT NOT NULL DEFAULT 0,
  qc_error TEXT NULL,
  qc_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  qc_finished_at TIMESTAMP NULL,
  CONSTRAINT fk_retro_batch_user FOREIGN KEY (qc_uploaded_by) REFERENCES qc_users (qc_id)
);

CREATE TABLE IF NOT EXISTS qc_retro_cases (
  qc_id INT AUTO_INCREMENT PRIMARY KEY,
  qc_case_code VARCHAR(20) NULL UNIQUE,
  qc_session_id VARCHAR(36) NOT NULL UNIQUE,
  qc_content_hash CHAR(64) NOT NULL,
  qc_batch_id INT NOT NULL,
  qc_original_name VARCHAR(255) NOT NULL,
  qc_modality VARCHAR(10) NULL,
  qc_birads VARCHAR(4) NULL,
  qc_density VARCHAR(2) NULL,
  qc_manufacturer VARCHAR(120) NULL,
  qc_vendor VARCHAR(160) NULL,
  qc_report_path VARCHAR(512) NULL,
  qc_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_retro_case_content_hash (qc_content_hash),
  CONSTRAINT fk_retro_case_batch FOREIGN KEY (qc_batch_id) REFERENCES qc_retro_batches (qc_id)
);

CREATE TABLE IF NOT EXISTS qc_retro_files (
  qc_id INT AUTO_INCREMENT PRIMARY KEY,
  qc_case_id INT NOT NULL,
  qc_kind VARCHAR(10) NOT NULL,
  qc_view VARCHAR(5) NULL,
  qc_filename VARCHAR(255) NOT NULL,
  qc_gcs_path VARCHAR(512) NOT NULL,
  qc_size_bytes BIGINT NOT NULL DEFAULT 0,
  qc_sha256 CHAR(64) NULL,
  qc_dicom_headers JSON NULL,
  INDEX ix_retro_files_case (qc_case_id),
  CONSTRAINT fk_retro_file_case FOREIGN KEY (qc_case_id) REFERENCES qc_retro_cases (qc_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS qc_retro_rejections (
  qc_id INT AUTO_INCREMENT PRIMARY KEY,
  qc_batch_id INT NOT NULL,
  qc_original_name VARCHAR(255) NOT NULL,
  qc_outcome VARCHAR(10) NOT NULL,
  qc_reasons JSON NOT NULL,
  qc_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_retro_rej_batch (qc_batch_id),
  CONSTRAINT fk_retro_rej_batch FOREIGN KEY (qc_batch_id) REFERENCES qc_retro_batches (qc_id)
);
