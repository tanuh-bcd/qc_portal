# CLAUDE.md

## Project Overview

**BCD Portal (PinkShieldAI)** — a clinical breast cancer screening and data collection platform used across hospitals in India. Built by the TANUH Foundation at IISc Bengaluru under the Ministry of Education. Provides patient questionnaire collection, risk scoring, clinical assessments with DICOM/image uploads, and analytics dashboards.

**GitHub:** `tanuh-bcd/bcd_portal` (formerly `tanuh_bcd_portal`)

## Tech Stack

- **Backend:** Python 3.13, FastAPI, SQLAlchemy ORM, Gunicorn + Uvicorn (4 workers)
- **Frontend:** React 19 (Create React App), React Router v7, i18next (11 languages)
- **Database:** MySQL on Google Cloud SQL (two databases on the same instance)
- **Storage:** Google Cloud Storage for clinical files and consent images
- **Container Registry:** Artifact Registry (`asia-south1-docker.pkg.dev/bcd-prototypes/bcd-portal/`)
- **CI/CD:** GitHub Actions with Workload Identity Federation
- **Mobile:** React Native app in `react_native_app/` (Android, offline-capable with SQLite)

## Project Structure

```
backend/
  src/
    main.py                     # FastAPI app entry point
    seed.py                     # DB seed script (test hospital/users)
    api/
      auth.py                   # Login, JWT, reset-password, hospitals list
      admin.py                  # Create hospitals, users, roles (admin-only)
      doctor.py                 # Patient session list + detail (clinician view)
      patient.py                # Consent, questionnaire, assessment, file uploads
      public.py                 # Unauthenticated questionnaire flow (Snehitha risk)
      stats.py                  # Analytics dashboard data
      languages.py              # Language list endpoint
    core/
      config.py                 # Settings from .env + Secret Manager fallback
      security.py               # bcrypt hashing, JWT creation/verification
      secrets.py                # GCP Secret Manager client with in-memory cache
      email.py                  # SMTP email with DB-stored templates
    db/
      session.py                # SQLAlchemy engines (Cloud SQL Connector or direct)
    models/
      models.py                 # 12+ SQLAlchemy ORM tables
    schemas/
      schemas.py                # Pydantic request/response schemas
  tests/                        # pytest + httpx, SQLite-based fixtures
  Dockerfile                    # python:3.13-slim, Gunicorn

frontend/
  src/
    App.js                      # React Router routes
    i18n.js                     # i18next config (11 languages, 3 namespaces)
    index.js                    # Entry point, Mixpanel, SW registration
    components/
      Consent.js / .jsx         # .js = auth flow, .jsx = public flow
      Questionnaire.js / .jsx   # .js = auth (API-driven), .jsx = public (i18n JSON-driven)
      QuestionBlock.js / .jsx   # Individual question renderer
      ThankYou.js / .jsx        # Risk score with animated riskometer gauge
      DoctorAssessmentForm.js   # BIRADS, density, per-breast findings, file uploads
      ResumableUpload.js        # Two-phase signed-URL GCS upload
      MultiUpload.js            # Multi-file DICOM upload
      FileViewer.js             # DICOM/PDF/image viewer (uses dicom-parser)
      Stats.js                  # Analytics dashboard (Recharts)
      Demo.js                   # Interactive walkthrough
    pages/
      LoginPage.js              # Hospital + role + email/password login
      AdminPage.js              # Tabbed: Admin/Subject/Clinician views
      PatientPage.js            # Staff: consent → questionnaire → thankyou
      DoctorPage.js             # Clinician: subject list + assessment modal
      PublicQuestionnairePage.js # Unauthenticated questionnaire
    assets/locales/             # 11 language dirs, each with consent/questionnaire/thankyou JSON
  Dockerfile                    # node:20-alpine builder + nginx:alpine runtime
  nginx.conf                    # HTTPS, reverse proxy /api → backend:8000
  scripts/obfuscate.js          # Post-build JS obfuscation + SW fingerprinting

database/
  load_questions.sql            # DDL + seed data for question tables

infra/
  setup-gcp.sh                  # One-time GCP setup (SA, WIF, Artifact Registry, IAM)
  create-secrets.sh             # Populate Secret Manager from .env

docker-compose.yml              # Dev: build locally, backend :8000, frontend :80/:443
docker-compose.prod.yml         # Prod: pull from Artifact Registry
```

