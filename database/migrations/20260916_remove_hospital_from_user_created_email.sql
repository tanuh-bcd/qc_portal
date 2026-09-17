UPDATE qc_bcd_portal.qc_email_templates
SET
    qc_body_html = '<p>Hi {{full_name}},</p><p>Your account has been created on the QC BCD Portal. Below are your login details:</p><p>Email: {{email}}<br>Temporary Password: {{temp_password}}<br>Role: {{role_name}}</p><p>Please log in at <a href="{{login_url}}">{{login_url}}</a> and change your password after your first login.</p><p>Regards,<br>QC BCD Portal Team</p>'
WHERE qc_template_key = 'user_created';
