# PinkShield AI Biweekly Reminder Operations

## Approved report definition

A complete patient data point requires all five of the following components:

1. A stored consent document.
2. A completed questionnaire (`snehita_lifetime_risk` is populated).
3. All four standard mammogram views: left/right CC and left/right MLO.
4. BIRADS for both breasts.
5. ACR breast density for both breasts.

Assessments are matched directly through
`doctor_assessments.patient_session_id = questionnaire session_id`. The
`patient_sessions` row is used only as an additional consent source, so a
valid assessment and its attachments are not discarded when an imported or
legacy dataset lacks the intermediary parent row.

Each hospital report contains complete data points across all time, complete data points in the current calendar quarter, assessments submitted for current-quarter records, and the current-quarter remainder against the minimum target of 200. The remainder never becomes negative, and reports continue after 200 is reached.

When the current-quarter target is reached, the hospital email thanks the institution, confirms that the minimum target was achieved, and asks users to continue submitting complete records and resolving remaining data-quality issues. The submitted count may exceed 200, while displayed progress is capped at 100%.

The data-quality section covers current-quarter records and reports missing consent, incomplete questionnaires, stored blank questionnaire fields, missing standard views, missing bilateral BIRADS, missing bilateral ACR density, missing mammogram reports, and assessments where routine-view completion was not confirmed. These checks inspect database fields and upload presence only; they do not analyse mammogram pixels or make clinical judgements.

Historical-quarter target shortfalls are intentionally excluded because their definition was not approved.

## Recipients and sender

Hospital reports are sent separately to every active user account associated with that hospital. Individual delivery prevents one hospital user from seeing other recipients' addresses and provides per-recipient auditing and retry safety.

The all-hospitals report is sent separately to:

- `ashwin.rajkumar@tanuh.ai`
- `vaishnavi.joshi@tanuh.ai`

It includes every non-excluded institution, including institutions with zero complete submissions, in a single aggregate table.

The approved sender is `PinkShieldAI <breastcancerscreening@tanuh.ai>`. Hospital and all-hospitals reports explicitly CC `bcs@tanuh.ai`; delivery-failure alerts have no CC. Reminder templates ignore database-configured CC lists, so existing customized-email CC records remain unchanged. The footer identifies the message as an automated one-way notice and patient identifiers are never included.

## Configuration

Production configuration and credentials must be stored in Google Secret Manager, using the repository's `bcd-` secret prefix, or supplied as protected runtime environment variables:

- `SMTP_HOST` and `SMTP_PORT`
- `SMTP_USER` and `SMTP_PASSWORD`
- `REMINDER_FROM_EMAIL` (defaults to the approved PinkShield AI sender)
- `REMINDER_EMAIL_ENABLED` (keep `false` until pilot approval)
- `REMINDER_RECIPIENT_EMAIL` (pilot-only override; empty in production)
- `REMINDER_QUARTERLY_TARGET` (default `200`)
- `REMINDER_INTERVAL_DAYS` (default `14`)
- `REMINDER_INTERVAL_MINUTES` (default `0`; pilot-only when non-zero)
- `REMINDER_EXCLUDED_HOSPITALS` (defaults to `Test,Tanuh Foundation`)
- `REMINDER_EXCLUDED_RECIPIENT_DOMAINS` (defaults to `tanuh.ai`; matching users are excluded from hospital reports)
- `REMINDER_CC_EMAILS` (defaults to `bcs@tanuh.ai`; applies to hospital and all-hospitals reports only)
- `REMINDER_AGGREGATE_RECIPIENTS`
- `REMINDER_OPERATOR_EMAILS`
- `REMINDER_MAX_DELIVERY_ATTEMPTS` (default `3`: initial attempt plus two retries)
- `REMINDER_FAILURE_RECIPIENT_EMAIL` (defaults to `vaishnavi.joshi@tanuh.ai`)
- `REMINDER_TEMPLATE_TEST_ENABLED` (default `false`; enable only for a controlled test)
- `REMINDER_PORTAL_URL`, `REMINDER_TIMEZONE`, and `REMINDER_LOG_RETENTION_DAYS`
- `CRON_OIDC_AUDIENCE` and `CRON_SERVICE_ACCOUNT_EMAIL`

