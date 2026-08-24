### Database Design for Role-Based Access Control (RBAC)

To build a MySQL database for multiple hospitals and users with role-based access, you need a normalized schema that establishes clear relationships between hospitals, users, and their permissions.

#### 1. Recommended Database Schema
A robust implementation typically requires the following tables:

- **`hospitals`**: Stores information about each hospital.
  - `id` (PK), `name`, `address`, `contact_details`, `created_at`.
- **`roles`**: Defines the different roles available in the system.
  - `id` (PK), `role_name` (e.g., 'Admin', 'Doctor', 'Staff').
- **`users`**: Stores user credentials and profile information.
  - `id` (PK), `hospital_id` (FK referencing `hospitals.id`), `email` (Unique), `password_hash`, `full_name`, `is_active`.
- **`user_roles`**: A mapping table to assign roles to users.
  - `user_id` (FK), `role_id` (FK).
- **`permissions`**: (Optional but recommended) For granular control.
  - `id` (PK), `permission_name` (e.g., 'edit_patient_records').
- **`role_permissions`**: Links roles to specific permissions.

#### 2. SQL Implementation Example
```sql
CREATE TABLE hospitals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hospital_id INT,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id INT,
    FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
    FOREIGN KEY (role_id) REFERENCES roles(id)
);
```

### Requirements for Creating User Logins

To ensure secure and functional logins for each user, the following requirements must be met:

1.  **Unique Identifiers**: Every user must have a unique identifier, typically an email address.
2.  **Password Security**:
    *   **Hashing**: Never store plain-text passwords. Use strong hashing algorithms like `bcrypt` or `Argon2`.
    *   **Salting**: Ensure the hashing library handles unique salts for each password.
3.  **Authentication Mechanism**: Implement a method to verify credentials, such as **JWT (JSON Web Tokens)** or Session-based authentication.
4.  **Multi-Tenancy Validation**: During login, the system must verify that the user belongs to the specific `hospital_id` they are attempting to access (as seen in your current `LoginPage.js` structure).
5.  **Role Validation**: Upon successful login, the backend should return the user's role and permissions to the frontend to control UI visibility and API access.

### Documentation Management

Yes, creating a `docs` folder is a standard best practice for project organization.

*   **Location**: It is recommended to create the `docs/` folder at the root of your project directory.
*   **Structure**:
    ```text
    /tanuh_bcd_website
    ├── docs/
    │   ├── database_schema.md
    │   ├── api_documentation.md
    │   └── user_roles_guide.md
    ├── backend/
    ├── frontend/
    └── ...
    ```
*   **Usage**: You can use this folder to store detailed Markdown files explaining the DB architecture, setup instructions, and business logic for the different hospital roles.