## Two-Database Architecture

The app uses **two separate MySQL databases** on the same Cloud SQL instance (`bcd-prototypes:asia-south1:tanuh-bcd-questionnaire-dev`):

### `bcd_application2` — Clinical/admin data (SQLAlchemy ORM)

| Table | Purpose |
|-------|---------|
| `hospitals` | Multi-tenant hospital entities (id like `clinic_00001`) |
| `roles` | Admin, Clinician, Staff |
| `users` | Credentials + hospital + role (unique on email+hospital+role) |
| `languages` | Supported language codes |
| `questions` | Base question definitions (section, response_type, conditional parent/trigger) |
| `question_translations` | Question text per language |
| `question_options` | Multiple-choice option values |
| `question_option_translations` | Option labels per language |
| `patient_sessions` | Subject registration (id like `subject_00001`, consent URL) |
| `patient_responses` | Individual question/answer pairs per session |
| `doctor_assessments` | Clinical data (BIRADS, density, findings JSON, risk class) |
| `attachments` | File metadata (type, name, GCS URL, mime_type) linked to assessments |
| `email_templates` | HTML email templates keyed by `template_key` |
| `email_template_cc` | CC email addresses per template |

### `bcd_questionnaire` — Public questionnaire data (raw SQL, no ORM)

| Table | Purpose |
|-------|---------|
| `session_table` | session_id (UUID), IP, timestamps, snehita_lifetime_risk, risk_category, consent_url |
| `session_data_table` | session_data_id (UUID), session_id, question text, answer, created_at |

Cross-database queries are joined in Python (not SQL joins).

## Authentication

- **JWT Bearer tokens** (HS256, 8-hour expiry) stored in `localStorage`
- **Hospital-scoped login:** user selects hospital + role + enters email/password
- **Three roles:**
  - **Staff** — consent + questionnaire data entry (`/patient`)
  - **Clinician** — subject list, clinical assessments, DICOM/image uploads (`/doctor`)
  - **Admin** — hospital and user management (`/admin`, embeds Staff + Clinician views)
- **Super admin:** Admin role at the "Test" hospital — can create new hospitals and admin accounts
- **Password reset:** self-service via hospital+role+email+new_password (no email verification)

## API Endpoints

| Prefix | Key Endpoints |
|--------|---------------|
| `POST /api/v1/auth/login` | JWT login (hospital_name + role + email + password) |
| `POST /api/v1/auth/reset-password` | Self-service password reset |
| `GET /api/v1/auth/hospitals` | List all hospitals |
| `GET /api/v1/patient/questions?lang=` | Fetch questions in a language |
| `POST /api/v1/patient/consent` | Submit consent (with photo upload to GCS) |
| `POST /api/v1/patient/questionnaire` | Submit questionnaire answers |
| `POST /api/v1/patient/assessment` | Submit clinical assessment |
| `POST /api/v1/patient/upload-url` | Get GCS signed URL for file upload |
| `POST /api/v1/patient/upload-complete` | Record uploaded file metadata |
| `GET /api/v1/patient/view-url/{id}` | Get signed URL to view a file |
| `GET /api/v1/doctor/sessions` | List patient sessions (clinician view) |
| `GET /api/v1/doctor/sessions/{id}` | Session detail with responses + assessment + files |
| `POST /api/v1/admin/hospitals` | Create hospital (super admin) |
| `POST /api/v1/admin/users` | Create user (admin) |
| `GET /api/v1/stats/` | Aggregate analytics (risk bins, hospital bins, age/month breakdown) |
| `POST /api/session/start` | Public: create session |
| `POST /api/session/{id}/consent` | Public: upload consent image |
| `POST /api/submit` | Public: submit questionnaire + calculate risk |
| `GET /api/health` | Health check |

