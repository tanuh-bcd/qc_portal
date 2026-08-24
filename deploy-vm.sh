#!/usr/bin/env bash
# deploy-vm.sh — Manual deploy BCD Portal to GCP VM
#
# NOTE: Prefer GitHub Actions (push to main) for deployments.
#       This script is for manual/emergency deploys only.
#
# Prerequisites:
#   - VM has an attached service account with cloud-platform scope
#   - Secrets are stored in Google Secret Manager
#   - Docker + Docker Compose installed on the VM
#   - Artifact Registry images are built by GitHub Actions
#
# Usage:
#   gcloud compute ssh <INSTANCE_NAME> --zone=<ZONE> --project=bcd-prototypes
#   # Then on the VM:
#   cd ~/bcd_portal && ./deploy-vm.sh

set -euo pipefail

echo "=== BCD Portal Manual Deployment ==="

# 1. Pull latest code
if [ -d ".git" ]; then
  echo "Pulling latest code..."
  git pull origin main
else
  echo "ERROR: Run this script from the bcd_portal repo root."
  exit 1
fi

# 2. Authenticate Docker to Artifact Registry
echo "Configuring Docker for Artifact Registry..."
gcloud auth configure-docker asia-south1-docker.pkg.dev --quiet

# 3. Pull and start containers
echo "Pulling latest images and restarting..."
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml down 2>/dev/null || true
docker compose -f docker-compose.prod.yml up -d

# Clean up old images
docker image prune -f

# 4. Verify
echo ""
echo "Waiting for services to start..."
sleep 10

if curl -sf http://localhost:8000/api/health | grep -q "healthy"; then
  echo "Backend: OK"
else
  echo "Backend: FAILED"
  docker compose -f docker-compose.prod.yml logs backend --tail=20
fi

if curl -sf http://localhost/ | grep -q "root"; then
  echo "Frontend: OK"
else
  echo "Frontend: FAILED"
  docker compose -f docker-compose.prod.yml logs frontend --tail=20
fi

echo ""
echo "=== Deployment Complete ==="
