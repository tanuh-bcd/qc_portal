-- Expand reminder reporting for per-user delivery, complete-data-point metrics,
-- aggregate reports, and runtime pause/resume controls.
-- Apply after 20260721_add_reminder_email_reporting.sql.

ALTER TABLE reminder_email_log
    DROP INDEX uq_reminder_hospital_report_date;

ALTER TABLE reminder_email_log
    MODIFY hospital_id VARCHAR(20) NULL,
    ADD COLUMN report_type VARCHAR(20) NOT NULL DEFAULT 'hospital' AFTER id,
    ADD COLUMN idempotency_key VARCHAR(500) NULL AFTER recipient_email,
    ADD COLUMN lifetime_data_points INT NOT NULL DEFAULT 0 AFTER data_points,
    ADD COLUMN missing_consent INT NOT NULL DEFAULT 0 AFTER missing_questionnaire_sessions,
    ADD COLUMN missing_birads INT NOT NULL DEFAULT 0 AFTER incomplete_assessments,
    ADD COLUMN missing_density INT NOT NULL DEFAULT 0 AFTER missing_birads,
    ADD COLUMN attempt_count INT NOT NULL DEFAULT 0 AFTER status;

UPDATE reminder_email_log
SET idempotency_key = CONCAT(
    'legacy:', hospital_id, ':', report_date, ':', LOWER(recipient_email), ':', id
)
WHERE idempotency_key IS NULL
  AND id > 0;

ALTER TABLE reminder_email_log
    MODIFY idempotency_key VARCHAR(500) NOT NULL,
    ADD UNIQUE INDEX uq_reminder_idempotency_key (idempotency_key),
    ADD INDEX idx_reminder_type_recipient_sent
        (report_type, hospital_id, recipient_email, status, sent_at);

CREATE TABLE IF NOT EXISTS reminder_configuration (
    id INT PRIMARY KEY,
    is_paused BOOLEAN NOT NULL DEFAULT FALSE,
    is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by VARCHAR(255) NULL,
    updated_at DATETIME NULL
);

INSERT INTO reminder_configuration (id, is_paused, is_disabled)
VALUES (1, FALSE, FALSE)
AS new
ON DUPLICATE KEY UPDATE id = new.id;

INSERT INTO email_templates (template_key, subject, body_html, description)
VALUES (
    'fortnightly_submission_update',
    'PinkShield AI | Biweekly Submission Update - {{hospital_name}} - {{quarter}}',
    '<!doctype html><html><body style="margin:0;background:#f4f7f9;font-family:Arial,sans-serif;color:#263238"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px"><table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fff;border-radius:8px;overflow:hidden"><tr><td style="background:#14868c;color:#fff;padding:24px 32px"><h1 style="margin:0;font-size:24px">PinkShield AI</h1><p style="margin:8px 0 0">Biweekly submission and data-quality update</p></td></tr><tr><td style="padding:28px 32px"><p>Dear {{contact_name}},</p><p>Here is the update for <strong>{{hospital_name}}</strong> for <strong>{{quarter}}</strong>, as of {{report_date}}.</p><h2 style="font-size:18px;color:#14868c">Submission summary</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="10" style="border-collapse:collapse"><tr style="background:#eef7f7"><td>Complete patient data points across all time</td><td align="right"><strong>{{lifetime_data_points}}</strong></td></tr><tr><td>Complete patient data points this quarter</td><td align="right"><strong>{{data_points}}</strong></td></tr><tr style="background:#eef7f7"><td>Assessments submitted this quarter</td><td align="right"><strong>{{assessments_submitted}}</strong></td></tr><tr><td>Remaining against this quarter''s minimum target</td><td align="right"><strong>{{pending_submissions}} of {{quarterly_target}}</strong></td></tr></table><p><strong>Quarterly progress: {{data_points}} of {{quarterly_target}} complete data points ({{progress_percent}}%).</strong></p><p style="font-size:13px;color:#607d8b">A complete data point requires consent, a completed questionnaire, all four standard mammogram views, bilateral BIRADS, and bilateral ACR breast density.</p><h2 style="font-size:18px;color:#14868c;margin-top:28px">Data-quality summary for current-quarter records</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="10" style="border-collapse:collapse"><tr style="background:#fff8e1"><td>Records received this quarter</td><td align="right"><strong>{{current_quarter_records}}</strong></td></tr><tr><td>Missing consent</td><td align="right"><strong>{{missing_consent}}</strong></td></tr><tr style="background:#fff8e1"><td>Questionnaire not completed</td><td align="right"><strong>{{missing_questionnaire_sessions}}</strong></td></tr><tr><td>Questionnaires containing stored blank fields</td><td align="right"><strong>{{blank_questionnaire_sessions}}</strong></td></tr><tr style="background:#fff8e1"><td>Missing one or more standard mammogram views</td><td align="right"><strong>{{missing_mammogram_views}}</strong></td></tr><tr><td>Missing bilateral BIRADS</td><td align="right"><strong>{{missing_birads}}</strong></td></tr><tr style="background:#fff8e1"><td>Missing bilateral ACR density</td><td align="right"><strong>{{missing_density}}</strong></td></tr><tr><td>Missing mammogram report</td><td align="right"><strong>{{missing_mammogram_reports}}</strong></td></tr><tr style="background:#fff8e1"><td>Routine-view completion not confirmed</td><td align="right"><strong>{{mammogram_quality_flags}}</strong></td></tr></table><p style="font-size:13px;color:#607d8b">Quality checks reflect recorded fields and upload completeness only. They do not evaluate mammogram pixels or provide a diagnosis.</p><p>Please complete current-quarter submissions by {{quarter_end_date}}.</p><p style="margin:28px 0"><a href="{{portal_url}}" style="background:#14868c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:5px;display:inline-block">View PinkShield AI Portal</a></p><p>Regards,<br><strong>PinkShield AI Team</strong></p></td></tr><tr><td style="background:#f4f7f9;padding:18px 32px;font-size:12px;color:#607d8b">This is an automated one-way notice containing aggregate counts only. Replies are not monitored. No patient information is included.</td></tr></table></td></tr></table></body></html>',
    'Biweekly hospital progress and data-quality report for active PinkShield AI users'
)
AS new
ON DUPLICATE KEY UPDATE
    subject = new.subject,
    body_html = new.body_html,
    description = new.description;

