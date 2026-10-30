-- Retrospective: new wording for the three emails, to match the final workflow
-- (the Radiologist marks with free hand and writes a note; they no longer save a mask).
-- Apply to qc_bcd_portal AFTER 20261031. Only updates the three rows that file created. Safe to re-run.

USE qc_bcd_portal;

UPDATE qc_email_templates SET
  qc_body_html = '<p>Hi {{full_name}},</p><p>{{case_count}} retrospective case(s) ({{first_case}} to {{last_case}}) have been assigned to you for lesion segmentation in the QC BCD Portal.</p><p>Please log in at <a href="{{login_url}}">{{login_url}}</a>, open the Retrospective section, and segment the lesion in each case. If you are not sure whether a finding is a lesion, circle it with the free-hand tool, write a note, and send the case to a Radiologist.</p><p>Regards,<br>QC BCD Portal Team</p>'
WHERE qc_template_key = 'retro_cases_assigned';

UPDATE qc_email_templates SET
  qc_body_html = '<p>Hi {{full_name}},</p><p>Mammo Tech {{mammo_tech_name}} is not sure about the lesion in retrospective case {{case_code}} and has asked for your review.</p><p><b>Note from the Mammo Tech:</b><br>{{note}}</p><p>Please log in at <a href="{{login_url}}">{{login_url}}</a>, open the case in the Retrospective section, and look at the free-hand marks and the Notes tab. Then either draw your own free-hand marks to show where the lesion is and write a note for the Mammo Tech, or reject the case if there is no lesion.</p><p>Regards,<br>QC BCD Portal Team</p>'
WHERE qc_template_key = 'retro_case_escalated';

UPDATE qc_email_templates SET
  qc_body_html = '<p>Hi {{full_name}},</p><p>Radiologist {{radiologist_name}} has reviewed retrospective case {{case_code}} and sent it back to you.</p><p>Their free-hand marks and note are on the case. Please log in at <a href="{{login_url}}">{{login_url}}</a>, open the case in the Retrospective section, read the Notes tab, and segment the lesion where they have marked it.</p><p>Regards,<br>QC BCD Portal Team</p>'
WHERE qc_template_key = 'retro_case_returned';

-- Check: should list 3 rows, none mentioning "mask" in the returned email.
SELECT qc_template_key, LEFT(qc_body_html, 90) AS starts_with FROM qc_email_templates
WHERE qc_template_key IN ('retro_cases_assigned', 'retro_case_escalated', 'retro_case_returned');
