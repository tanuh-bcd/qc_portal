-- =============================================================================
-- QC Sync EVENT: runs every 5 minutes, syncing BCD → QC.
--
-- Usage:
--   mysql -h 35.234.220.201 -u read_user -p < qc_sync_event.sql
--
-- Prerequisites:
--   1. event_scheduler flag must be ON (Cloud SQL Console → Flags)
--   2. Run qc_sync_catchup.sql FIRST for the initial data migration
--
-- To check status:
--   SELECT EVENT_NAME, STATUS, LAST_EXECUTED
--   FROM information_schema.EVENTS
--   WHERE EVENT_SCHEMA = 'qc_bcd_portal';
--
-- To stop:   ALTER EVENT qc_bcd_portal.qc_sync_from_bcd DISABLE;
-- To start:  ALTER EVENT qc_bcd_portal.qc_sync_from_bcd ENABLE;
-- To remove: DROP EVENT IF EXISTS qc_bcd_portal.qc_sync_from_bcd;
-- =============================================================================

USE qc_bcd_portal;

DROP EVENT IF EXISTS qc_sync_from_bcd;

DELIMITER $$

CREATE EVENT qc_sync_from_bcd
ON SCHEDULE EVERY 5 MINUTE
STARTS CURRENT_TIMESTAMP
COMMENT 'Syncs BCD portal data into QC databases every 5 minutes (17 tables)'
DO
BEGIN
    SET FOREIGN_KEY_CHECKS = 0;

    -- ----- qc_bcd_portal tables (from bcd_application2) -----

    -- hospitals
    INSERT INTO qc_bcd_portal.qc_hospitals
        (qc_id, qc_name, qc_short_name, qc_contact_person, qc_email,
         qc_address, qc_created_at, qc_pincode, qc_state, qc_type)
    SELECT id, name, short_name, contact_person, email,
           address, created_at, pincode, state, type
    FROM bcd_application2.hospitals
    ON DUPLICATE KEY UPDATE
        qc_name = VALUES(qc_name),
        qc_short_name = VALUES(qc_short_name),
        qc_contact_person = VALUES(qc_contact_person),
        qc_email = VALUES(qc_email),
        qc_address = VALUES(qc_address),
        qc_pincode = VALUES(qc_pincode),
        qc_state = VALUES(qc_state),
        qc_type = VALUES(qc_type);

    -- roles
    INSERT INTO qc_bcd_portal.qc_roles (qc_id, qc_name)
    SELECT id, name FROM bcd_application2.roles
    ON DUPLICATE KEY UPDATE qc_name = VALUES(qc_name);

    -- users (preserves qc_assigned)
    INSERT INTO qc_bcd_portal.qc_users
        (qc_id, qc_role_id, qc_email, qc_password_hash,
         qc_full_name, qc_is_active, qc_hospital_id)
    SELECT id, role_id, email, password_hash,
           full_name, is_active, hospital_id
    FROM bcd_application2.users
    ON DUPLICATE KEY UPDATE
        qc_role_id = VALUES(qc_role_id),
        qc_email = VALUES(qc_email),
        qc_password_hash = VALUES(qc_password_hash),
        qc_full_name = VALUES(qc_full_name),
        qc_is_active = VALUES(qc_is_active),
        qc_hospital_id = VALUES(qc_hospital_id);

    -- machines
    INSERT INTO qc_bcd_portal.qc_machines
        (qc_id, qc_hospital_id, qc_hospital_short_name,
         qc_machine, qc_make, qc_technology, qc_no_of_machines)
    SELECT id, hospital_id, hospital_short_name,
           machine, make, technology, no_of_machines
    FROM bcd_application2.machines
    ON DUPLICATE KEY UPDATE
        qc_hospital_id = VALUES(qc_hospital_id),
        qc_hospital_short_name = VALUES(qc_hospital_short_name),
        qc_machine = VALUES(qc_machine),
        qc_make = VALUES(qc_make),
        qc_technology = VALUES(qc_technology),
        qc_no_of_machines = VALUES(qc_no_of_machines);

    -- languages
    INSERT INTO qc_bcd_portal.qc_languages (qc_code, qc_name)
    SELECT code, name FROM bcd_application2.languages
    ON DUPLICATE KEY UPDATE qc_name = VALUES(qc_name);

    -- questions
    INSERT INTO qc_bcd_portal.qc_questions
        (qc_id, qc_section, qc_question, qc_option, qc_response_type,
         qc_input_type, qc_is_required, qc_min_value, qc_max_value,
         qc_step_value, qc_placeholder, qc_video_url,
         qc_other_option_id, qc_other_placeholder,
         qc_parent_question_id, qc_trigger_answer)
    SELECT id, section, question, `option`, response_type,
           input_type, is_required, min_value, max_value,
           step_value, placeholder, video_url,
           other_option_id, other_placeholder,
           parent_question_id, trigger_answer
    FROM bcd_application2.questions
    ON DUPLICATE KEY UPDATE
        qc_section = VALUES(qc_section),
        qc_question = VALUES(qc_question),
        qc_option = VALUES(qc_option),
        qc_response_type = VALUES(qc_response_type),
        qc_input_type = VALUES(qc_input_type),
        qc_is_required = VALUES(qc_is_required),
        qc_min_value = VALUES(qc_min_value),
        qc_max_value = VALUES(qc_max_value),
        qc_step_value = VALUES(qc_step_value),
        qc_placeholder = VALUES(qc_placeholder),
        qc_video_url = VALUES(qc_video_url),
        qc_other_option_id = VALUES(qc_other_option_id),
        qc_other_placeholder = VALUES(qc_other_placeholder),
        qc_parent_question_id = VALUES(qc_parent_question_id),
        qc_trigger_answer = VALUES(qc_trigger_answer);

    -- question_options
    INSERT INTO qc_bcd_portal.qc_question_options
        (qc_id, qc_question_id, qc_option_value, qc_sort_order)
    SELECT id, question_id, option_value, sort_order
    FROM bcd_application2.question_options
    ON DUPLICATE KEY UPDATE
        qc_question_id = VALUES(qc_question_id),
        qc_option_value = VALUES(qc_option_value),
        qc_sort_order = VALUES(qc_sort_order);

    -- question_translations
    INSERT INTO qc_bcd_portal.qc_question_translations
        (qc_id, qc_question_id, qc_language_code, qc_question_text)
    SELECT id, question_id, language_code, question_text
    FROM bcd_application2.question_translations
    ON DUPLICATE KEY UPDATE
        qc_question_id = VALUES(qc_question_id),
        qc_language_code = VALUES(qc_language_code),
        qc_question_text = VALUES(qc_question_text);

    -- question_option_translations
    INSERT INTO qc_bcd_portal.qc_question_option_translations
        (qc_id, qc_option_id, qc_language_code, qc_option_label)
    SELECT id, option_id, language_code, option_label
    FROM bcd_application2.question_option_translations
    ON DUPLICATE KEY UPDATE
        qc_option_id = VALUES(qc_option_id),
        qc_language_code = VALUES(qc_language_code),
        qc_option_label = VALUES(qc_option_label);

    -- email_templates
    INSERT INTO qc_bcd_portal.qc_email_templates
        (qc_id, qc_template_key, qc_subject, qc_body_html,
         qc_description, qc_created_at, qc_updated_at)
    SELECT id, template_key, subject, body_html,
           description, created_at, updated_at
    FROM bcd_application2.email_templates
    ON DUPLICATE KEY UPDATE
        qc_template_key = VALUES(qc_template_key),
        qc_subject = VALUES(qc_subject),
        qc_body_html = VALUES(qc_body_html),
        qc_description = VALUES(qc_description),
        qc_updated_at = VALUES(qc_updated_at);

    -- email_template_cc
    INSERT INTO qc_bcd_portal.qc_email_template_cc
        (qc_id, qc_template_key, qc_cc_email)
    SELECT id, template_key, cc_email
    FROM bcd_application2.email_template_cc
    ON DUPLICATE KEY UPDATE
        qc_template_key = VALUES(qc_template_key),
        qc_cc_email = VALUES(qc_cc_email);

    -- patient_responses
    INSERT INTO qc_bcd_portal.qc_patient_responses
        (qc_id, qc_hospital_id, qc_session_id, qc_question, qc_answer,
         qc_created_at, qc_updated_at)
    SELECT id, hospital_id, session_id, question, answer,
           created_at, updated_at
    FROM bcd_application2.patient_responses
    ON DUPLICATE KEY UPDATE
        qc_hospital_id = VALUES(qc_hospital_id),
        qc_session_id = VALUES(qc_session_id),
        qc_question = VALUES(qc_question),
        qc_answer = VALUES(qc_answer),
        qc_updated_at = VALUES(qc_updated_at);

    -- patient_sessions
    INSERT INTO qc_bcd_portal.qc_patient_sessions
        (qc_id, qc_hospital_id, qc_consent_scanned_url, qc_consent_timestamp,
         qc_snehita_brisk_score, qc_tryrer_risk, qc_gail_risk)
    SELECT id, hospital_id, consent_scanned_url, consent_timestamp,
           snehita_brisk_score, tryrer_risk, gail_risk
    FROM bcd_application2.patient_sessions
    ON DUPLICATE KEY UPDATE
        qc_hospital_id = VALUES(qc_hospital_id),
        qc_consent_scanned_url = VALUES(qc_consent_scanned_url),
        qc_consent_timestamp = VALUES(qc_consent_timestamp),
        qc_snehita_brisk_score = VALUES(qc_snehita_brisk_score),
        qc_tryrer_risk = VALUES(qc_tryrer_risk),
        qc_gail_risk = VALUES(qc_gail_risk);

    -- doctor_assessments (preserves qc_sub_ui_id)
    INSERT INTO qc_bcd_portal.qc_doctor_assessments
        (qc_id, qc_doctor_id, qc_questionnaire_feedback,
         qc_is_questionnaire_correct, qc_mammo_birads, qc_mammo_density,
         qc_us_biopsy_birads, qc_us_biopsy_density, qc_precision_diagnosis,
         qc_datapoint_feedback, qc_created_at, qc_clinical_findings,
         qc_recommendation_followup, qc_routine_views_uploaded,
         qc_hospital_id, qc_patient_session_id,
         qc_doctor_risk_class, qc_doctor_case_notes)
    SELECT id, doctor_id, questionnaire_feedback,
           is_questionnaire_correct, mammo_birads, mammo_density,
           us_biopsy_birads, us_biopsy_density, precision_diagnosis,
           datapoint_feedback, created_at, clinical_findings,
           recommendation_followup, routine_views_uploaded,
           hospital_id, patient_session_id,
           doctor_risk_class, doctor_case_notes
    FROM bcd_application2.doctor_assessments
    ON DUPLICATE KEY UPDATE
        qc_doctor_id = VALUES(qc_doctor_id),
        qc_questionnaire_feedback = VALUES(qc_questionnaire_feedback),
        qc_is_questionnaire_correct = VALUES(qc_is_questionnaire_correct),
        qc_mammo_birads = VALUES(qc_mammo_birads),
        qc_mammo_density = VALUES(qc_mammo_density),
        qc_us_biopsy_birads = VALUES(qc_us_biopsy_birads),
        qc_us_biopsy_density = VALUES(qc_us_biopsy_density),
        qc_precision_diagnosis = VALUES(qc_precision_diagnosis),
        qc_datapoint_feedback = VALUES(qc_datapoint_feedback),
        qc_clinical_findings = VALUES(qc_clinical_findings),
        qc_recommendation_followup = VALUES(qc_recommendation_followup),
        qc_routine_views_uploaded = VALUES(qc_routine_views_uploaded),
        qc_hospital_id = VALUES(qc_hospital_id),
        qc_patient_session_id = VALUES(qc_patient_session_id),
        qc_doctor_risk_class = VALUES(qc_doctor_risk_class),
        qc_doctor_case_notes = VALUES(qc_doctor_case_notes);

    -- attachments
    INSERT INTO qc_bcd_portal.qc_attachments
        (qc_id, qc_assessment_id, qc_file_type, qc_file_name,
         qc_storage_url, qc_mime_type, qc_created_at)
    SELECT id, assessment_id, file_type, file_name,
           storage_url, mime_type, created_at
    FROM bcd_application2.attachments
    ON DUPLICATE KEY UPDATE
        qc_assessment_id = VALUES(qc_assessment_id),
        qc_file_type = VALUES(qc_file_type),
        qc_file_name = VALUES(qc_file_name),
        qc_storage_url = VALUES(qc_storage_url),
        qc_mime_type = VALUES(qc_mime_type);

    -- ----- qc_bcd_questionnaire tables (from bcd_questionnaire) -----

    -- session_table
    INSERT INTO qc_bcd_questionnaire.qc_session_table
        (qc_session_id, qc_ip_address, qc_session_start_time, qc_session_end_time,
         qc_snehita_lifetime_risk, qc_gail_5yr_risk, qc_gail_lifetime_risk,
         qc_tyrer_10yr_risk, qc_tyrer_lifetime_risk, qc_risk_category,
         qc_consent_url, qc_benchmark_used)
    SELECT session_id, ip_address, session_start_time, session_end_time,
           snehita_lifetime_risk, gail_5yr_risk, gail_lifetime_risk,
           tyrer_10yr_risk, tyrer_lifetime_risk, risk_category,
           consent_url, COALESCE(benchmark_used, 'no')
    FROM bcd_questionnaire.session_table
    ON DUPLICATE KEY UPDATE
        qc_ip_address = VALUES(qc_ip_address),
        qc_session_start_time = VALUES(qc_session_start_time),
        qc_session_end_time = VALUES(qc_session_end_time),
        qc_snehita_lifetime_risk = VALUES(qc_snehita_lifetime_risk),
        qc_gail_5yr_risk = VALUES(qc_gail_5yr_risk),
        qc_gail_lifetime_risk = VALUES(qc_gail_lifetime_risk),
        qc_tyrer_10yr_risk = VALUES(qc_tyrer_10yr_risk),
        qc_tyrer_lifetime_risk = VALUES(qc_tyrer_lifetime_risk),
        qc_risk_category = VALUES(qc_risk_category),
        qc_consent_url = VALUES(qc_consent_url),
        qc_benchmark_used = VALUES(qc_benchmark_used);

    -- session_data_table
    INSERT INTO qc_bcd_questionnaire.qc_session_data_table
        (qc_session_data_id, qc_session_id, qc_question, qc_answer,
         qc_created_by, qc_created_at)
    SELECT session_data_id, session_id, question, answer,
           created_by, created_at
    FROM bcd_questionnaire.session_data_table
    ON DUPLICATE KEY UPDATE
        qc_session_id = VALUES(qc_session_id),
        qc_question = VALUES(qc_question),
        qc_answer = VALUES(qc_answer),
        qc_created_by = VALUES(qc_created_by),
        qc_created_at = VALUES(qc_created_at);

    SET FOREIGN_KEY_CHECKS = 1;
END$$

DELIMITER ;