INSERT INTO email_templates (template_key, subject, body_html, description)
VALUES (
    'fortnightly_all_hospitals_update',
    'PinkShield AI | All-Hospitals Biweekly Summary - {{quarter}}',
    '<!doctype html><html><body style="margin:0;background:#f4f7f9;font-family:Arial,sans-serif;color:#263238"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px"><table role="presentation" width="1250" cellspacing="0" cellpadding="0" style="max-width:1250px;background:#fff;border-radius:8px;overflow:hidden"><tr><td style="background:#14868c;color:#fff;padding:24px 32px"><h1 style="margin:0;font-size:24px">PinkShield AI</h1><p style="margin:8px 0 0">All-hospitals biweekly data-collection summary</p></td></tr><tr><td style="padding:28px 32px"><p>Dear {{contact_name}},</p><p>This summary covers {{hospital_count}} institutions for <strong>{{quarter}}</strong>, as of {{report_date}}.</p><p><strong>Combined totals:</strong> {{lifetime_data_points}} complete data points across all time; {{data_points}} complete this quarter; {{assessments_submitted}} assessments this quarter; {{pending_submissions}} remaining against a combined target of {{combined_target}}.</p><div style="overflow-x:auto"><table role="presentation" width="100%" cellspacing="0" cellpadding="7" style="border-collapse:collapse;font-size:11px"><thead><tr style="background:#eef7f7"><th align="left">Institution</th><th>All-time complete</th><th>Quarter complete</th><th>Assessments</th><th>Remaining</th><th>Quarter records</th><th>Missing consent</th><th>Missing questionnaire</th><th>Blank fields</th><th>Missing views</th><th>Missing BIRADS</th><th>Missing density</th><th>Missing report</th><th>View quality flags</th><th>Active recipients</th></tr></thead><tbody>{{hospital_rows}}</tbody></table></div><p style="font-size:13px;color:#607d8b;margin-top:20px">Remaining counts are current-quarter shortfalls against the minimum target of {{quarterly_target}} per institution. Historical-quarter shortfalls are intentionally excluded.</p><p style="margin:28px 0"><a href="{{portal_url}}" style="background:#14868c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:5px;display:inline-block">View PinkShield AI Portal</a></p><p>Regards,<br><strong>PinkShield AI Team</strong></p></td></tr><tr><td style="background:#f4f7f9;padding:18px 32px;font-size:12px;color:#607d8b">This is an automated one-way notice containing aggregate counts only. Replies are not monitored. No patient information is included.</td></tr></table></td></tr></table></body></html>',
    'Biweekly aggregate data-collection summary for all participating hospitals'
)
AS new
ON DUPLICATE KEY UPDATE
    subject = new.subject,
    body_html = new.body_html,
    description = new.description;
