# First User Setup Guide

This document explains how to create the first hospital, roles, and administrative user for the Tanuh BCD platform.

## Method 1: Automated Setup (Recommended)

The easiest way to set up the initial data is by using the provided `seed.py` script. This script will automatically create:
1.  A default hospital ("City General").
2.  Standard roles ("Admin", "Doctor", "Staff").
3.  A test user account.

### Steps:

1.  **Configure Environment**: Ensure your `.env` file in the project root has the correct database credentials.
2.  **Navigate to Project Root**:
    ```bash
    cd /Users/ashwinrajkumar/PycharmProjects/tanuh_bcd_website
    ```
3.  **Run the Seed Script**:
    ```bash
    export PYTHONPATH=$PYTHONPATH:$(pwd)/backend
    python3 -m src.seed
    ```

### Default Credentials Created:
- **Hospital**: `City General`
- **Role**: `Doctor`
- **Email**: `user@example.com`
- **Password**: `your_secure_password`

---

## Method 2: Manual Setup (SQL)

If you prefer to manually insert the data via a SQL client, follow these steps in order:

### 1. Insert Hospital
```sql
INSERT INTO hospitals (name, contact_person, email, address) 
VALUES ('City General', 'Admin', 'admin@citygeneral.com', '123 Main St');
```

### 2. Insert Roles
```sql
INSERT INTO roles (name) VALUES ('Admin'), ('Doctor'), ('Staff');
```

### 3. Insert User
*Note: The password must be hashed using bcrypt before insertion.*

```sql
-- Replace <hospital_id> and <role_id> with the IDs generated in previous steps
INSERT INTO users (hospital_id, role_id, email, password_hash, full_name, is_active) 
VALUES (1, 2, 'user@example.com', '$2b$12$LQv3c1yqBWVHxkd0LpX8OuzWzXW9B.oT0lE0wJmJ9Y2B.9u/W0/W', 'Dr. Smith', 1);
```

## Verification
To verify the setup, you can try logging in via the API `POST /api/v1/auth/login` with the credentials mentioned above.
