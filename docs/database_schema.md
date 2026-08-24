### 1. `database_schema.md`

This file outlines the MySQL structure for multi-hospital support and Role-Based Access Control (RBAC).

```markdown
# Database Schema Design

This document describes the database structure for the Tanuh BCD platform, supporting multi-tenancy (multiple hospitals) and Role-Based Access Control (RBAC).

## Core Tables

### 1. `hospitals`
Stores the entities using the platform.
- `id` (INT, PK, Auto Increment): Unique identifier for the hospital.
- `name` (VARCHAR): Official name of the hospital.
- `address` (TEXT): Physical location.
- `created_at` (TIMESTAMP): Record creation time.

### 2. `roles`
Defines available system roles.
- `id` (INT, PK, Auto Increment): Unique identifier for the role.
- `name` (VARCHAR): Role name (e.g., 'Admin', 'Doctor', 'Staff').

### 3. `users`
Stores user credentials and links them to a specific hospital.
- `id` (INT, PK, Auto Increment): Unique user ID.
- `hospital_id` (INT, FK): References `hospitals(id)`.
- `role_id` (INT, FK): References `roles(id)`.
- `email` (VARCHAR, Unique): Login identifier.
- `password_hash` (VARCHAR): Securely hashed password (bcrypt/Argon2).
- `full_name` (VARCHAR): User's display name.
- `is_active` (BOOLEAN): Status of the account.

## SQL Implementation

```sql
CREATE TABLE hospitals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hospital_id INT,
    role_id INT,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
    FOREIGN KEY (role_id) REFERENCES roles(id)
);
```



