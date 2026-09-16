-- Radiologist and Mammo Tech accounts aren't scoped to a single hospital
-- (hospital_id is optional for both — see backend/src/api/admin.py), so the
-- account-creation email's "Hospital: {{hospital_name}}" line renders blank
-- for them. Drops that line from the template entirely rather than making it
-- conditional, since email.py's renderer only does flat {{var}} substitution
-- with no per-role branching.
-- Apply to the QC application database only.

UPDATE qc_bcd_portal.qc_email_templates
SET
    qc_body_html = '<p>Hi {{full_name}},</p><p>Your account has been created on the QC BCD Portal. Below are your login details:</p><p>Email: {{email}}<br>Temporary Password: {{temp_password}}<br>Role: {{role_name}}</p><p>Please log in at <a href="{{login_url}}">{{login_url}}</a> and change your password after your first login.</p><p>Regards,<br>QC BCD Portal Team</p>'
WHERE qc_template_key = 'user_created';
