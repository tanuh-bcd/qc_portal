# Proposal: PinkShield AI Fortnightly Submission Reminder Emails

## Purpose

This document proposes a reminder and progress-reporting email service for hospitals participating in the PinkShield AI data collection programme. The purpose is to give each hospital a clear update on its submissions and help it work toward the quarterly target.

No implementation work should begin until the reporting definitions, recipients, schedule, and privacy requirements in this proposal are approved.

## Proposed Service

Every two weeks, PinkShield AI will send each participating hospital an automated email summarising its progress for the current quarter.

The email will show:

1. The number of data points submitted during the quarter.
2. The number of assessments submitted during the quarter.
3. The number of submissions still required to reach the quarterly target of 200.
4. Optionally, the number of submitted data points that do not yet have an assessment.
5. A data-quality summary covering recorded missing fields and mammogram completeness flags.

The report will cover only the recipient hospital's records. It will not contain patient names, questionnaire responses, images, reports, or other patient-level clinical information.

The data-quality section will show the number of submissions containing explicitly blank questionnaire answers, assessments missing core structured fields, assessments missing one or more of the four standard mammogram views, assessments missing a mammogram report, and assessments where routine-view completion has not been confirmed. These are record-completeness checks; they do not represent diagnostic or pixel-level image-quality analysis.

## Proposed Metric Definitions

For the initial implementation, the following definitions are recommended:

- **Data points submitted:** The number of distinct patient submission records associated with the hospital during the current calendar quarter.
- **Assessments submitted:** The number of distinct patient submissions for which a clinical assessment has been recorded during the current calendar quarter.
- **Pending submissions:** The quarterly target of 200 minus the number of data points submitted. This value will not fall below zero.
- **Assessment backlog (optional):** The number of submitted data points that do not yet have an assessment.

These definitions must be confirmed before development. In particular, stakeholders must decide whether the target of 200 applies to patient data points or completed clinical assessments.

## Email Content

Each email will include:

- Hospital name.
- Current quarter and reporting period.
- Data points submitted.
- Assessments submitted.
- Pending submissions out of the target of 200.
- Optional assessment backlog.
- A link to the PinkShield AI portal.
- A support contact for questions or corrections.

The message will be branded as a PinkShield AI update and sent from an approved PinkShield AI email account. The wording will be concise, supportive, and action-oriented rather than punitive.

## Recipients

The system can use the hospital's registered contact email as the primary recipient. Approved hospital administrators or clinicians may also receive the report if required.

A PinkShield AI programme or operations address may be copied for monitoring. Recipient rules should be centrally configurable so they can be changed without altering the reporting process.

Before activation, every hospital's recipient list should be reviewed and approved. Inactive users and personal addresses should not receive reports unless specifically authorised.

## Scheduling

The service will check for due reports on a regular schedule and send a report only when at least 14 days have passed since that hospital's last successful report.

This approach ensures a true two-week interval even across month and year boundaries. It also allows a failed delivery to be retried without sending duplicate successful reports.

The preferred delivery time is 9:00 AM India Standard Time on an agreed working day. The exact start date and delivery window should be approved before activation.

## Proposed Implementation Approach

The work will be divided into the following areas:

1. **Reporting logic:** Calculate quarter dates and hospital-level submission totals from the existing databases.
2. **Email template:** Create an approved PinkShield AI email design with the required metrics, portal link, and support details.
3. **Email delivery:** Use the existing backend email capability with approved PinkShield AI sender credentials stored securely.
4. **Scheduling:** Add an automated scheduled task that checks which hospitals are due to receive a report.
5. **Delivery history:** Record each attempted report, its reporting period, recipient, metric totals, delivery status, and any error.
6. **Duplicate prevention:** Ensure the same hospital and reporting period cannot receive the same report more than once accidentally.
7. **Administration:** Provide a controlled way to test, preview, resend, or temporarily disable reports.

The existing `pytorch_env` environment can be used to run the scheduled task if it contains the required backend dependencies. If the production website runs entirely in containers or managed cloud services, a dedicated scheduled service may be more reliable than relying on the environment directly.

## Privacy and Security

The email must contain aggregate counts only. No personally identifiable information or patient-level clinical data will be included.

Sender credentials will be stored in the existing secret-management mechanism and will not be committed to the repository. Access to manual report execution and delivery records will be restricted to authorised PinkShield AI personnel.

Delivery logs will retain only the information required for auditing and troubleshooting. The retention period should follow the organisation's data-governance policy.

## Reliability and Monitoring

The system will maintain a delivery record for every email attempt. PinkShield AI administrators should be able to identify:

- Successful and failed deliveries.
- Hospitals whose reports are overdue.
- Invalid or rejected recipient addresses.
- The metric totals contained in each previously sent report.
- Manual retries or resends.

Email failures should not affect normal website operation or data submission. Failed messages will be logged and retried according to an agreed retry policy.

## Testing and Rollout

The proposed rollout is:

1. Confirm the metric definitions, target, recipients, wording, and schedule.
2. Build and test the reporting calculations using test data.
3. Compare calculated totals with manually verified hospital totals.
4. Preview the email using internal PinkShield AI addresses only.
5. Conduct a pilot with one or two approved hospitals.
6. Review feedback and delivery records.
7. Activate the service for all approved hospitals.
8. Monitor the first two full reporting cycles before considering the rollout complete.

An emergency disable option should be available throughout the pilot and production rollout.

## Expected Benefits

- Hospitals receive consistent progress updates without manual follow-up.
- Submission gaps become visible earlier in the quarter.
- PinkShield AI can monitor engagement and delivery problems.
- Hospitals have a clear view of progress toward the target of 200.
- The programme gains an auditable history of reminder communications.

## Risks and Mitigations

- **Incorrect counts:** Confirm definitions, add automated tests, and manually validate pilot reports.
- **Emailing the wrong person:** Require recipient approval and maintain a controlled recipient list.
- **Duplicate emails:** Maintain delivery history and enforce duplicate-prevention rules.
- **Patient privacy exposure:** Include aggregate counts only and prohibit patient-level data in emails.
- **Email delivery failure:** Log failures, monitor delivery, and use a defined retry process.
- **Reports sent at an unsuitable time:** Agree on the start date, timezone, and working-day schedule.
- **Quarterly target changes:** Make the target configurable instead of permanently fixing it at 200.

## Questions Requiring Approval

1. Does the quarterly target of 200 refer to patient data points or completed clinical assessments?
2. What exactly qualifies as a submitted data point: a started session, completed questionnaire, consented submission, or another milestone?
3. Should totals cover the current calendar quarter, a programme-specific quarter, or a rolling three-month period?
4. Should the report show totals for the quarter only, or both quarterly totals and activity since the previous email?
5. Should the assessment backlog be shown in the email?
6. Who should receive each hospital's report: the registered hospital contact, administrators, clinicians, or a configured mailing list?
7. Should a central PinkShield AI address receive a copy of every report or only failure alerts?
8. Which PinkShield AI email address and display name should be used as the sender?
9. What should the reply-to and support addresses be?
10. On which day and at what time should the fortnightly report be sent?
11. Should reports be sent when a hospital has submitted no data during the quarter?
12. Should hospitals that have already reached 200 continue receiving progress emails?
13. Should the target be the same for every hospital, or configurable per hospital and quarter?
14. How many times should a failed email be retried, and who should be notified after repeated failure?
15. How long should delivery records be retained?
16. Who is authorised to preview, manually resend, pause, or disable reports?
17. Which hospitals should participate in the initial pilot?
