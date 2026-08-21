# Same-host Owner Chat Runbook

## What this release adds

This release adds a ChatGPT-style owner chat at the root of the existing public hostname while retaining the developer API path:

```text
https://google.mattrlabs.online/      → owner chat
https://google.mattrlabs.online/v1    → existing developer API
```

The release is **owner-only**. It has one conversation stored only in the current browser session. It does not create public user accounts, save server-side transcripts, or expose a gateway key in the browser.

> Do not change the Cloudflare Tunnel YAML until the local tests in this runbook have passed. Current public API access must remain on port 8787 until port 3001 has been proven locally.

## 1. Synchronize and build on the Mac mini

```bash
cd ~/Local_server
git pull origin main
pnpm install
pnpm chat:build
```

The build may warn about a large front-end bundle because the existing testing interface includes code-highlighting assets. A successful build still ends with `Done`.

## 2. Create the two chat-only secrets

`OWNER_CHAT_TOKEN` unlocks the browser chat for you. `CHAT_GATEWAY_KEY` is a separate internal gateway identity that the server uses for chat; it is never pasted into the browser.

Run this exact block on the Mac mini. It makes one new `owner-chat` gateway key, stores the raw key in the protected environment file without printing it, replaces any previous chat variables, and prints only the owner login token once.

```bash
cd ~/Local_server

CHAT_KEY_JSON="$(node --env-file=gateway/.env gateway/src/keys.mjs create \
  --tenant=owner-chat \
  --label='Internal same-host owner chat' \
  --expires-days=90 \
  --max-output=512)"

CHAT_GATEWAY_KEY="$(printf '%s' "$CHAT_KEY_JSON" | sed -n 's/^[[:space:]]*"api_key":[[:space:]]*"\([^"]*\)".*/\1/p')"
if [ -z "$CHAT_GATEWAY_KEY" ]; then
  echo 'Could not create the private chat gateway key. No environment change was made.'
  exit 1
fi

OWNER_CHAT_TOKEN="$(openssl rand -hex 32)"
TEMP_ENV="gateway/.env.chat.tmp"
grep -v -E '^(OWNER_CHAT_TOKEN|CHAT_GATEWAY_KEY|OWNER_CHAT_MAX_OUTPUT|CHAT_ROUTER_PORT)=' gateway/.env > "$TEMP_ENV"
printf '\nOWNER_CHAT_TOKEN=%s\nCHAT_GATEWAY_KEY=%s\nOWNER_CHAT_MAX_OUTPUT=512\nCHAT_ROUTER_PORT=3001\n' \
  "$OWNER_CHAT_TOKEN" "$CHAT_GATEWAY_KEY" >> "$TEMP_ENV"
mv "$TEMP_ENV" gateway/.env
chmod 600 gateway/.env

printf '\nSAVE THIS OWNER CHAT TOKEN IN YOUR PASSWORD MANAGER:\n%s\n\n' "$OWNER_CHAT_TOKEN"
unset CHAT_KEY_JSON CHAT_GATEWAY_KEY OWNER_CHAT_TOKEN
```

Copy the displayed `OWNER_CHAT_TOKEN` into your password manager. Do not send it in chat, paste it into a screenshot, or use it as an API key. The internal `CHAT_GATEWAY_KEY` stays only in `gateway/.env`.

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

Paste the owner chat token at the screen, send one short prompt, and confirm a streamed response arrives. The conversation remains in the present browser session only.

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
PNPM_BINARY="$(command -v pnpm)"

sed \
  -e "s|__PROJECT_DIRECTORY__|$PROJECT_DIRECTORY|g" \
  -e "s|__PNPM_BINARY__|$PNPM_BINARY|g" \
  gateway/scripts/start-chat-router.sh.template \
  > gateway/scripts/start-chat-router.sh

chmod 700 gateway/scripts/start-chat-router.sh

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

## 5. Cloudflare Tunnel cutover — perform later, with a backup

Only after the local chat and `/v1` tests have passed, change the existing `google.mattrlabs.online` tunnel rule from port 8787 to port 3001. Keep the hostname unchanged.

```yaml
- hostname: google.mattrlabs.online
  service: http://127.0.0.1:3001
```

This is the only tunnel YAML change. The port-3001 router forwards `/v1/*` and `/healthz` to the old protected gateway, so developer clients keep the same base URL.

Before this cutover, add the pending Cloudflare edge rate rule. The owner-chat login screen will be publicly reachable after the cutover, so edge abuse protection should be in place first.

After saving the YAML, validate it, restart `com.cloudflare.cloudflared`, reconnect SSH if the tunnel restart briefly drops it, and test both:

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
