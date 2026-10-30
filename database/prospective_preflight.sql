-- Prospective study: READ-ONLY checks to run before the master CSVs are built, and the grants for a read-only build account.
-- Nothing here changes data. Run each block on the database named in its heading (the database name is also written in the queries).
-- Names follow the master CSV specification. If a query fails with "unknown column/table", send me the message: the spec and the
-- real schema differ there, and that is exactly what this file is meant to find out.

-- ===== A. Do the tables and columns the build needs exist? (should list every row; anything missing is a problem) =====
SELECT table_schema, table_name, column_name FROM information_schema.columns
WHERE (table_schema = 'bcd_questionnaire' AND table_name = 'session_table'
         AND column_name IN ('session_id','session_start_time','session_end_time','questionnaire_version','consent_url','snehita_lifetime_risk','risk_category'))
   OR (table_schema = 'bcd_questionnaire' AND table_name = 'session_data_table'
         AND column_name IN ('session_id','question_key','question','answer','created_at'))
   OR (table_schema = 'bcd_application2' AND table_name = 'hospitals' AND column_name IN ('id','name','short_name','state','type'))
   OR (table_schema = 'bcd_application2' AND table_name = 'machines' AND column_name IN ('hospital_id','machine','make','technology','no_of_machines'))
   OR (table_schema = 'bcd_application2' AND table_name = 'doctor_assessments'
         AND column_name IN ('id','patient_session_id','doctor_id','mammo_birads','mammo_density','us_biopsy_birads','us_biopsy_density','clinical_findings','created_at'))
   OR (table_schema = 'bcd_application2' AND table_name = 'attachments' AND column_name IN ('id','assessment_id','file_type','file_name','storage_url','mime_type','created_at'))
   OR (table_schema = 'pilot_deployment' AND table_name = 'patient_details' AND column_name IN ('session_id','institute','subject_id','age','height_cm','weight_kg','tobacco_use','alcohol_use','created_at'))
   OR (table_schema = 'pilot_deployment' AND table_name = 'pilot_questionnaire' AND column_name IN ('session_id','question_key','question','answer'))
   OR (table_schema = 'pilot_deployment' AND table_name = 'pilot_result' AND column_name IN ('session_id','risk_class','risk_score','recommendation','model_version','created_at'))
   OR (table_schema = 'pilot_deployment' AND table_name = 'subjects' AND column_name IN ('institute','subject_id','source','pilot_session_id','data_collection_session_id'))
ORDER BY table_schema, table_name, column_name;

-- ===== B. Row counts: these should match the counts in the finished CSV (spec section 9) =====
SELECT 'all sessions (bcd_questionnaire.session_table)' AS what, COUNT(*) AS n FROM bcd_questionnaire.session_table
UNION ALL SELECT 'pilot sessions (patient_details)', COUNT(*) FROM pilot_deployment.patient_details
UNION ALL SELECT 'sessions with a clinician assessment', COUNT(DISTINCT patient_session_id) FROM bcd_application2.doctor_assessments
UNION ALL SELECT 'attachments (files)', COUNT(*) FROM bcd_application2.attachments
UNION ALL SELECT 'hospitals', COUNT(*) FROM bcd_application2.hospitals
UNION ALL SELECT 'machines', COUNT(*) FROM bcd_application2.machines;

-- ===== C. Things the spec warns about =====
-- C1. Sessions that have more than one assessment (the build uses the latest and flags it)
SELECT patient_session_id, COUNT(*) AS n_assessments FROM bcd_application2.doctor_assessments
GROUP BY patient_session_id HAVING COUNT(*) > 1 ORDER BY n_assessments DESC LIMIT 50;

-- C2. File types in use (the spec lists the known ones; anything else lands in "other files" and must be reviewed)
SELECT file_type, COUNT(*) AS n FROM bcd_application2.attachments GROUP BY file_type ORDER BY n DESC;

