-- PinkShield AI fortnightly hospital submission reports.
-- Apply to the main application database before enabling the scheduler.

CREATE TABLE IF NOT EXISTS reminder_email_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hospital_id VARCHAR(20) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    report_date DATE NOT NULL,
    quarter_start DATE NOT NULL,
    quarter_end DATE NOT NULL,
    data_points INT NOT NULL,
    assessments_submitted INT NOT NULL,
    pending_submissions INT NOT NULL,
    quarterly_target INT NOT NULL DEFAULT 200,
    missing_questionnaire_sessions INT NOT NULL DEFAULT 0,
    incomplete_assessments INT NOT NULL DEFAULT 0,
    missing_mammogram_views INT NOT NULL DEFAULT 0,
    missing_mammogram_reports INT NOT NULL DEFAULT 0,
    mammogram_quality_flags INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    error_message TEXT NULL,
    sent_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_reminder_email_hospital
        FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
    CONSTRAINT uq_reminder_hospital_report_date
        UNIQUE (hospital_id, report_date),
    INDEX idx_reminder_email_hospital (hospital_id),
    INDEX idx_reminder_email_status_sent (status, sent_at)
);

INSERT INTO email_templates (template_key, subject, body_html, description)
VALUES (
    'fortnightly_submission_update',
    'PinkShield AI | Fortnightly Submission Update - {{hospital_name}} - {{quarter}}',
    '<!doctype html><html><body style="margin:0;background:#f4f7f9;font-family:Arial,sans-serif;color:#263238"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px"><table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:8px;overflow:hidden"><tr><td style="background:#14868c;color:#ffffff;padding:24px 32px"><h1 style="margin:0;font-size:24px">PinkShield AI</h1><p style="margin:8px 0 0">Fortnightly submission and data quality update</p></td></tr><tr><td style="padding:28px 32px"><p>Dear {{contact_name}},</p><p>Here is the submission update for <strong>{{hospital_name}}</strong> for <strong>{{quarter}}</strong>, as of {{report_date}}.</p><h2 style="font-size:18px;color:#14868c">Submission summary</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="10" style="border-collapse:collapse;margin:16px 0 24px"><tr style="background:#eef7f7"><td>Data points submitted</td><td align="right"><strong>{{data_points}}</strong></td></tr><tr><td>Assessments submitted</td><td align="right"><strong>{{assessments_submitted}}</strong></td></tr><tr style="background:#eef7f7"><td>Pending submissions</td><td align="right"><strong>{{pending_submissions}} of {{quarterly_target}}</strong></td></tr><tr><td>Assessments pending</td><td align="right"><strong>{{assessment_backlog}}</strong></td></tr></table><p><strong>Quarterly progress: {{data_points}} of {{quarterly_target}} submissions completed ({{progress_percent}}%).</strong></p><h2 style="font-size:18px;color:#14868c;margin-top:28px">Data quality summary</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="10" style="border-collapse:collapse;margin:16px 0 24px"><tr style="background:#fff8e1"><td>Submissions containing blank questionnaire fields</td><td align="right"><strong>{{missing_questionnaire_sessions}}</strong></td></tr><tr><td>Assessments missing core structured fields</td><td align="right"><strong>{{incomplete_assessments}}</strong></td></tr><tr style="background:#fff8e1"><td>Assessments missing one or more standard mammogram views</td><td align="right"><strong>{{missing_mammogram_views}}</strong></td></tr><tr><td>Assessments missing a mammogram report</td><td align="right"><strong>{{missing_mammogram_reports}}</strong></td></tr><tr style="background:#fff8e1"><td>Assessments where routine-view completion is not confirmed</td><td align="right"><strong>{{mammogram_quality_flags}}</strong></td></tr></table><p style="font-size:13px;color:#607d8b">Mammogram checks reflect recorded field and attachment completeness only. They do not constitute automated diagnostic or pixel-level image-quality assessment.</p><p>Please complete pending submissions, fields, assessments, and mammogram uploads before {{quarter_end_date}}.</p><p style="margin:28px 0"><a href="{{portal_url}}" style="background:#14868c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:5px;display:inline-block">View PinkShield AI Portal</a></p><p>If these figures appear incorrect or you need assistance, contact <a href="mailto:{{support_email}}">{{support_email}}</a>.</p><p>Regards,<br><strong>PinkShield AI Team</strong></p></td></tr><tr><td style="background:#f4f7f9;padding:18px 32px;font-size:12px;color:#607d8b">This automated update contains aggregate counts only and does not contain patient information.</td></tr></table></td></tr></table></body></html>',
    'Fortnightly hospital progress against the PinkShield AI quarterly submission target'
)
AS new
ON DUPLICATE KEY UPDATE
    subject = new.subject,
    body_html = new.body_html,
    description = new.description;