Do not use or commit a normal Google account password. Use a Google Workspace-approved App Password or SMTP relay credential. Before rollout, the Workspace administrator must verify sender authorization and SPF, DKIM, and DMARC alignment. Those controls materially reduce spam placement but no application can guarantee a specific inbox placement.

For local work without Google credentials, set `DISABLE_SECRET_MANAGER=true`; explicit local environment values and safe defaults will then be used without attempting Secret Manager calls.

## Database setup

Apply all reminder migrations to the main application database, in order:

1. `database/migrations/20260721_add_reminder_email_reporting.sql`
2. `database/migrations/20260722_expand_reminder_reporting.sql`
3. `database/migrations/20260727_add_reminder_failure_notifications.sql`

The second migration enables one audited row per recipient and report, aggregate-report deliveries, complete-data-point fields, retry attempt counts, idempotency, and persistent pause/resume state. The third migration adds failure-notification audit fields, target-achieved wording, and the operational failure template.

Before applying migrations, take a database backup and confirm that the first migration has not already been modified or partially applied. Apply them to the development Cloud SQL instance first.

## Authorized management

Only active PinkShield accounts whose exact email appears in `REMINDER_OPERATOR_EMAILS` may access the management API. The approved defaults are:

- `bharath.tangella@tanuh.ai`
- `ashwin.rajkumar@tanuh.ai`
- `vaishnavi.joshi@tanuh.ai`
- `palivela.sanjana@tanuh.ai`

Authenticated management endpoints are available under `/api/v1/reminders`:

- `GET /status` shows the feature flag, runtime pause state, interval, target, and aggregate recipients.
- `GET /preview` calculates hospital reports without logging or sending an email. Each report includes `activeRecipientEmails`, allowing an authorized operator to verify the exact active PinkShield accounts that would receive that hospital's report. The list reflects real active hospital accounts even while the Manisha pilot override is configured.
- `POST /resend` performs an intentional manual delivery and creates a distinct audit attempt.
- `POST /pause` immediately blocks scheduled and manual live delivery while retaining previews and scheduler dry runs.
- `POST /resume` removes the runtime pause; the deployment-level `REMINDER_EMAIL_ENABLED` flag must still be enabled.
- `POST /disable` persistently disables scheduled and manual live delivery.
- `POST /enable` removes the operator-level disable; both the deployment flag and pause state must also allow delivery.

The scheduler endpoint remains separate and accepts only its configured GCP service-account identity (or the explicitly configured local test secret).

## Validation and rollout

Hospital reports cover every non-excluded institution in the application
database. Newly added hospitals are included automatically on the next due
run. Before enabling live delivery, query Cloud SQL read-only to confirm the
hospital list, active-account counts, consent population, session-to-hospital
mapping, assessment fields, and attachment types.

The hospital recipient list is every unique, non-empty email belonging to an
active PinkShield user associated with that hospital, excluding addresses whose
domain appears in `REMINDER_EXCLUDED_RECIPIENT_DOMAINS`. By default this keeps
`@tanuh.ai` accounts out of hospital-level delivery. Newly added eligible users
are included automatically on the next due run. Review `activeRecipientEmails`
in the authorized preview response and reconcile it with this read-only query
before enabling delivery:

```sql
SELECT
    h.id AS hospital_id,
    h.name AS hospital_name,
    u.full_name,
    LOWER(TRIM(u.email)) AS recipient_email,
    u.is_active
FROM hospitals h
JOIN users u ON u.hospital_id = h.id
WHERE u.is_active = TRUE
  AND u.email IS NOT NULL
  AND TRIM(u.email) <> ''
  AND LOWER(TRIM(u.email)) NOT LIKE '%@tanuh.ai'
ORDER BY h.name, u.email;
```

