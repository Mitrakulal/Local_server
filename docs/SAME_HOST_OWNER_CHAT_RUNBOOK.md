# Same-host Public Mattr Chat Runbook

## What this release adds

This release adds a small public Mattr Chat experience at the root of the existing public hostname while retaining the protected developer API path:

```text
https://google.mattrlabs.online/      → public Mattr Chat
https://google.mattrlabs.online/v1    → existing developer API
```

The release allows up to **three simultaneous public chat generations**. Visitors do not enter a manager key. Conversations remain only in each browser session; the release does not create public accounts, save server-side transcripts, or expose the internal gateway key in browser code.

> Do not change the Cloudflare Tunnel YAML until the local tests in this runbook have passed. Current public API access must remain on port 8787 until port 3001 has been proven locally.

## 1. Synchronize and build on the Mac mini

```bash
cd ~/Local_server
git pull origin main
pnpm install
pnpm chat:build
```

The build may warn about a large front-end bundle because the existing testing interface includes code-highlighting assets. A successful build still ends with `Done`.

## 2. Create the internal public-chat key and policy

`CHAT_GATEWAY_KEY` is a separate internal gateway identity that the server uses for public chat; it is never pasted into a browser. It must have a three-active-request allowance, a 2,048-token maximum, and an explicit daily/request-rate policy.

Run this exact block on the Mac mini. It creates one new `public-chat` gateway key, stores the raw key in the protected environment file without printing it, and replaces only the public-chat router variables.

```bash
cd ~/Local_server

CHAT_KEY_JSON="$(node --env-file=gateway/.env gateway/src/keys.mjs create \
  --tenant=public-chat \
  --label='Internal same-host public chat' \
  --expires-days=90 \
  --max-output=2048 \
  --active-limit=3 \
  --rpm-limit=60 \
  --daily-request-limit=500)"

CHAT_GATEWAY_KEY="$(printf '%s' "$CHAT_KEY_JSON" | sed -n 's/^[[:space:]]*"api_key":[[:space:]]*"\([^"]*\)".*/\1/p')"
if [ -z "$CHAT_GATEWAY_KEY" ]; then
  echo 'Could not create the private chat gateway key. No environment change was made.'
  exit 1
fi

TEMP_ENV="gateway/.env.chat.tmp"
grep -v -E '^(CHAT_GATEWAY_KEY|PUBLIC_CHAT_SEATS|PUBLIC_CHAT_STANDARD_MAX_OUTPUT|PUBLIC_CHAT_LONG_MAX_OUTPUT|CHAT_ROUTER_PORT)=' gateway/.env > "$TEMP_ENV"
printf '\nCHAT_GATEWAY_KEY=%s\nPUBLIC_CHAT_SEATS=3\nPUBLIC_CHAT_STANDARD_MAX_OUTPUT=1024\nPUBLIC_CHAT_LONG_MAX_OUTPUT=2048\nCHAT_ROUTER_PORT=3001\n' \
  "$CHAT_GATEWAY_KEY" >> "$TEMP_ENV"
mv "$TEMP_ENV" gateway/.env
chmod 600 gateway/.env

unset CHAT_KEY_JSON CHAT_GATEWAY_KEY
```

The internal `CHAT_GATEWAY_KEY` stays only in `gateway/.env`. Never send it in chat, paste it into a screenshot, or use it as a customer API key.

## 3. Start and test port 3001 locally

Start the router in a foreground Mac mini terminal:

```bash
cd ~/Local_server
pnpm chat:start
```

Expected startup output:

```text
Same-host chat router running on http://127.0.0.1:3001/
```

Keep that terminal open. On Windows, open a separate PowerShell window:

```powershell
ssh -N -L 3001:127.0.0.1:3001 mac
```

Open the local test address in Windows:

```text
http://127.0.0.1:3001/
```

The public workspace should open directly without a login screen. Confirm the green `Live capacity · 0 / 3 active` label appears, send one standard prompt, select `Long · 2K`, and confirm another streamed response arrives. Conversations remain in each browser session only.

Confirm the status endpoint separately:

```powershell
curl.exe http://127.0.0.1:3001/chat/api/status
```

It must report `active: 0`, `limit: 3`, `standard_max_output: 1024`, and `long_max_output: 2048` while idle.

In a second Windows PowerShell window, prove the API is preserved through port 3001:

```powershell
curl.exe -i http://127.0.0.1:3001/healthz
```

It must return `200` and the familiar gateway JSON. A regular `/v1/chat/completions` request through `http://127.0.0.1:3001/v1` must still use a normal customer `gma_live_...` key.

## 4. Make the router persistent only after local testing

After the local tests pass, stop the foreground `pnpm chat:start` process with `Ctrl+C`, then create its user-level service:

```bash
cd ~/Local_server

PROJECT_DIRECTORY="$HOME/Local_server"
NODE_BINARY="$(command -v node)"
NODE_DIRECTORY="$(dirname "$NODE_BINARY")"
PNPM_BINARY="$(command -v pnpm)"

sed \
  -e "s|__PROJECT_DIRECTORY__|$PROJECT_DIRECTORY|g" \
  -e "s|__NODE_DIRECTORY__|$NODE_DIRECTORY|g" \
  -e "s|__PNPM_BINARY__|$PNPM_BINARY|g" \
  gateway/scripts/start-chat-router.sh.template \
  > gateway/scripts/start-chat-router.sh

chmod 700 gateway/scripts/start-chat-router.sh

if grep -q '__[A-Z_]*__' gateway/scripts/start-chat-router.sh; then
  echo 'Template substitution failed; do not start the service.'
  exit 1
fi

sed -e "s|__PROJECT_DIRECTORY__|$PROJECT_DIRECTORY|g" \
  gateway/launchd/com.inunity.gemma-chat-router.plist.template \
  > "$HOME/Library/LaunchAgents/com.inunity.gemma-chat-router.plist"

launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.inunity.gemma-chat-router.plist" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.inunity.gemma-chat-router.plist"
launchctl kickstart -k "gui/$(id -u)/com.inunity.gemma-chat-router"

sleep 3
curl -s http://127.0.0.1:3001/healthz
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

The listener must show `127.0.0.1:3001`. View service logs with:

```bash
tail -n 100 ~/Local_server/gateway/logs/chat-router.out.log
tail -n 100 ~/Local_server/gateway/logs/chat-router.err.log
```

## 5. Cloudflare routing and public verification

The current `google.mattrlabs.online` tunnel route already targets port 3001. Keep the hostname unchanged and retain the earlier port-8787 configuration backup as rollback.

```yaml
- hostname: google.mattrlabs.online
  service: http://127.0.0.1:3001
```

This is the only tunnel YAML change. The port-3001 router forwards `/v1/*` and `/healthz` to the old protected gateway, so developer clients keep the same base URL.

Before wider promotion, add the pending Cloudflare edge rate rules for the public chat completion path and customer API path. The chat has a server-enforced three-seat limit, but edge rules still reduce wasteful traffic before it reaches the host.

After the router update, restart the chat-router service and test both:

```powershell
curl.exe -i https://google.mattrlabs.online/healthz
```

and the root chat page in the browser. Confirm a normal authenticated API request to `https://google.mattrlabs.online/v1/chat/completions` still streams.

## Rollback

If either chat or API verification fails after cutover, restore the service target to the known-good gateway value:

```yaml
- hostname: google.mattrlabs.online
  service: http://127.0.0.1:8787
```

Validate and restart Cloudflare Tunnel again. The existing API returns to the pre-chat configuration immediately; the raw llama.cpp port remains private throughout.
