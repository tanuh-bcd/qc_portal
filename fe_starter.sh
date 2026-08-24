#!/bin/bash

# Navigate to the frontend directory
cd frontend || exit

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
  echo "node_modules not found. Installing dependencies..."
  npm install
fi

# Load environment variables from the root .env file if it exists
if [ -f "../.env" ]; then
  echo "Loading environment variables from root .env..."
  set -a
  source ../.env
  set +a
fi

# Start the development server
echo "Starting the frontend application..."
npm start
