-- Renames "PinkShieldAI Portal" -> "QC BCD Portal" across QC Portal's own
-- emails (account creation, mammo-tech/radiologist assignment, pending-case
-- reminder), updates the account-creation email's login URL, and removes any
-- configured CC recipients from the account-creation email.
--
-- Scope is intentionally narrow: only these 4 qc_email_templates rows and
-- the user_created row's qc_email_template_cc rows are touched. The
-- unrelated hospital bi-weekly reminder feature (its own template keys,
-- rows, recipients, CCs, and scheduling) is not modified by this file at all.
-- Apply to the QC application database only.

UPDATE qc_bcd_portal.qc_email_templates
SET
    qc_subject = 'Your QC BCD Portal Account Has Been Created',
    qc_body_html = '<p>Hi {{full_name}},</p><p>Your account has been created on the QC BCD Portal. Below are your login details:</p><p>Email: {{email}}<br>Temporary Password: {{temp_password}}<br>Hospital: {{hospital_name}}<br>Role: {{role_name}}</p><p>Please log in at <a href="{{login_url}}">{{login_url}}</a> and change your password after your first login.</p><p>Regards,<br>QC BCD Portal Team</p>'
WHERE qc_template_key = 'user_created';

-- Requirement: send only to the user being created, no CC at all.
DELETE FROM qc_bcd_portal.qc_email_template_cc
WHERE qc_template_key = 'user_created';

UPDATE qc_bcd_portal.qc_email_templates
SET
    qc_subject = 'QC BCD Portal – Cases Assigned for Review',
    qc_body_html = '<p>Hi {{full_name}},</p><p>You have been assigned cases for review in the QC BCD Portal.</p><p>Please review the assigned cases at your convenience.</p><p>Kindly log in to the QC BCD Portal and complete the assigned reviews.</p><p>Regards,<br>QC BCD Portal Team</p>'
WHERE qc_template_key = 'mammo_tech_case_assigned';

UPDATE qc_bcd_portal.qc_email_templates
SET
    qc_subject = 'QC BCD Portal – Cases Assigned for Radiologist Review',
    qc_body_html = '<p>Hi {{full_name}},</p><p>You have been assigned cases for review following Mammo Tech acceptance.</p><p>Please review the assigned cases at your convenience.</p><p>Kindly log in to the QC BCD Portal and complete the pending reviews.</p><p>Regards,<br>QC BCD Portal Team</p>'
WHERE qc_template_key = 'radiologist_case_assigned';

UPDATE qc_bcd_portal.qc_email_templates
SET
    qc_subject = 'QC BCD Portal – Pending Cases Reminder',
    qc_body_html = '<p>Hi {{full_name}},</p><p>You have pending cases assigned to you for review in the QC BCD Portal.</p><p>Please log in and complete the pending reviews at your convenience.</p><p>Regards,<br>QC BCD Portal Team</p>'
WHERE qc_template_key = 'pending_case_reminder';
