-- Remove TEST data created while trying the Retrospective portal. Run by hand, step by step.
-- It only touches rows whose upload batch used the vendor tag below. Nothing else is deleted.
--
-- How to use:
--   1. On the Retrospective upload page, type the vendor name  TEST-DELETE-ME  for every test upload.
--   2. When you are finished testing, run STEP 1 and STEP 2 below and read the results.
--   3. Run the gcloud commands that STEP 2 prints (this removes the test files from the bucket).
--   4. Run STEP 3 (the deletes). It is inside a transaction: check the counts, then COMMIT (or ROLLBACK).

USE qc_bcd_portal;
SET @tag := 'TEST-DELETE-ME';

-- Safety: refuse to run for anything that does not look like a test tag.
SELECT IF(@tag LIKE 'TEST%', 'tag ok', 'STOP: the tag must start with TEST') AS safety_check;

-- STEP 1: what will be removed (read only)
SELECT qc_id AS batch_id, qc_source_name, qc_vendor, qc_status, qc_passed, qc_rejected, qc_created_at
FROM qc_retro_batches WHERE qc_vendor = @tag;

SELECT c.qc_id AS case_id, c.qc_case_code, c.qc_original_name, a.qc_status AS work_status, c.qc_created_at
FROM qc_retro_cases c
JOIN qc_retro_batches b ON b.qc_id = c.qc_batch_id AND b.qc_vendor = @tag
LEFT JOIN qc_retro_assignments a ON a.qc_case_id = c.qc_id
ORDER BY c.qc_id;

-- STEP 2: one line per test case folder, with the bucket each file was really stored in.
-- Copy the printed commands into a terminal where you are signed in to gcloud and run them.
SELECT DISTINCT CONCAT('gcloud storage rm -r ', SUBSTRING_INDEX(f.qc_gcs_path, '/', 5), '/') AS run_this_in_terminal
FROM qc_retro_files f
JOIN qc_retro_cases c ON c.qc_id = f.qc_case_id
JOIN qc_retro_batches b ON b.qc_id = c.qc_batch_id AND b.qc_vendor = @tag
ORDER BY 1;

-- STEP 3: delete the database rows (run only after STEP 1 and 2 look right)
SET SQL_SAFE_UPDATES = 0;   -- Workbench blocks some deletes unless this is off
START TRANSACTION;

CREATE TEMPORARY TABLE tmp_test_batches AS SELECT qc_id FROM qc_retro_batches WHERE qc_vendor = @tag AND @tag LIKE 'TEST%';
CREATE TEMPORARY TABLE tmp_test_cases AS SELECT qc_id FROM qc_retro_cases WHERE qc_batch_id IN (SELECT qc_id FROM tmp_test_batches);

DELETE FROM qc_retro_marks       WHERE qc_case_id IN (SELECT qc_id FROM tmp_test_cases);
DELETE FROM qc_retro_notes       WHERE qc_case_id IN (SELECT qc_id FROM tmp_test_cases);
DELETE FROM qc_retro_masks       WHERE qc_case_id IN (SELECT qc_id FROM tmp_test_cases);
DELETE FROM qc_retro_assignments WHERE qc_case_id IN (SELECT qc_id FROM tmp_test_cases);
DELETE FROM qc_retro_files       WHERE qc_case_id IN (SELECT qc_id FROM tmp_test_cases);
DELETE FROM qc_retro_deleted_cases WHERE qc_case_id IN (SELECT qc_id FROM tmp_test_cases) OR qc_batch_id IN (SELECT qc_id FROM tmp_test_batches);
DELETE FROM qc_retro_cases       WHERE qc_id IN (SELECT qc_id FROM tmp_test_cases);
DELETE FROM qc_retro_rejections  WHERE qc_batch_id IN (SELECT qc_id FROM tmp_test_batches);
DELETE FROM qc_retro_batches     WHERE qc_id IN (SELECT qc_id FROM tmp_test_batches);

-- Check: all three should be 0 before you COMMIT
SELECT (SELECT COUNT(*) FROM qc_retro_batches WHERE qc_vendor = @tag) AS batches_left,
       (SELECT COUNT(*) FROM qc_retro_cases c WHERE c.qc_batch_id IN (SELECT qc_id FROM tmp_test_batches)) AS cases_left,
       (SELECT COUNT(*) FROM qc_retro_files f WHERE f.qc_case_id IN (SELECT qc_id FROM tmp_test_cases)) AS files_left;

-- COMMIT;     -- run this line if the numbers above are 0
-- ROLLBACK;   -- or this one to undo everything
