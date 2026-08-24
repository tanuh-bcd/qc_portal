To save a scanned copy of a physical consent form in Google Cloud Platform (GCP) and track it in your database with a URL, you can follow these architectural and implementation steps:

### 1. Storage in GCP: Google Cloud Storage (GCS)
The best place to save scanned documents (images or PDFs) in GCP is **Google Cloud Storage (GCS)**. It is highly scalable, secure, and cost-effective.

*   **Bucket Creation**: Create a private bucket (e.g., `tanuh-patient-consents`).
*   **Organization**: Store files using a structured naming convention, for example: `consents/{hospital_id}/{session_id}_{timestamp}.pdf`.
*   **Access Control**: Ensure the bucket is not public. Use **Signed URLs** or **Identity and Access Management (IAM)** to provide temporary or authorized access to the files.

### 2. Tracking in the Database
To track the file in your database, you should store the metadata and the reference (URL or Path) to the stored object.

#### Database Schema Update
You can add a `consent_records` table or update your `sessions` table (if you have one) to include a reference to the scanned file. Based on your current schema in `backend/src/models/models.py`, here is a recommended structure:

```sql
CREATE TABLE `patient_sessions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `hospital_id` INT NOT NULL,
  `consent_scanned_url` TEXT NULL,
  `consent_timestamp` TIMESTAMP NULL,
  `snehita_brisk_score` FLOAT NULL,
  `tryrer_risk` FLOAT NULL,
  `gail_risk` FLOAT NULL,
  PRIMARY KEY (`id`),
  INDEX `hospital_id` (`hospital_id`)
);
```

#### Saving the URL
It is recommended to store the **GCS path** (e.g., `gs://tanuh-patient-consents/path/to/file.pdf`) or a **relative path** rather than a full public URL. This gives you the flexibility to generate **Signed URLs** in the backend whenever a user (like a doctor or admin) needs to view the document.

### 3. Implementation Flow
1.  **Frontend (Consent Page)**: 
    *   Add a file upload input in `Consent.js` to allow scanning/uploading the physical document.
    *   When the user clicks "Accept", upload the file to your backend.
2.  **Backend (FastAPI)**:
    *   Receive the file in a new endpoint (e.g., `POST /api/v1/patient/consent`).
    *   Upload the file to Google Cloud Storage using the `google-cloud-storage` Python library.
    *   After a successful upload, get the GCS URI or object path.
    *   Save this path into your MySQL database associated with the current session/patient.
3.  **Retrieval**:
    *   When an admin or doctor views the record, the backend fetches the GCS path from the DB.
    *   The backend generates a **Signed URL** (a temporary URL valid for 15-60 minutes) and sends it to the frontend.
    *   The frontend displays the document using this temporary URL.

### 4. Code Snippet Example (Backend)
```python
from google.cloud import storage

def upload_to_gcs(file_content, destination_blob_name):
    storage_client = storage.Client()
    bucket = storage_client.bucket("tanuh-patient-consents")
    blob = bucket.blob(destination_blob_name)
    blob.upload_from_string(file_content)
    return blob.name # Store this in the DB
```

By using this approach, you maintain a clear link between the physical document and the digital session while keeping the data secure within the GCP ecosystem.