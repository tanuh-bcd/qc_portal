-- New, self-contained email-notification feature (case-assignment emails +
-- a 3-day pending-cases reminder for Mammo Tech/Radiologist users). Fully
-- independent of the existing reminder_email_log/reminder_configuration
-- tables (a separate, unrelated hospital-quarterly-report feature) — nothing
-- there is touched. Apply to the QC application database only.

CREATE TABLE IF NOT EXISTS qc_bcd_portal.qc_pending_case_reminders (
    qc_id INT AUTO_INCREMENT PRIMARY KEY,
    qc_user_id INT NOT NULL,
    qc_last_sent_at DATETIME NULL,
    qc_pending_count_at_send INT NULL,
    qc_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    qc_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pending_case_reminder_user (qc_user_id),
    CONSTRAINT qc_pending_case_reminders_ibfk_user
        FOREIGN KEY (qc_user_id) REFERENCES qc_bcd_portal.qc_users (qc_id)
);

INSERT INTO qc_bcd_portal.qc_email_templates (qc_template_key, qc_subject, qc_body_html, qc_description)
SELECT
    'mammo_tech_case_assigned',
    'QC Portal – Cases Assigned for Review',
    '<p>Hi {{full_name}},</p><p>You have been assigned cases for review in the QC Portal.</p><p>Please review the assigned cases at your convenience.</p><p>Kindly log in to the QC Portal and complete the assigned reviews.</p><p>Regards,<br>QC Portal Team</p>',
    'Sent to a Mammo Tech when a QC Admin assigns cases to them'
WHERE NOT EXISTS (
    SELECT 1 FROM qc_bcd_portal.qc_email_templates WHERE qc_template_key = 'mammo_tech_case_assigned'
);

INSERT INTO qc_bcd_portal.qc_email_templates (qc_template_key, qc_subject, qc_body_html, qc_description)
SELECT
    'radiologist_case_assigned',
    'QC Portal – Cases Assigned for Radiologist Review',
    '<p>Hi {{full_name}},</p><p>You have been assigned cases for review following Mammo Tech acceptance.</p><p>Please review the assigned cases at your convenience.</p><p>Kindly log in to the QC Portal and complete the pending reviews.</p><p>Regards,<br>QC Portal Team</p>',
    'Sent to a Radiologist when a Mammo Tech accepts a case and hands it off for radiologist review'
WHERE NOT EXISTS (
    SELECT 1 FROM qc_bcd_portal.qc_email_templates WHERE qc_template_key = 'radiologist_case_assigned'
);

INSERT INTO qc_bcd_portal.qc_email_templates (qc_template_key, qc_subject, qc_body_html, qc_description)
SELECT
    'pending_case_reminder',
    'QC Portal – Pending Cases Reminder',
    '<p>Hi {{full_name}},</p><p>You have pending cases assigned to you for review in the QC Portal.</p><p>Please log in and complete the pending reviews at your convenience.</p><p>Regards,<br>QC Portal Team</p>',
    'Recurring reminder (every 3 days) sent to a Mammo Tech/Radiologist while they have at least one pending case'
WHERE NOT EXISTS (
    SELECT 1 FROM qc_bcd_portal.qc_email_templates WHERE qc_template_key = 'pending_case_reminder'
);
