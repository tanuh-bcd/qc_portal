### 3. `docs/user_roles_guide.md`

This file explains the business logic and access levels for different users.

```markdown
# User Roles and Permissions Guide

This guide defines the access levels for the different roles within the Tanuh BCD platform.

## Role Definitions

### 1. Admin
- **Scope**: Hospital-wide management.
- **Capabilities**:
    - Manage hospital user accounts (Create/Deactivate).
    - View hospital-wide analytics.
    - Configure hospital-specific settings.

### 2. Doctor
- **Scope**: Patient care and screening.
- **Capabilities**:
    - Access AI-enabled screening tools.
    - View and manage patient records.
    - Submit screening data.

### 3. Staff
- **Scope**: Data entry and administrative support.
- **Capabilities**:
    - Register new patients.
    - Fill out questionnaires and consent forms.
    - Schedule screenings.

## Multi-Tenancy Logic
The system is designed so that users from **Hospital A** can never see data or users from **Hospital B**. This is enforced at the database level by the `hospital_id` foreign key on every user and patient record.
```