-- C3. CR / DR: the exact technology values per hospital (how the CR/DR filter will be decided)
SELECT h.id AS hospital_id, h.name, m.machine, m.make, m.technology, m.no_of_machines
FROM bcd_application2.hospitals h LEFT JOIN bcd_application2.machines m ON m.hospital_id = h.id
ORDER BY h.id, m.technology;

-- C4. Hospitals with more than one technology (CR and DR at the same site would need a per-exam value)
SELECT hospital_id, GROUP_CONCAT(DISTINCT technology) AS technologies, COUNT(DISTINCT technology) AS kinds
FROM bcd_application2.machines GROUP BY hospital_id HAVING COUNT(DISTINCT technology) > 1;

-- C5. BI-RADS and density values outside the allowed ones (should return no rows).
-- The columns are ENUMs, so they are compared as text; comparing an ENUM with numbers uses its position and gives false alarms.
SELECT id, patient_session_id, mammo_birads, us_biopsy_birads, mammo_density, us_biopsy_density
FROM bcd_application2.doctor_assessments
WHERE CAST(mammo_birads AS CHAR) NOT IN ('0','1','2','3','4','5','6') OR CAST(us_biopsy_birads AS CHAR) NOT IN ('0','1','2','3','4','5','6')
   OR CAST(mammo_density AS CHAR) NOT IN ('A','B','C','D') OR CAST(us_biopsy_density AS CHAR) NOT IN ('A','B','C','D') LIMIT 50;

-- C6. Pilot subject IDs typed at more than one session (expected; the build links them by hospital + ID)
SELECT institute, subject_id, COUNT(*) AS sessions FROM pilot_deployment.patient_details
GROUP BY institute, subject_id HAVING COUNT(*) > 1 ORDER BY sessions DESC LIMIT 50;

-- C7. Test data to mark (the spec: hospitals named Test or Tanuh Foundation, institute E2E-TEST). Two separate queries,
-- because the two databases use different text collations and cannot be combined with UNION.
SELECT id, name FROM bcd_application2.hospitals WHERE name LIKE '%Test%' OR name LIKE '%Tanuh%';
SELECT institute, COUNT(*) AS sessions FROM pilot_deployment.patient_details WHERE institute LIKE '%TEST%' GROUP BY institute;

-- ===== D. A read-only account for the build (run as an administrator; choose your own password) =====
-- Column-level grants mean the account can only ever see the columns the build needs: no IP addresses, no passwords.
-- CREATE USER 'prospective_build'@'%' IDENTIFIED BY 'CHOOSE-A-STRONG-PASSWORD';
-- GRANT SELECT (session_id, session_start_time, session_end_time, questionnaire_version, consent_url, snehita_lifetime_risk, risk_category)
--   ON bcd_questionnaire.session_table TO 'prospective_build'@'%';
-- GRANT SELECT (session_id, question_key, question, answer, created_at) ON bcd_questionnaire.session_data_table TO 'prospective_build'@'%';
-- GRANT SELECT (id, name, short_name, state, type) ON bcd_application2.hospitals TO 'prospective_build'@'%';
-- GRANT SELECT (id, hospital_id, machine, make, technology, no_of_machines) ON bcd_application2.machines TO 'prospective_build'@'%';
-- GRANT SELECT ON bcd_application2.doctor_assessments TO 'prospective_build'@'%';
-- GRANT SELECT (id, assessment_id, file_type, file_name, storage_url, mime_type, created_at) ON bcd_application2.attachments TO 'prospective_build'@'%';
-- GRANT SELECT (id, role_id) ON bcd_application2.users TO 'prospective_build'@'%';
-- GRANT SELECT (id, name) ON bcd_application2.roles TO 'prospective_build'@'%';
-- GRANT SELECT ON pilot_deployment.patient_details TO 'prospective_build'@'%';
-- GRANT SELECT ON pilot_deployment.pilot_questionnaire TO 'prospective_build'@'%';
-- GRANT SELECT ON pilot_deployment.pilot_result TO 'prospective_build'@'%';
-- GRANT SELECT ON pilot_deployment.subjects TO 'prospective_build'@'%';
