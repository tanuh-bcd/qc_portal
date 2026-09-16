-- user_created already links to the QC portal login page
-- (<a href="{{login_url}}">{{login_url}}</a>). These 3 templates only said
-- "log in to the QC BCD Portal" as plain text with no clickable link — turns
-- that phrase into an <a href="{{login_url}}"> link in each, so every QC
-- account/case-assignment/reminder email lets the user go straight there.
-- The 3 send_template_email call sites for these keys (admin.py,
-- mammo_tech.py, pending_case_reminders.py) now pass login_url=QC_LOGIN_URL
-- (https://bc-qc-dev.tanuh.ai) explicitly, matching user_created's call site.
-- Apply to the QC application database only.

UPDATE qc_bcd_portal.qc_email_templates
SET
    qc_body_html = '<p>Hi {{full_name}},</p><p>You have been assigned cases for review in the QC BCD Portal.</p><p>Please review the assigned cases at your convenience.</p><p>Kindly <a href="{{login_url}}">log in to the QC BCD Portal</a> and complete the assigned reviews.</p><p>Regards,<br>QC BCD Portal Team</p>'
WHERE qc_template_key = 'mammo_tech_case_assigned';

UPDATE qc_bcd_portal.qc_email_templates
SET
    qc_body_html = '<p>Hi {{full_name}},</p><p>You have been assigned cases for review following Mammo Tech acceptance.</p><p>Please review the assigned cases at your convenience.</p><p>Kindly <a href="{{login_url}}">log in to the QC BCD Portal</a> and complete the pending reviews.</p><p>Regards,<br>QC BCD Portal Team</p>'
WHERE qc_template_key = 'radiologist_case_assigned';

UPDATE qc_bcd_portal.qc_email_templates
SET
    qc_body_html = '<p>Hi {{full_name}},</p><p>You have pending cases assigned to you for review in the QC BCD Portal.</p><p>Please <a href="{{login_url}}">log in</a> and complete the pending reviews at your convenience.</p><p>Regards,<br>QC BCD Portal Team</p>'
WHERE qc_template_key = 'pending_case_reminder';
