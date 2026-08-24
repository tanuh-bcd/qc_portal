#!/bin/bash

# Load environment variables from .env file if it exists
if [ -f ".env" ]; then
  echo "Loading environment variables from .env..."
  set -a
  source .env
  set +a
fi

# Set PYTHONPATH to the current directory to ensure backend modules are findable
export PYTHONPATH=$PYTHONPATH:.

# Setup SSL certificates from environment variables if they are provided
echo "Setting up SSL certificates..."
if [ -n "$SERVER_CA" ]; then
  python3 backend/src/db/setup_certs.py "$SERVER_CA" "server-ca.pem"
else
  echo "SERVER_CA environment variable not set, skipping server-ca.pem creation."
fi

if [ -n "$CLIENT_CERT" ]; then
  python3 backend/src/db/setup_certs.py "$CLIENT_CERT" "client-cert.pem"
else
  echo "CLIENT_CERT environment variable not set, skipping client-cert.pem creation."
fi

if [ -n "$CLIENT_KEY" ]; then
  python3 backend/src/db/setup_certs.py "$CLIENT_KEY" "client-key.pem"
else
  echo "CLIENT_KEY environment variable not set, skipping client-key.pem creation."
fi

# Start the backend server using uvicorn
echo "Starting the backend server..."
uvicorn backend.src.main:app --host 0.0.0.0 --port 8000 --reload
