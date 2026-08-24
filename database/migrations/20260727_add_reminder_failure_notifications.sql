-- Add target-achieved wording and notify the rollout owner after the initial
-- reminder delivery plus two failed Scheduler retries.
-- Apply after 20260722_expand_reminder_reporting.sql.

ALTER TABLE reminder_email_log
    ADD COLUMN failure_notified_at DATETIME NULL AFTER error_message,
    ADD COLUMN failure_notification_error TEXT NULL AFTER failure_notified_at;

UPDATE email_templates
SET body_html = REPLACE(
    body_html,
    '<p>Please complete current-quarter submissions by {{quarter_end_date}}.</p>',
    '<p style="margin-top:20px"><strong>{{goal_status_message}}</strong></p>'
)
WHERE template_key = 'fortnightly_submission_update';

INSERT INTO email_templates (template_key, subject, body_html, description)
VALUES (
    'fortnightly_delivery_failure',
    'PinkShield AI | Reminder Delivery Failure - {{hospital_name}} - {{report_date}}',
    '<!doctype html><html><body style="margin:0;background:#f4f7f9;font-family:Arial,sans-serif;color:#263238"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px"><table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fff;border-radius:8px;overflow:hidden"><tr><td style="background:#a93838;color:#fff;padding:24px 32px"><h1 style="margin:0;font-size:24px">PinkShield AI</h1><p style="margin:8px 0 0">Reminder delivery failure</p></td></tr><tr><td style="padding:28px 32px"><p>Dear PinkShield AI Team,</p><p>A reminder report could not be delivered after the initial attempt and two retries.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="10" style="border-collapse:collapse"><tr style="background:#f8eeee"><td>Report type</td><td><strong>{{report_type}}</strong></td></tr><tr><td>Institution</td><td><strong>{{hospital_name}}</strong></td></tr><tr style="background:#f8eeee"><td>Intended recipient</td><td><strong>{{intended_recipient}}</strong></td></tr><tr><td>Report date</td><td><strong>{{report_date}}</strong></td></tr><tr style="background:#f8eeee"><td>Delivery attempts</td><td><strong>{{attempt_count}}</strong></td></tr></table><h2 style="font-size:18px;color:#a93838;margin-top:24px">Last recorded error</h2><p style="padding:12px;background:#f4f7f9;word-break:break-word">{{last_error}}</p><p>Please review the delivery logs and SMTP configuration, then use the authorized reminder-management API to resend after the issue is corrected.</p><p>Regards,<br><strong>PinkShield AI Reminder Service</strong></p></td></tr><tr><td style="background:#f4f7f9;padding:18px 32px;font-size:12px;color:#607d8b">This operational alert contains no patient information.</td></tr></table></td></tr></table></body></html>',
    'Operational alert after a reminder delivery exhausts the initial attempt and two retries'
)
AS new
ON DUPLICATE KEY UPDATE
    subject = new.subject,
    body_html = new.body_html,
    description = new.description;
