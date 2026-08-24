#!/usr/bin/env bash
# create-secrets.sh — Create Secret Manager secrets for BCD Portal
#
# This script reads values from the local .env file and creates
# corresponding secrets in Google Secret Manager.
#
# Prerequisites:
#   - gcloud CLI authenticated
#   - Secret Manager API enabled (done by setup-gcp.sh)
#   - .env file exists in the project root
#
# Usage:
#   ./infra/create-secrets.sh

set -euo pipefail

PROJECT_ID="bcd-prototypes"
PREFIX="bcd-"
ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: ${ENV_FILE} not found."
  echo "Usage: ./infra/create-secrets.sh [path-to-env-file]"
  exit 1
fi

echo "=== Creating Secret Manager secrets from ${ENV_FILE} ==="
echo "Project: ${PROJECT_ID}"
echo "Prefix: ${PREFIX}"
echo ""

CREATED=0
UPDATED=0
SKIPPED=0

while IFS= read -r line; do
  # Skip empty lines and comments
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

  # Parse KEY=VALUE
  KEY=$(echo "$line" | cut -d'=' -f1 | xargs)
  VALUE=$(echo "$line" | cut -d'=' -f2- | xargs)

  # Skip lines without a key
  [ -z "$KEY" ] && continue

  SECRET_NAME="${PREFIX}${KEY}"

  # Secret Manager does not allow empty payloads — use a single space as placeholder
  if [ -z "$VALUE" ]; then
    VALUE=" "
  fi

  # Create the secret if it doesn't exist
  if gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT_ID}" &>/dev/null; then
    echo "  [update] ${SECRET_NAME}"
    echo -n "${VALUE}" | gcloud secrets versions add "${SECRET_NAME}" \
      --data-file=- --project="${PROJECT_ID}" --quiet
    UPDATED=$((UPDATED + 1))
  else
    echo "  [create] ${SECRET_NAME}"
    gcloud secrets create "${SECRET_NAME}" --project="${PROJECT_ID}" --quiet
    echo -n "${VALUE}" | gcloud secrets versions add "${SECRET_NAME}" \
      --data-file=- --project="${PROJECT_ID}" --quiet
    CREATED=$((CREATED + 1))
  fi

done < "$ENV_FILE"

echo ""
echo "=== Done ==="
echo "Created: ${CREATED}, Updated: ${UPDATED}, Skipped: ${SKIPPED}"
echo ""
echo "Verify with:"
echo "  gcloud secrets list --project=${PROJECT_ID} --filter='name:${PREFIX}'"
