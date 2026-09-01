# QC Database Sync — Complete Documentation

## What This Is

The QC portal (`qc_portal`) needs its own independent copy of the BCD portal's data so it can operate without any runtime dependency on the original BCD databases. This document covers everything that was set up on Google Cloud SQL to achieve that.

**Cloud SQL Instance:** `bcd-prototypes:asia-south1:tanuh-bcd-questionnaire-dev`
**Host IP:** `35.234.220.201`
**MySQL User Used:** `read_user` (see [Important: About read_user Permissions](#important-about-read_user-permissions))

---

## Database Architecture

All four databases live on the **same Cloud SQL instance**:

```
Cloud SQL Instance (35.234.220.201)
│
├── bcd_application2          ← BCD portal's main database (ORM-managed)
├── bcd_questionnaire         ← BCD portal's public questionnaire database (raw SQL)
│
├── qc_bcd_portal             ← QC portal's main database (synced copy + QC-only tables)
└── qc_bcd_questionnaire      ← QC portal's questionnaire database (synced copy)
```

**BCD databases** (`bcd_application2`, `bcd_questionnaire`) are the source of truth. The BCD portal writes to them. We **never** write to, alter, or modify these databases.

**QC databases** (`qc_bcd_portal`, `qc_bcd_questionnaire`) are the QC portal's own databases. They contain:
- A synced copy of BCD data (auto-updated every 5 minutes by a MySQL EVENT)
- QC-only tables and columns that don't exist in BCD

---

## Important: About `read_user` Permissions

Despite its name, `read_user` is **NOT a read-only user**. Its actual grants are:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, RELOAD, SHUTDOWN,
      PROCESS, REFERENCES, INDEX, ALTER, SHOW DATABASES,
      CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE,
      REPLICATION SLAVE, REPLICATION CLIENT, CREATE VIEW, SHOW VIEW,
      CREATE ROUTINE, ALTER ROUTINE, CREATE USER, EVENT, TRIGGER,
      CREATE TABLESPACE, CREATE ROLE, DROP ROLE
ON *.* TO `read_user`@`%` WITH GRANT OPTION

GRANT `cloudsqlsuperuser`@`%` TO `read_user`@`%`
```

**This means `read_user` has full write access to ALL databases**, including `bcd_application2` and `bcd_questionnaire`. It can INSERT, UPDATE, DELETE, CREATE tables, DROP tables, create EVENTs — everything.

The only databases where its write access is restricted are the MySQL system databases (`mysql.*` and `sys.*`).

### Why this matters

- `read_user` **CAN** write to BCD databases. The safety of BCD databases is enforced by **our code discipline**, not by database permissions.
- Every SQL statement we executed was carefully reviewed to ensure it only reads from BCD (`SELECT`) and only writes to QC databases (`INSERT`, `CREATE TABLE`, `CREATE EVENT`).
- The sync EVENT itself only does `SELECT FROM bcd_application2.*` and `INSERT INTO qc_bcd_portal.*` — never the reverse.

### Recommendation

Consider creating a truly restricted user for the QC portal's production deployment:

```sql
-- Example: a user that can only read BCD and read+write QC
CREATE USER 'qc_portal_user'@'%' IDENTIFIED BY '<password>';
GRANT SELECT ON bcd_application2.* TO 'qc_portal_user'@'%';
GRANT SELECT ON bcd_questionnaire.* TO 'qc_portal_user'@'%';
GRANT ALL PRIVILEGES ON qc_bcd_portal.* TO 'qc_portal_user'@'%';
GRANT ALL PRIVILEGES ON qc_bcd_questionnaire.* TO 'qc_portal_user'@'%';
GRANT EVENT ON *.* TO 'qc_portal_user'@'%';  -- needed for the sync EVENT
```

This would enforce BCD read-only at the permission level, not just by convention.

---

## What Was Done — Step by Step

### Phase 1: Initial Table Setup (done by colleague)

Your colleague created the initial QC databases and some tables on Cloud SQL before this work started. What already existed:

**`qc_bcd_portal` had 11 tables:**
- `qc_hospitals`, `qc_roles`, `qc_users`, `qc_machines`, `qc_questions`
- `qc_email_templates`, `qc_email_template_cc`
- `qc_patient_sessions`, `qc_doctor_assessments`, `qc_attachments`
- `qc_assignments` (QC-only table, not from BCD)

**`qc_bcd_questionnaire` had 3 tables:**
- `qc_question`, `qc_session_table`, `qc_session_data_table`

The data in these tables was **stale** — for example, `qc_doctor_assessments` had 395 rows while BCD had 772 at the time.

### Phase 2: Catch-Up Sync (first round — 12 tables)

**File:** `qc_portal/database/cloud/qc_sync_catchup.sql`

Ran a one-time `INSERT ... ON DUPLICATE KEY UPDATE` to bring all existing QC tables up to date with current BCD data. This was executed via pymysql (Python) because the `mysql` CLI wasn't available on the local machine.

**What this SQL does for each table:**
```sql
INSERT INTO qc_bcd_portal.qc_hospitals
    (qc_id, qc_name, qc_short_name, ...)
SELECT id, name, short_name, ...
FROM bcd_application2.hospitals
ON DUPLICATE KEY UPDATE
    qc_name = VALUES(qc_name), ...;
```

- `INSERT ... SELECT` copies rows from BCD → QC
- Column mapping: BCD `id` → QC `qc_id`, BCD `name` → QC `qc_name`, etc.
- `ON DUPLICATE KEY UPDATE` handles rows that already exist — updates them with latest BCD values
- QC-only columns like `qc_sub_ui_id` and `qc_assigned` are **NOT in the UPDATE clause**, so QC values are preserved

**Auto-increment safety:**
```sql
ALTER TABLE qc_bcd_portal.qc_users AUTO_INCREMENT = 10000;
ALTER TABLE qc_bcd_portal.qc_roles AUTO_INCREMENT = 100;
```

This prevents ID collisions: BCD users have IDs 1-69 (synced), QC-created users (radiologists, QC admins) get IDs starting at 10000.

### Phase 3: Create Sync EVENT (first round — 12 tables)

**File:** `qc_portal/database/cloud/qc_sync_event.sql`

Created a MySQL EVENT that runs every 5 minutes to keep QC in sync with BCD:

```sql
CREATE EVENT qc_bcd_portal.qc_sync_from_bcd
ON SCHEDULE EVERY 5 MINUTE
STARTS CURRENT_TIMESTAMP
COMMENT 'Syncs BCD portal data into QC databases every 5 minutes (17 tables)'
DO
BEGIN
    SET FOREIGN_KEY_CHECKS = 0;
    -- INSERT ... ON DUPLICATE KEY UPDATE for each table
    -- (same pattern as catch-up, but runs automatically)
    SET FOREIGN_KEY_CHECKS = 1;
END
```

**How this was created:** The EVENT was created by executing the `CREATE EVENT` SQL directly through pymysql, not via the `mysql` CLI. This is because:
1. `mysql` CLI wasn't installed on the local machine
2. pymysql doesn't support `DELIMITER $$` syntax, so the compound `BEGIN...END` statement was sent as a single execute call without delimiters

**Why `SET FOREIGN_KEY_CHECKS = 0`:** The sync needs to insert rows in bulk without worrying about FK ordering. For example, `qc_patient_responses` references `qc_patient_sessions`, but we want to sync them in a single transaction without caring which table goes first.

**What `event_scheduler = ON` means:** The MySQL event scheduler was already enabled on this Cloud SQL instance (it was turned on previously for existing BCD replication to another instance). This is a Cloud SQL instance-level flag, not something we changed.

### Phase 4: Created 7 Missing Tables

The QC portal's ORM (SQLAlchemy models in `qc_portal/backend/src/models/models.py`) defines tables that didn't exist yet on Cloud SQL. These were created directly via pymysql:

#### Tables synced from BCD (5 tables):

**1. `qc_languages`** — Language codes and names (11 rows)
- BCD source: `bcd_application2.languages`
- Columns: `qc_code` (PK, VARCHAR(5)), `qc_name` (VARCHAR(50))
- Reason: Referenced as a FK target by `qc_question_translations.qc_language_code` and `qc_question_option_translations.qc_language_code`

**2. `qc_question_options`** — Multiple-choice option values for questions (149 rows)
- BCD source: `bcd_application2.question_options`
- Columns: `qc_id` (PK), `qc_question_id` (FK → `qc_questions`), `qc_option_value`, `qc_sort_order`
- Reason: Defined in QC ORM as `QuestionOption` class, loaded via `Question.options` relationship

**3. `qc_question_translations`** — Question text in each language (440 rows)
- BCD source: `bcd_application2.question_translations`
- Columns: `qc_id` (PK), `qc_question_id` (FK → `qc_questions`), `qc_language_code` (FK → `qc_languages`), `qc_question_text`
- Unique constraint: `(qc_question_id, qc_language_code)` — one translation per language per question
- Reason: Defined in QC ORM as `QuestionTranslation` class, loaded via `Question.translations` relationship

**4. `qc_question_option_translations`** — Option labels in each language (1,634 rows)
- BCD source: `bcd_application2.question_option_translations`
- Columns: `qc_id` (PK), `qc_option_id` (FK → `qc_question_options`), `qc_language_code` (FK → `qc_languages`), `qc_option_label`
- Unique constraint: `(qc_option_id, qc_language_code)`
- Reason: Defined in QC ORM as `QuestionOptionTranslation` class, loaded via `QuestionOption.translations` relationship

**5. `qc_patient_responses`** — Individual question/answer pairs per patient session (110 rows)
- BCD source: `bcd_application2.patient_responses`
- Columns: `qc_id` (PK), `qc_hospital_id` (FK → `qc_hospitals`), `qc_session_id` (FK → `qc_patient_sessions`), `qc_question`, `qc_answer`, `qc_created_at`, `qc_updated_at`
- Note: BCD has a `question_id` FK column that the QC ORM does not define, so it was intentionally omitted from the QC table
- Reason: Defined in QC ORM as `PatientResponse` class, referenced via `PatientSession.responses` relationship

#### QC-only tables (2 tables — NOT synced from BCD):

**6. `reminder_configuration`** — Controls whether reminder emails are paused/disabled (0 rows)
- No BCD source — QC manages its own reminder configuration independently
- Columns: `id` (PK), `is_paused`, `is_disabled`, `updated_by`, `updated_at`
- Note: Table name has **no `qc_` prefix** — matches the QC ORM's `__tablename__` exactly
- Reason: Used by `qc_portal/backend/src/services/reminder_reports.py` for reminder email delivery control

**7. `reminder_email_log`** — Log of all reminder emails sent (0 rows)
- No BCD source — QC tracks its own email sends independently
- Columns: `id` (PK), `report_type`, `hospital_id` (FK → `qc_hospitals.qc_id`), `recipient_email`, `idempotency_key` (unique), `report_date`, `quarter_start`, `quarter_end`, `data_points`, `lifetime_data_points`, `assessments_submitted`, `pending_submissions`, `quarterly_target`, plus quality metric columns, `status`, `attempt_count`, `error_message`, `sent_at`, `created_at`
- Note: Table name has **no `qc_` prefix** — matches the QC ORM's `__tablename__` exactly
- Note: The `hospital_id` FK references `qc_hospitals.qc_id` (QC table), not `hospitals.id` (BCD table)
- Reason: Heavily used by `qc_portal/backend/src/services/reminder_reports.py` for tracking email delivery

### Phase 5: Catch-Up Sync (second round — 5 new tables)

After creating the 5 BCD-sourced tables above, ran a one-time `INSERT ... ON DUPLICATE KEY UPDATE` to populate them with current BCD data. Same pattern as Phase 2.

### Phase 6: Updated Sync EVENT (12 → 17 tables)

Dropped the existing EVENT and re-created it with all 17 synced tables:

```sql
DROP EVENT IF EXISTS qc_bcd_portal.qc_sync_from_bcd;
CREATE EVENT qc_bcd_portal.qc_sync_from_bcd ...
```

The updated EVENT now syncs these 17 tables every 5 minutes:

| # | BCD Source Table | QC Target Table | Database |
|---|---|---|---|
| 1 | `hospitals` | `qc_hospitals` | `qc_bcd_portal` |
| 2 | `roles` | `qc_roles` | `qc_bcd_portal` |
| 3 | `users` | `qc_users` | `qc_bcd_portal` |
| 4 | `machines` | `qc_machines` | `qc_bcd_portal` |
| 5 | `languages` | `qc_languages` | `qc_bcd_portal` |
| 6 | `questions` | `qc_questions` | `qc_bcd_portal` |
| 7 | `question_options` | `qc_question_options` | `qc_bcd_portal` |
| 8 | `question_translations` | `qc_question_translations` | `qc_bcd_portal` |
| 9 | `question_option_translations` | `qc_question_option_translations` | `qc_bcd_portal` |
| 10 | `email_templates` | `qc_email_templates` | `qc_bcd_portal` |
| 11 | `email_template_cc` | `qc_email_template_cc` | `qc_bcd_portal` |
| 12 | `patient_sessions` | `qc_patient_sessions` | `qc_bcd_portal` |
| 13 | `patient_responses` | `qc_patient_responses` | `qc_bcd_portal` |
| 14 | `doctor_assessments` | `qc_doctor_assessments` | `qc_bcd_portal` |
| 15 | `attachments` | `qc_attachments` | `qc_bcd_portal` |
| 16 | `session_table` | `qc_session_table` | `qc_bcd_questionnaire` |
| 17 | `session_data_table` | `qc_session_data_table` | `qc_bcd_questionnaire` |

**Tables NOT synced (and why):**

| Table | Why not synced |
|---|---|
| `qc_assignments` | QC-only — radiologist case assignments, no BCD equivalent |
| `reminder_configuration` | QC-only — QC manages its own reminder settings |
| `reminder_email_log` | QC-only — QC tracks its own email sends |
| `bcd_questionnaire.answer` | Legacy BCD table, not referenced by QC ORM |
| `bcd_questionnaire.sections` | Legacy BCD table, not referenced by QC ORM |
| `bcd_application2.reminder_configuration` | Not synced because QC has its own independent copy |
| `bcd_application2.reminder_email_log` | Not synced because QC has its own independent copy |

### Phase 7: Added `Language` ORM Class

**File changed:** `qc_portal/backend/src/models/models.py`

Added a missing SQLAlchemy model class:

```python
class Language(Base):
    __tablename__ = "qc_languages"
    qc_code = Column(String(5), primary_key=True)
    qc_name = Column(String(50), nullable=False)
```

**Why this was needed:** The `QuestionTranslation` and `QuestionOptionTranslation` models reference `ForeignKey("qc_languages.qc_code")`, but there was no corresponding `Language` class. Without it, SQLAlchemy would fail to resolve the FK target when the ORM initializes.

---

## Tables — Final State

### `qc_bcd_portal` (18 tables)

| Table | Source | Synced? | Row Count | Notes |
|---|---|---|---|---|
| `qc_hospitals` | `bcd_application2.hospitals` | Every 5 min | 18 | |
| `qc_roles` | `bcd_application2.roles` | Every 5 min | 3 | AUTO_INCREMENT = 100 |
| `qc_users` | `bcd_application2.users` | Every 5 min | 70 | AUTO_INCREMENT = 10000; QC-only column `qc_assigned` preserved during sync |
| `qc_machines` | `bcd_application2.machines` | Every 5 min | 18 | |
| `qc_languages` | `bcd_application2.languages` | Every 5 min | 11 | |
| `qc_questions` | `bcd_application2.questions` | Every 5 min | 44 | |
| `qc_question_options` | `bcd_application2.question_options` | Every 5 min | 149 | |
| `qc_question_translations` | `bcd_application2.question_translations` | Every 5 min | 440 | |
| `qc_question_option_translations` | `bcd_application2.question_option_translations` | Every 5 min | 1,634 | |
| `qc_email_templates` | `bcd_application2.email_templates` | Every 5 min | 7 | |
| `qc_email_template_cc` | `bcd_application2.email_template_cc` | Every 5 min | 8 | |
| `qc_patient_sessions` | `bcd_application2.patient_sessions` | Every 5 min | 40 | |
| `qc_patient_responses` | `bcd_application2.patient_responses` | Every 5 min | 110 | |
| `qc_doctor_assessments` | `bcd_application2.doctor_assessments` | Every 5 min | 773+ | QC-only column `qc_sub_ui_id` preserved during sync |
| `qc_attachments` | `bcd_application2.attachments` | Every 5 min | 4,108+ | |
| `qc_assignments` | None (QC-only) | No | 141 | Radiologist case assignments |
| `reminder_configuration` | None (QC-only) | No | 0 | No `qc_` prefix in table name |
| `reminder_email_log` | None (QC-only) | No | 0 | No `qc_` prefix in table name |

### `qc_bcd_questionnaire` (3 tables)

| Table | Source | Synced? | Row Count |
|---|---|---|---|
| `qc_question` | Pre-existing | Unknown | 43 |
| `qc_session_table` | `bcd_questionnaire.session_table` | Every 5 min | 1,967+ |
| `qc_session_data_table` | `bcd_questionnaire.session_data_table` | Every 5 min | 40,789+ |

---

## Column Naming Convention

All synced QC tables use a `qc_` prefix on column names to distinguish them from the BCD originals:

| BCD Column | QC Column |
|---|---|
| `id` | `qc_id` |
| `name` | `qc_name` |
| `hospital_id` | `qc_hospital_id` |
| `created_at` | `qc_created_at` |
| etc. | etc. |

Exception: `reminder_configuration` and `reminder_email_log` use **original column names** (no `qc_` prefix) because they are QC-only tables that match the existing ORM class definitions exactly.

---

## Sync Behavior Details

### What happens every 5 minutes

The MySQL EVENT `qc_sync_from_bcd` runs automatically and for each of the 17 tables does:

```sql
INSERT INTO qc_bcd_portal.qc_<table> (qc_col1, qc_col2, ...)
SELECT col1, col2, ...
FROM bcd_application2.<table>
ON DUPLICATE KEY UPDATE
    qc_col1 = VALUES(qc_col1), ...;
```

### QC-only columns are preserved

Two tables have QC-only columns that don't exist in BCD:

- `qc_doctor_assessments.qc_sub_ui_id` — a display ID assigned by the QC portal
- `qc_users.qc_assigned` — whether a user has been assigned QC cases

These columns are **NOT included in the `ON DUPLICATE KEY UPDATE` clause**, so their QC values survive every sync cycle. The sync only updates columns that map to BCD source columns.

### QC-only rows are preserved

The QC portal creates its own users (radiologists, QC admins) with IDs starting at 10000. BCD users have IDs < 100. Since the sync uses `INSERT ... ON DUPLICATE KEY UPDATE` keyed on the primary key (`qc_id`), QC-created rows (IDs >= 10000) are never touched by the sync.

### Deletions do NOT propagate

If a row is deleted in BCD, the corresponding QC copy is **not deleted**. The sync only inserts new rows and updates existing ones — it never deletes. This is by design, because:
- `qc_assignments` has FK references to `qc_doctor_assessments` — deleting an assessment would break assignments
- QC may have added its own data to the row (like `qc_sub_ui_id`)

### BCD databases are NEVER modified

The sync EVENT only executes `SELECT` on BCD databases. It never runs `INSERT`, `UPDATE`, `DELETE`, `ALTER`, or any other write operation on `bcd_application2` or `bcd_questionnaire`.

The BCD databases have **0 events and 0 triggers** that we created. Any existing replication or listeners on BCD databases are completely unaffected.

---

## How to Manage the Sync

### Check sync status

```sql
SELECT EVENT_NAME, STATUS, LAST_EXECUTED,
       TIMESTAMPDIFF(SECOND, LAST_EXECUTED, NOW()) AS seconds_ago
FROM information_schema.EVENTS
WHERE EVENT_SCHEMA = 'qc_bcd_portal';
```

### Temporarily pause sync

```sql
ALTER EVENT qc_bcd_portal.qc_sync_from_bcd DISABLE;
```

### Resume sync

```sql
ALTER EVENT qc_bcd_portal.qc_sync_from_bcd ENABLE;
```

### Remove sync entirely

```sql
DROP EVENT IF EXISTS qc_bcd_portal.qc_sync_from_bcd;
```

### Verify row counts match

```sql
SELECT 'hospitals' AS tbl,
       (SELECT COUNT(*) FROM bcd_application2.hospitals) AS bcd,
       (SELECT COUNT(*) FROM qc_bcd_portal.qc_hospitals) AS qc
UNION ALL SELECT 'users',
       (SELECT COUNT(*) FROM bcd_application2.users),
       (SELECT COUNT(*) FROM qc_bcd_portal.qc_users)
UNION ALL SELECT 'assessments',
       (SELECT COUNT(*) FROM bcd_application2.doctor_assessments),
       (SELECT COUNT(*) FROM qc_bcd_portal.qc_doctor_assessments)
UNION ALL SELECT 'attachments',
       (SELECT COUNT(*) FROM bcd_application2.attachments),
       (SELECT COUNT(*) FROM qc_bcd_portal.qc_attachments)
UNION ALL SELECT 'session_data',
       (SELECT COUNT(*) FROM bcd_questionnaire.session_data_table),
       (SELECT COUNT(*) FROM qc_bcd_questionnaire.qc_session_data_table);
```

QC counts may be slightly higher than BCD because QC also has its own rows (e.g., QC-created users).

---

## Files Changed in This Work

| File | What Changed | Why |
|---|---|---|
| `qc_portal/backend/src/models/models.py` | Added `Language` ORM class | FK target for `QuestionTranslation` and `QuestionOptionTranslation` was missing |
| `qc_portal/database/cloud/qc_sync_catchup.sql` | Added 5 new table upserts (languages, question_options, question_translations, question_option_translations, patient_responses) | Reference file for one-time data migration |
| `qc_portal/database/cloud/qc_sync_event.sql` | Added 5 new table syncs, updated comment to "17 tables" | Reference file for the MySQL EVENT definition |
| `qc_portal/backend/src/db/sql_compat.py` | Created `expand_in()` helper (earlier session) | Database-agnostic `IN` clause — works on MySQL, SQLite, and Cloud SQL |
| `qc_portal/backend/src/api/admin.py` | Fixed `IN :tuple` queries to use `expand_in()` (earlier session) | SQLite compatibility for local development |
| `qc_portal/backend/src/api/doctor.py` | Fixed `IN :tuple` queries + `pid.answer` → `pid.qc_answer` bug (earlier session) | SQLite compatibility + column name bug fix |
| `qc_portal/backend/src/mammogram_service.py` | Fixed `IN :tuple` queries to use `expand_in()` (earlier session) | SQLite compatibility for local development |

---

## Production Deployment

For production, the QC portal connects **only** to its own databases:

```env
MYSQL_DB=qc_bcd_portal
MYSQL_DB_QUESTIONNAIRE=qc_bcd_questionnaire
```

The QC backend code already uses QC table names (`qc_hospitals`, `qc_users`, etc.) in its ORM models and raw SQL. It has zero runtime dependency on BCD databases.

The sync EVENT runs on Cloud SQL regardless of whether the QC portal is deployed — it's a server-side scheduled job, not triggered by the application.

---

## Verification Snapshot (2026-09-01)

```
EVENT: qc_sync_from_bcd
  Status: ENABLED
  Schedule: Every 5 minutes
  Comment: Syncs BCD portal data into QC databases every 5 minutes (17 tables)

BCD databases:
  bcd_application2: 0 events, 0 triggers (untouched)
  bcd_questionnaire: 0 events, 0 triggers (untouched)

qc_bcd_portal: 18 tables (15 synced + 3 QC-only)
qc_bcd_questionnaire: 3 tables (2 synced + 1 pre-existing)
```
