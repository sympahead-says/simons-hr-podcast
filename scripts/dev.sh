#!/bin/bash
# Startet den Dev-Server mit Secrets aus 1Password (nie auf der Platte)
# Voraussetzung: `op` CLI installiert + eingeloggt (my.1password.eu)
#
# 1Password-Pfade anpassen falls Items anders benannt sind.
# Aktuell erwartet: Vault "Dev Secrets privat", Item "HR Podcast"

exec wrangler pages dev \
  --binding "ANTHROPIC_API_KEY=$(op read 'op://Dev Secrets privat/HR Podcast/Anthropic API Key' --account my.1password.eu)" \
  --binding "GCP_API_KEY=$(op read 'op://Dev Secrets privat/HR Podcast/GCP API Key' --account my.1password.eu)" \
  -- vite
