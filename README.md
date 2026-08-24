# Tanuh BCD Website

This repository contains the codebase for the Tanuh BCD website, a platform designed for hospital management and data collection. The project is organized into several key modules, including AI, backend, database, and frontend.

## Project Structure

The repository is organized into the following main directories:

- **AI/**: Contains AI-related source code, datasets, models, and experimentation notebooks.
- **backend/**: Core backend logic, API endpoints, database management, and data validation schemas.
- **database/**: SQL schema definitions, version-controlled migrations, and seed data.
- **frontend/**: React-based frontend application, including reusable components, pages, and assets.
- **old_resources/**: Historical assets and data used as a reference during development.

### Detailed Directory Overview

#### AI
- `data/`: Datasets and data processing scripts.
- `models/`: Trained models and architecture definitions.
- `notebooks/`: Jupyter notebooks for research and testing.
- `src/`: Core AI logic.
- `tests/`: Unit and integration tests for AI components.

#### backend
- `src/`: Core source code.
  - `api/`: API endpoints and routing logic.
  - `core/`: Core configurations and logic.
  - `db/`: Database session and connection management.
  - `models/`: Backend data models (ORM).
  - `schemas/`: Pydantic models for data validation.
- `migrations/`: Database schema migration scripts.
- `tests/`: Backend test suite.

#### database
- `schemas/`: SQL definitions for the database structure.
- `migrations/`: Version-controlled database change logs.
- `seeds/`: Initial data for development and testing environments.

#### frontend
- `public/`: Static files (index.html, etc.).
- `src/`: React source code.
  - `assets/`: Images (logos), styles, and localized resources (locales).
  - `components/`: Reusable UI components (e.g., Footer).
  - `pages/`: Individual view components (e.g., LoginPage).
  - `hooks/`, `services/`, `utils/`: Frontend logic and helper functions.
- `tests/`: Component and end-to-end tests.

## Key Features

### Frontend
- **Login Page**: A specialized login screen featuring:
  - Header with Tanuh and IISc logos.
  - Form fields for Hospital Name, Role selection, Email, and Password.
  - "Forgot password / Reset password" functionality.
- **Footer**: A responsive footer with clickable social media icons (Website, LinkedIn, Twitter, YouTube) linked to URLs defined in environment variables.
- **Localization**: Supports multiple languages (Bengali, English, Gujarati, Hindi, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil, Telugu) with dedicated JSON files for consent forms, questionnaires, and thank-you messages.

## Configuration

The project uses a common `.env` file located in the root directory to manage environment variables across all modules.

The frontend is configured to automatically copy this file to the `frontend/` directory during `npm start` or `npm run build` using `prestart` and `prebuild` hooks. This ensures that the environment variables are always in sync with the root configuration without requiring manual copying or symbolic links.

### Environment Variables
The following variables are used by the frontend:
- `REACT_APP_WEBSITE_URL`
- `REACT_APP_LINKEDIN_URL`
- `REACT_APP_TWITTER_URL`
- `REACT_APP_YOUTUBE_URL`

## Setup and Development

### Prerequisites
- Node.js (for frontend)
- Python (for backend/AI)

### Getting Started
1. Clone the repository.
2. Configure the `.env` file in the root directory with the necessary URLs and credentials.
3. To start the backend application, run the provided starter script from the root directory:
   ```bash
   ./be_starter.sh
   ```
4. To start the frontend application, run the provided starter script from the root directory:
   ```bash
   ./fe_starter.sh
   ```
5. Follow the specific setup instructions in each module's directory (where available).

## GCS Storage Structure

All clinical files are stored in the `breast-cancer-image-dataset` bucket under the following folder hierarchy:

```
breast-cancer-image-dataset/
  tanuh-data-capture/
    consent/                  ← Signed consent form photos (captured before subject registration)
    {clinic_id}/
      {subject_id}/
        mammogram/            ← Mammography CC Left/Right, MLO Left/Right DICOM images
        mammogram-report/     ← Mammography reading/report PDFs
        ultrasound/           ← Breast Ultrasound (USG Breast) DICOM/images
        ultrasound-report/    ← Breast Ultrasound (USG Breast) reading/report PDFs
        biopsy/               ← Biopsy report PDFs
        annotation/           ← Annotated mammography DICOMs (per view)
```

### File Naming Convention

```
{clinic_id}_{subject_id}_{file_type}_{upload_date}.{extension}
```

Examples:
- `clinic_00003_subject_00010_mammo_cc_left_20260521.dcm`
- `clinic_00003_subject_00010_mammo_reading_20260521.pdf`
- `clinic_00003_subject_00010_us_video_20260521.dcm`
- `clinic_00003_subject_00010_us_reading_20260521.pdf`
- `clinic_00003_subject_00010_biopsy_reading_20260521.pdf`
- `clinic_00003_subject_00010_annot_cc_left_20260521.dcm`
- `clinic_00003_subject_00010_consent_20260521.jpg`

For multiple files of the same type (e.g. multiple DICOM slices), a sequence number is appended: `mammo_dicom-1`, `mammo_dicom-2`, etc.

### Database Reference

File metadata (URL, filename, type, MIME type) is stored in the `attachments` table in `bcd_application2`, linked to `doctor_assessments` via `assessment_id`.

```sql
SELECT file_type, file_name, storage_url FROM attachments WHERE assessment_id = ?;
```
