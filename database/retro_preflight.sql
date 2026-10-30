-- READ-ONLY preflight for the retrospective migrations. Changes nothing.
-- Run each numbered query in MySQL Workbench (connected as the user that will run the migrations)
-- and export each result as CSV (or paste it), then send them back.

-- 1. Server version (JSON columns and the FK syntax need MySQL 8 / 5.7+)
SELECT VERSION() AS version, @@sql_mode AS sql_mode, @@foreign_key_checks AS fk_checks;

-- 2. Default charset/collation of the three schemas
SELECT schema_name, default_character_set_name, default_collation_name
FROM information_schema.schemata
WHERE schema_name IN ('qc_bcd_portal', 'qc_retrospective', 'qc_bcd_questionnaire');

-- 3. Anything already called qc_retro_% (must be empty before migration 1)
SELECT table_schema, table_name FROM information_schema.tables WHERE table_name LIKE 'qc_retro\_%';

-- 4. Full table list of qc_bcd_portal (to spot name clashes)
SELECT table_name, engine, table_collation FROM information_schema.tables
WHERE table_schema = 'qc_bcd_portal' ORDER BY table_name;

-- 5. Parent tables the foreign keys point to: type and engine must match (INT / InnoDB)
SELECT table_name, column_name, column_type, is_nullable, column_key
FROM information_schema.columns
WHERE table_schema = 'qc_bcd_portal' AND table_name = 'qc_users' AND column_name = 'qc_id';

-- 6. Privileges of the user you run migrations with, and of the application user
SHOW GRANTS FOR CURRENT_USER();
-- (then, if you know the app user's name:)  SHOW GRANTS FOR 'APP_USER'@'%';

-- 7. Existing users by role, so Mammo Tech / Radiologist accounts exist for assignment
SELECT r.qc_name AS role, COUNT(*) AS active_users
FROM qc_bcd_portal.qc_users u JOIN qc_bcd_portal.qc_roles r ON r.qc_id = u.qc_role_id
WHERE u.qc_is_active = 1 GROUP BY r.qc_name;

-- 8. Size of the existing retrospective inventory (for the "import existing cases?" decision)
SELECT 'cases' AS t, COUNT(*) AS n FROM qc_retrospective.qc_retrospective_cases
UNION ALL SELECT 'files', COUNT(*) FROM qc_retrospective.qc_retrospective_files
UNION ALL SELECT 'batches', COUNT(*) FROM qc_retrospective.qc_retrospective_upload_batches;

SELECT qc_case_status, COUNT(*) AS cases, SUM(qc_report_available) AS with_report, SUM(qc_dicom_count) AS dicom_files
FROM qc_retrospective.qc_retrospective_cases GROUP BY qc_case_status;

-- 9. Is the live app already using a user that can write to qc_bcd_portal? (current database context)
SELECT DATABASE() AS current_db, CURRENT_USER() AS current_user_name;
