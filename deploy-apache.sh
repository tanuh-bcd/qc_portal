#!/bin/bash

# Ensure the script is run with sudo
if [ "$EUID" -ne 0 ]; then
  echo "Please run this script with sudo: sudo ./deploy-apache.sh"
  exit 1
fi

echo "🔄 Copying apache configuration to /etc/apache2/sites-available/..."
cp deploy/apache/bc-screener-research-prod.conf /etc/apache2/sites-available/

echo "✅ Copied successfully."

echo "🔄 Enabling the site configuration if not already enabled..."
a2ensite bc-screener-research-prod.conf

echo "🔄 Reloading Apache gracefully to apply changes..."
systemctl reload apache2

echo "🎉 Apache updated and reloaded with the new configuration!"
