#!/bin/zsh
# Same-host owner chat: load local secrets, then run the loopback-only router.
set -euo pipefail

cd "/Users/inunity/Local_server"
export PATH="/Users/inunity/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
exec /Users/inunity/.local/bin/pnpm chat:start
