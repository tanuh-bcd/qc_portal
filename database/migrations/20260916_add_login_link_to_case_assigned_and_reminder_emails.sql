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
