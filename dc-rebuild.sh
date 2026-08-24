#!/usr/bin/env bash
# dc-rebuild.sh — Stop, remove, build, and start (up -d) a docker compose service
# Usage:
#   ./dc-rebuild.sh              # apply to all services in docker-compose.yml
#   ./dc-rebuild.sh web          # apply only to the "web" service
#   ./dc-rebuild.sh <service>    # apply to a specific service
#
# Notes:
# - Run from the repository root (where docker-compose.yml lives).
# - Requires Docker and docker compose (v2+) installed.
set -euo pipefail

# Ensure docker-compose.yml exists in current directory
if [[ ! -f "docker-compose.yml" ]]; then
  echo "Error: docker-compose.yml not found in current directory: $(pwd)" >&2
  exit 1
fi

# Verify docker compose availability
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker CLI not found in PATH" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: 'docker compose' (v2) not available. Please install/update Docker." >&2
  exit 1
fi

SERVICE=${1:-}

set -x
# Stop and remove containers + volumes
if [[ -n "$SERVICE" ]]; then
  docker compose stop "$SERVICE" || true
  docker compose rm -f "$SERVICE" || true
else
  docker compose down --remove-orphans || true
fi

# Remove old/dangling images to free disk space
docker image prune -f || true

# Build fresh images (no cache)
if [[ -n "$SERVICE" ]]; then
  docker compose build --no-cache "$SERVICE"
else
  docker compose build --no-cache
fi

# Start containers in detached mode
if [[ -n "$SERVICE" ]]; then
  docker compose up -d "$SERVICE"
else
  docker compose up -d
fi

# Remove any leftover dangling images from the build
docker image prune -f || true
set +x

# Redeploy Apache config
if [[ -f "./deploy-apache.sh" ]]; then
  echo "Updating Apache configuration on host..."
  sudo ./deploy-apache.sh
fi

echo "Done."