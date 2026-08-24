#!/usr/bin/env bash
# setup-gcp.sh — One-time GCP infrastructure setup for BCD Portal
#
# Prerequisites:
#   - gcloud CLI authenticated as a project owner/editor
#   - APIs enabled: secretmanager, iam, artifactregistry, compute
#
# Usage:
#   chmod +x infra/setup-gcp.sh
#   ./infra/setup-gcp.sh
#
# After running this script:
#   1. Stop the VM, then restart it (required for the attached SA to take effect)
#   2. Run ./infra/create-secrets.sh to populate Secret Manager
#   3. Set VM_INSTANCE and VM_ZONE in .github/workflows/deploy.yml
#   4. Set GCP_PROJECT_NUMBER as a GitHub Actions variable
#   5. Delete gcp-service-account.json from the VM and this repo

set -euo pipefail

PROJECT_ID="bcd-prototypes"
SERVICE_ACCOUNT="tanuh-bcd-portal@${PROJECT_ID}.iam.gserviceaccount.com"
REGION="asia-south1"
VM_INSTANCE="instance-20260521-104425"
VM_ZONE="asia-south1-c"

if [ -z "$VM_INSTANCE" ] || [ -z "$VM_ZONE" ]; then
  echo "ERROR: Set VM_INSTANCE and VM_ZONE at the top of this script."
  echo ""
  echo "Find your VM:"
  echo "  gcloud compute instances list --project=${PROJECT_ID}"
  exit 1
fi

echo "=== Enabling required APIs ==="
gcloud services enable \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  iam.googleapis.com \
  --project="${PROJECT_ID}"

echo ""
echo "=== Phase 1: Attach Service Account to VM ==="
echo "Attaching ${SERVICE_ACCOUNT} to ${VM_INSTANCE}..."
echo "NOTE: The VM must be STOPPED first. Stop it now? (y/n)"
read -r STOP_VM
if [ "$STOP_VM" = "y" ]; then
  gcloud compute instances stop "${VM_INSTANCE}" \
    --zone="${VM_ZONE}" --project="${PROJECT_ID}"
fi

gcloud compute instances set-service-account "${VM_INSTANCE}" \
  --service-account="${SERVICE_ACCOUNT}" \
  --scopes=cloud-platform \
  --zone="${VM_ZONE}" --project="${PROJECT_ID}"

echo "Starting VM..."
gcloud compute instances start "${VM_INSTANCE}" \
  --zone="${VM_ZONE}" --project="${PROJECT_ID}"

echo ""
echo "=== Granting IAM roles to Service Account ==="

# Service Account Token Creator — required for signed URL generation without a key file
gcloud iam service-accounts add-iam-policy-binding "${SERVICE_ACCOUNT}" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="${PROJECT_ID}"

# Secret Manager access
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"

# Artifact Registry reader (for docker pull on the VM)
gcloud artifacts repositories add-iam-policy-binding bcd-portal \
  --location="${REGION}" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/artifactregistry.reader" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "AR repo not yet created — will be created below"

echo ""
echo "=== Phase 2: Create Artifact Registry Repository ==="
gcloud artifacts repositories create bcd-portal \
  --repository-format=docker \
  --location="${REGION}" \
  --description="BCD Portal Docker images" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "Artifact Registry repo already exists"

# Grant AR writer for the SA (for GitHub Actions push)
gcloud artifacts repositories add-iam-policy-binding bcd-portal \
  --location="${REGION}" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/artifactregistry.writer" \
  --project="${PROJECT_ID}"

echo ""
echo "=== Phase 3: Workload Identity Federation for GitHub Actions ==="

# Get project number
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')
echo "Project number: ${PROJECT_NUMBER}"

# Create WIF pool
gcloud iam workload-identity-pools create github-pool \
  --location=global \
  --display-name="GitHub Actions Pool" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "WIF pool already exists"

# Create OIDC provider for GitHub
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --display-name="GitHub Provider" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "WIF provider already exists"

# Allow the GitHub repo to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding "${SERVICE_ACCOUNT}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/tanuh-bcd/bcd_portal" \
  --project="${PROJECT_ID}"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Run ./infra/create-secrets.sh to populate Secret Manager"
echo "  2. In .github/workflows/deploy.yml, set:"
echo "     VM_INSTANCE: ${VM_INSTANCE}"
echo "     VM_ZONE: ${VM_ZONE}"
echo "  3. In GitHub repo settings > Variables, add:"
echo "     GCP_PROJECT_NUMBER = ${PROJECT_NUMBER}"
echo "  4. Delete gcp-service-account.json from the VM:"
echo "     gcloud compute ssh ${VM_INSTANCE} --zone=${VM_ZONE} --project=${PROJECT_ID} -- 'rm -f ~/bcd_portal/gcp-service-account.json'"
echo "  5. Test: push to main and check GitHub Actions"
