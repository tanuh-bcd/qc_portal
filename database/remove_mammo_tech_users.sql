-- Remove (or switch off) Mammo Tech accounts in the QC portal. Run by hand, step by step. Nothing else is touched.
--
-- 1. Put the email addresses to remove in the list below (Mammo Tech accounts only; other roles are ignored).
-- 2. Run STEP 1 and read it: it shows each account and how much work is linked to it.
-- 3. Prefer STEP 2 (switch off): the person can no longer log in, and every case, mask and note stays correct.
-- 4. STEP 3 (delete) removes only accounts with NO linked work at all; the rest are listed and left in place.

USE qc_bcd_portal;

CREATE TEMPORARY TABLE tmp_remove_emails (email VARCHAR(255) PRIMARY KEY);
INSERT INTO tmp_remove_emails (email) VALUES
  ('first.person@example.com'),
  ('second.person@example.com');

CREATE TEMPORARY TABLE tmp_remove_users AS
SELECT u.qc_id, u.qc_email, u.qc_full_name, u.qc_is_active
FROM qc_users u
JOIN qc_roles r ON r.qc_id = u.qc_role_id AND r.qc_name = 'Mammo Tech'
JOIN tmp_remove_emails e ON e.email = u.qc_email;

-- STEP 1: who matched, and how much work is linked to each (read only)
SELECT u.qc_id, u.qc_email, u.qc_full_name, u.qc_is_active,
  (SELECT COUNT(*) FROM qc_retro_assignments a WHERE a.qc_mammo_tech_id = u.qc_id OR a.qc_assigned_by = u.qc_id
     OR a.qc_radiologist_id = u.qc_id OR a.qc_rejected_by = u.qc_id) AS retro_cases,
  (SELECT COUNT(*) FROM qc_retro_masks m WHERE m.qc_uploaded_by = u.qc_id) AS retro_masks,
  (SELECT COUNT(*) FROM qc_retro_notes n WHERE n.qc_author_id = u.qc_id) AS retro_notes,
  (SELECT COUNT(*) FROM qc_retro_marks k WHERE k.qc_author_id = u.qc_id) AS retro_marks,
  (SELECT COUNT(*) FROM qc_retro_batches b WHERE b.qc_uploaded_by = u.qc_id) AS retro_uploads,
  (SELECT COUNT(*) FROM qc_assignments q WHERE q.qc_mammo_tech_id = u.qc_id OR q.qc_assigned_by = u.qc_id OR q.qc_radiologist_id = u.qc_id) AS old_flow_assignments,
  (SELECT COUNT(*) FROM qc_doctor_assessments d WHERE d.qc_doctor_id = u.qc_id) AS assessments,
  (SELECT COUNT(*) FROM qc_pending_case_reminders p WHERE p.qc_user_id = u.qc_id) AS reminders
FROM tmp_remove_users u ORDER BY u.qc_email;

-- Emails in your list that did NOT match a Mammo Tech account (typo, or a different role):
SELECT e.email AS not_found FROM tmp_remove_emails e LEFT JOIN tmp_remove_users u ON u.qc_email = e.email WHERE u.qc_id IS NULL;

-- STEP 2 (recommended): switch the accounts off. They cannot log in, and nothing else changes.
-- UPDATE qc_users SET qc_is_active = 0 WHERE qc_id IN (SELECT qc_id FROM tmp_remove_users);

-- STEP 3 (only if you really want them gone): delete accounts that have no linked work at all.
-- Accounts that still have work are NOT deleted; STEP 1 shows which ones they are.
-- START TRANSACTION;
-- DELETE FROM qc_users WHERE qc_id IN (SELECT qc_id FROM tmp_remove_users)
--   AND qc_id NOT IN (SELECT qc_mammo_tech_id FROM qc_retro_assignments)
--   AND qc_id NOT IN (SELECT qc_assigned_by FROM qc_retro_assignments WHERE qc_assigned_by IS NOT NULL)
--   AND qc_id NOT IN (SELECT qc_radiologist_id FROM qc_retro_assignments WHERE qc_radiologist_id IS NOT NULL)
--   AND qc_id NOT IN (SELECT qc_rejected_by FROM qc_retro_assignments WHERE qc_rejected_by IS NOT NULL)
--   AND qc_id NOT IN (SELECT qc_uploaded_by FROM qc_retro_masks)
--   AND qc_id NOT IN (SELECT qc_author_id FROM qc_retro_notes)
--   AND qc_id NOT IN (SELECT qc_author_id FROM qc_retro_marks)
--   AND qc_id NOT IN (SELECT qc_uploaded_by FROM qc_retro_batches WHERE qc_uploaded_by IS NOT NULL)
--   AND qc_id NOT IN (SELECT qc_mammo_tech_id FROM qc_assignments WHERE qc_mammo_tech_id IS NOT NULL)
--   AND qc_id NOT IN (SELECT qc_assigned_by FROM qc_assignments WHERE qc_assigned_by IS NOT NULL)
--   AND qc_id NOT IN (SELECT qc_radiologist_id FROM qc_assignments WHERE qc_radiologist_id IS NOT NULL)
--   AND qc_id NOT IN (SELECT qc_doctor_id FROM qc_doctor_assessments WHERE qc_doctor_id IS NOT NULL)
--   AND qc_id NOT IN (SELECT qc_user_id FROM qc_pending_case_reminders WHERE qc_user_id IS NOT NULL);
-- SELECT ROW_COUNT() AS deleted_accounts;
-- COMMIT;     -- or ROLLBACK;
