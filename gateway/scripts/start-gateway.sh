#!/bin/zsh
# Phase 1 local gateway start wrapper.
# Replace placeholders during the documented launchd setup; do not commit the rendered script.
set -euo pipefail

PROJECT_DIRECTORY="/Users/inunity/Local_server"
NODE_BINARY="/Users/inunity/.local/bin/node"
ENVIRONMENT_FILE="$PROJECT_DIRECTORY/gateway/.env"

if [[ ! -f "$ENVIRONMENT_FILE" ]]; then
  print -u2 "Missing gateway/.env. Copy gateway/.env.example and create local secrets first."
  exit 1
fi

cd "$PROJECT_DIRECTORY"
exec "$NODE_BINARY" --env-file="$ENVIRONMENT_FILE" gateway/src/index.mjs
