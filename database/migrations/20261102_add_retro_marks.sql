-- Retrospective phase 5: free-hand marks (circles, arrows, pen strokes) drawn on a view by the Mammo Tech or Radiologist.
-- Apply AFTER 20261101. Creates one new table; nothing pre-existing is touched. Run once, whole file.

USE qc_bcd_portal;

-- Each save of a person's marks on one view is one row. Saving again, or the other role clearing them,
-- stamps qc_removed_at instead of deleting, so the admin keeps the history. Rows with qc_removed_at NULL are live.
CREATE TABLE IF NOT EXISTS qc_retro_marks (
  qc_id INT AUTO_INCREMENT PRIMARY KEY,
  qc_case_id INT NOT NULL,
  qc_view VARCHAR(5) NOT NULL,                -- LCC LMLO RCC RMLO
  qc_author_id INT NOT NULL,
  qc_author_role VARCHAR(20) NOT NULL,        -- mammo_tech | radiologist
  qc_author_name VARCHAR(160) NULL,           -- kept so the name survives even if the user is later renamed
  qc_shapes JSON NOT NULL,                    -- [{type: pen|circle|arrow, color, width, pts|box}] in image pixels
  qc_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  qc_removed_at TIMESTAMP NULL,
  qc_removed_by INT NULL,
  INDEX ix_retro_marks_case (qc_case_id, qc_view),
  CONSTRAINT fk_retro_mark_case FOREIGN KEY (qc_case_id) REFERENCES qc_retro_cases (qc_id) ON DELETE CASCADE,
  CONSTRAINT fk_retro_mark_author FOREIGN KEY (qc_author_id) REFERENCES qc_users (qc_id)
);