## File Upload Pattern (Two-Phase)

1. Frontend calls `POST /api/v1/patient/upload-url` → gets GCS signed URL
2. Frontend PUTs file directly to GCS using the signed URL
3. Frontend calls `POST /api/v1/patient/upload-complete` → records metadata in `attachments` table
4. GCS path: `tanuh-data-capture/{clinic_id}/{subject_id}/{doc_type}/{filename}`

## Authentication & Secrets

- **Application Default Credentials (ADC):** VM has `tanuh-bcd-portal@bcd-prototypes.iam.gserviceaccount.com` attached
- **Secret Manager:** Config loads from env vars first, falls back to Secret Manager with `bcd-` prefix. Secrets are cached in-memory. Use `infra/create-secrets.sh` to populate from `.env`
- **WIF:** GitHub Actions authenticates via OIDC → WIF pool `github-actions` → impersonates the SA
- **No service account keys needed** in production

## Deployment

**CI/CD** (`.github/workflows/deploy.yml`):
1. WIF auth to GCP
2. Fetch frontend build vars from Secret Manager
3. Build + push backend image to Artifact Registry (tagged with SHA + `latest`)
4. Build + push frontend image to Artifact Registry (with `REACT_APP_*` build args)
5. SSH into VM → pull latest images via `docker-compose.prod.yml` → restart → health check

**VM:** `instance-20260521-104425` in `asia-south1-c`, deploy dir: `~/bcd_portal`

**Docker (prod):** pulls from Artifact Registry. Backend: Gunicorn 4 workers, 2GB/1.5CPU. Frontend: Nginx with SSL (Let's Encrypt), 512MB/0.5CPU.

**Domain:** `bc-portal-dev.tanuh.ai` (Nginx HTTPS with Let's Encrypt certs)

## Frontend Routes

| Path | Component | Auth |
|------|-----------|------|
| `/` | `PublicQuestionnairePage` | No |
| `/demo` | `Demo` (lazy) | No |
| `/stats` | `Stats` (lazy) | No |
| `/login` | `LoginPage` | No |
| `/reset-password` | `ResetPasswordPage` | No |
| `/admin` | `AdminPage` | Yes |
| `/patient` | `PatientPage` | Yes |
| `/doctor` | `DoctorPage` | Yes |

## Development

```bash
# Backend
cd backend && pip install -r requirements.txt
source ../be_starter.sh   # loads .env, sets up SSL certs, runs uvicorn --reload on :8000

# Frontend
cd frontend && npm install
source ../fe_starter.sh   # loads .env, runs npm start on :3000

# Docker (full stack)
docker compose build && docker compose up -d

# Tests
pytest   # from repo root, uses pytest.ini
```

## Important Patterns

- **Duplicate .js/.jsx components:** `.js` versions are for the auth-protected flow (API-driven questions), `.jsx` versions are for the public flow (i18n JSON-driven questions). Both coexist.
- **Boot order:** `config.py` loads env → `secrets.py` provides Secret Manager fallback → `session.py` creates SQLAlchemy engines at import time → `main.py` imports routers
- **i18n language keys** use full names (`english`, `hindi`, `kannada`), not ISO codes
- **Frontend env vars:** `react-scripts` requires `REACT_APP_*` prefix. The root `.env` is copied to `frontend/.env` by the `prestart`/`prebuild` npm hooks
- **GCS bucket:** `breast-cancer-image-dataset`, subfolder `tanuh-data-capture/`
- **Mixpanel:** optional analytics, token in `REACT_APP_MIXPANEL_TOKEN`
- **Email templates** are stored in the DB (`email_templates` table), not in code
