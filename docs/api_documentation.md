### 2. `docs/api_documentation.md`

This file provides a blueprint for the authentication and multi-tenancy API endpoints.

```markdown
# API Documentation

This document outlines the primary API endpoints for authentication and user management.

## Authentication Endpoints

### Login
- **URL**: `/api/v1/auth/login`
- **Method**: `POST`
- **Request Body**:
  ```json
  {
    "hospital_name": "City General",
    "role": "doctor",
    "email": "user@example.com",
    "password": "your_secure_password"
  }
  ```
- **Description**: Validates user credentials against the specific hospital and role.
- **Success Response**: 
  - **Code**: 200 OK
  - **Body**: JWT Token containing `user_id`, `hospital_id`, and `role`.

### Reset Password
- **URL**: `/api/v1/auth/reset-password`
- **Method**: `POST`
- **Request Body**: `{"email": "user@example.com"}`
- **Description**: Triggers a password reset flow for the specified user.

## Security Standards
1. **JWT Authentication**: All protected routes require a `Bearer <token>` in the Authorization header.
2. **Password Hashing**: Backend must use `bcrypt` or `Argon2` before storing passwords.
3. **CORS**: Restricted to the frontend domain defined in `.env`.
```