The rollout owner must confirm the list with the hospital or programme owner before live delivery. Deactivate obsolete accounts or correct their hospital association instead of maintaining a separate hard-coded recipient list.

For the five-minute local pilot:

1. Set `REMINDER_RECIPIENT_EMAIL=manisha.verma@tanuh.ai`.
2. Set `REMINDER_INTERVAL_MINUTES=5` and keep `REMINDER_INTERVAL_DAYS=14`.
3. Keep live delivery disabled for the first preview/dry run.
4. Compare each metric against read-only database queries for the selected test hospital and verify the all-hospitals preview.
5. Enable one controlled SMTP delivery and inspect sender, recipient, subject, content, SPF/DKIM/DMARC results, links, and privacy.
6. Confirm that a repeat before five minutes is skipped and a run at or after five minutes is eligible.
7. Restore `REMINDER_RECIPIENT_EMAIL` to empty and `REMINDER_INTERVAL_MINUTES=0` before production rollout.

For an all-hospitals summary test, keep the pilot override set to
`manisha.verma@tanuh.ai` and call the Cron API with `aggregate_only=true`,
`dry_run=false`, and no `hospital_id`. This sends exactly one aggregate summary
to Manisha and suppresses hospital-level reports. In production, clear
`REMINDER_RECIPIENT_EMAIL`; the same aggregate summary is then sent separately
to `ashwin.rajkumar@tanuh.ai`, `vaishnavi.joshi@tanuh.ai`,
`palivela.sanjana@tanuh.ai`, `manisha.verma@tanuh.ai`,
`bharath.tangella@tanuh.ai`, and `phaneendra.yalavarthy@tanuh.ai`.

To inspect every email format in one controlled test, set
`REMINDER_TEMPLATE_TEST_ENABLED=true`, keep
`REMINDER_RECIPIENT_EMAIL=manisha.verma@tanuh.ai`, and call
`POST /api/internal/jobs/reminder-template-tests` with one valid `hospital_id`.
Run it first with `dry_run=true`, which is the safe default and sends nothing;
then use `dry_run=false` for the controlled four-message delivery.
The endpoint sends four messages to Manisha only:

1. Hospital report with submissions pending.
2. Hospital report with the quarterly target achieved.
3. All-hospitals aggregate summary.
4. Sample delivery-failure alert.

The messages are visibly marked as tests, do not create delivery-log rows, do
not change recipient due dates, and do not indicate that a real delivery
failed. Disable `REMINDER_TEMPLATE_TEST_ENABLED` immediately after review.

## Scheduling, failures, and retention

Production Cloud Scheduler invokes `POST /api/internal/jobs/fortnightly-reminders` each Monday at 9:00 AM in `Asia/Kolkata`. The application checks each recipient's last successful delivery and sends only after 14 days, which creates the alternate-Monday schedule and ensures a newly added institutional account can receive its first report.

If any recipient delivery fails, the Cron API returns HTTP 502. Cloud Scheduler should be configured for two retries after the initial request, with increasing delays, producing at most three attempts for that recipient and report. Successful recipients are protected by per-recipient idempotency and are not resent during a retry; only unsuccessful recipients remain eligible.

After the third failed attempt, the service sends a no-patient-information delivery-failure report to `REMINDER_FAILURE_RECIPIENT_EMAIL`, which defaults to `vaishnavi.joshi@tanuh.ai`. The alert identifies the report type, institution, intended recipient, attempt count, report date, and last error. Cloud Monitoring must also alert the rollout owner because an SMTP-wide outage can prevent the failure email itself from being delivered; that secondary failure is retained in the audit row.

Delivery audit rows are retained for 365 days by default. Old rows are removed automatically when the job runs. The audit contains aggregate metrics, recipient, status, attempt count, timestamps, and errors, but no patient identifiers or clinical records.

Use either Cloud Scheduler or the provided systemd timer, never both.
