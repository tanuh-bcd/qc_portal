-- Email templates for the retrospective workflow. Apply to qc_bcd_portal only.
-- Safe to re-run: existing templates with these keys are updated, others are untouched.
-- Wording follows the existing QC templates (subject "QC BCD Portal - ...", sign-off "QC BCD Portal Team").
-- Sent by the same SMTP settings as every other QC email. No CC rows are created, so nobody is copied.
-- Placeholders {{...}} are filled in by the application; user-typed text is HTML-escaped before it gets here.

-- Safety: make sure these rows go into the QC schema, never into bcd_application2.
USE qc_bcd_portal;

INSERT INTO qc_email_templates (qc_template_key, qc_subject, qc_body_html, qc_description) VALUES
('retro_cases_assigned',
 'QC BCD Portal – Retrospective Cases Assigned for Segmentation',
 '<p>Hi {{full_name}},</p><p>{{case_count}} retrospective case(s) ({{first_case}} to {{last_case}}) have been assigned to you for lesion segmentation in the QC BCD Portal.</p><p>Please log in at <a href="{{login_url}}">{{login_url}}</a>, open the Retrospective section, and complete the segmentations. If you are unsure whether a finding is a lesion, use the option to send the case to a Radiologist.</p><p>Regards,<br>QC BCD Portal Team</p>',
 'Sent to a Mammo Tech when an admin assigns a range of retrospective cases'),
('retro_case_escalated',
 'QC BCD Portal – Retrospective Case Needs Your Review',
 '<p>Hi {{full_name}},</p><p>Mammo Tech {{mammo_tech_name}} is unsure about the lesion in retrospective case {{case_code}} and has asked for your review.</p><p><b>Note from the Mammo Tech:</b><br>{{note}}</p><p>Please log in at <a href="{{login_url}}">{{login_url}}</a>, open the Retrospective section, mark where the lesion is, add your clinical notes, and complete the review.</p><p>Regards,<br>QC BCD Portal Team</p>',
 'Sent to a Radiologist when a Mammo Tech sends a retrospective case for review'),
('retro_case_returned',
 'QC BCD Portal – Radiologist Review Completed',
 '<p>Hi {{full_name}},</p><p>Radiologist {{radiologist_name}} has completed the review of retrospective case {{case_code}}.</p><p>Their notes and lesion mask are available on the case. Please log in at <a href="{{login_url}}">{{login_url}}</a>, open the case in the Retrospective section, and finish the segmentation.</p><p>Regards,<br>QC BCD Portal Team</p>',
 'Sent to the Mammo Tech when the Radiologist hands a retrospective case back')
AS new_row
ON DUPLICATE KEY UPDATE
  qc_subject = new_row.qc_subject,
  qc_body_html = new_row.qc_body_html,
  qc_description = new_row.qc_description;
