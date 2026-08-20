# Stage 1 local protected gateway

This directory contains the **local-only** Phase 1 gateway for the selected Gemma E2B llama.cpp model. It is intentionally not a public service yet. During Stage 1, it binds only to `127.0.0.1:8787` and connects only to the loopback llama.cpp router at `127.0.0.1:8080`.

> Keep llama.cpp on `127.0.0.1:8080`. Do not map port `8080` through Cloudflare Tunnel. The future tunnel points to this gateway on port `8787`, after all Stage 1 tests pass.

## What the gateway enforces

| Control | Stage 1 value | Result |
|---|---:|---|
| Global active generations | 4 | The fifth interactive request receives `429 capacity_busy`; it is not sent to llama.cpp. |
| Active generations per customer key | 1 | A second overlapping request from the same key receives `429 key_concurrency_exceeded`. |
| Standard maximum output | 512 tokens | Keeps initial interactive use bounded. |
| Absolute output maximum | 8,192 tokens | Cannot exceed the measured model context ceiling. |
| Request body maximum | 256 KiB | Oversized JSON is rejected before model dispatch. |
| Text-only scope | Enabled | Tools, functions, attachments, and raw model IDs are rejected. |
| Key storage | HMAC-SHA-256 with local server pepper | Raw customer API keys are printed once and never stored. |
| Request logging | Metadata only | No prompt text, answer text, or raw customer secrets are stored. |

## 1. Prepare the Mac mini

Pull the current repository and ensure the selected Gemma router is running locally first.

```bash
cd ~/Local_server
git pull origin main
curl -s http://127.0.0.1:8080/v1/models
```

The model list must include:

```text
ggml-org/gemma-4-E2B-it-GGUF:Q8_0
```

## 2. Create the local environment file

Run this on the Mac mini. It creates two separate random local secrets and gives the file owner-only permissions.

```bash
cd ~/Local_server
KEY_PEPPER=$(openssl rand -hex 32)
ADMIN_TOKEN=$(openssl rand -hex 32)

cat > gateway/.env <<EOF
GATEWAY_BIND_HOST=127.0.0.1
GATEWAY_PORT=8787
LLAMA_BASE_URL=http://127.0.0.1:8080/v1
LLAMA_BACKEND_MODEL=ggml-org/gemma-4-E2B-it-GGUF:Q8_0
GATEWAY_PUBLIC_MODEL=gemma-e2b
GATEWAY_KEY_PEPPER=$KEY_PEPPER
GATEWAY_ADMIN_TOKEN=$ADMIN_TOKEN
GATEWAY_DATA_DIR=./gateway/data
GATEWAY_GLOBAL_CONCURRENT=4
GATEWAY_PER_KEY_CONCURRENT=1
GATEWAY_DEFAULT_MAX_OUTPUT=512
GATEWAY_ABSOLUTE_MAX_OUTPUT=8192
GATEWAY_MAX_BODY_BYTES=262144
GATEWAY_MAX_MESSAGES=64
GATEWAY_MAX_INPUT_CHARACTERS=24000
GATEWAY_REQUEST_TIMEOUT_MS=120000
GATEWAY_RATE_BURST=2
GATEWAY_DEFAULT_RPM=6
GATEWAY_DEFAULT_DAILY_REQUESTS=50
GATEWAY_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
EOF

chmod 600 gateway/.env
mkdir -p gateway/logs gateway/data
```

Never commit, upload, or paste `gateway/.env` into chat. Keep the displayed `ADMIN_TOKEN` only in your private operator records; it protects the local metrics endpoint.

## 3. Start and verify locally

Start the gateway in an SSH terminal. This is a foreground process for the first test.

```bash
cd ~/Local_server
node --env-file=gateway/.env gateway/src/index.mjs
```

In a **second** Mac mini SSH terminal, verify health:

```bash
curl -s http://127.0.0.1:8787/healthz
```

Expected healthy response:

```json
{"status":"ok","model":"gemma-e2b","backend":"reachable"}
```

## 4. Create the first invited-user key

Open another Mac mini terminal and run:

```bash
cd ~/Local_server
node --env-file=gateway/.env gateway/src/keys.mjs create \
  --tenant=first-invite \
  --label="First invited user" \
  --expires-days=30
```

Copy the returned `api_key` once into a password manager. The database retains only its keyed hash and cannot print the raw value again.

## 5. Send a local test request

Replace `PASTE_THE_NEW_KEY` locally. Do not paste a real key into chat.

```bash
curl -N http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer PASTE_THE_NEW_KEY' \
  -d '{
    "model":"gemma-e2b",
    "stream":true,
    "max_tokens":128,
    "messages":[{"role":"user","content":"Reply in one sentence: the protected local gateway is working."}]
  }'
```

The response is llama.cpp SSE. Gemma may first stream `reasoning_content`; the gateway counts this as first meaningful output and relays it unchanged.

## 6. Test through the existing dashboard over SSH

On the Windows laptop, open the SSH tunnel with the existing dashboard port plus the new gateway port:

```powershell
ssh -N -L 3000:127.0.0.1:3000 -L 8787:127.0.0.1:8787 mac
```

In the dashboard, use the following values:

| Field | Value |
|---|---|
| Endpoint base URL | `http://127.0.0.1:8787/v1` |
| Model name | `gemma-e2b` |
| API key | The single invited-user key created above. |
| Users | 1 for the first gateway check. |
| Max output | 128 for the smoke test; 512 for standard interactive testing. |

Do not set dashboard users higher than `1` with one key. The Stage 1 gateway will correctly return `429 key_concurrency_exceeded` for the second simultaneous request from the same key. To validate the four-slot global limit, create five separate keys and use one per test client.

## 7. Local acceptance suite

Run this on the Mac mini or another Node 22+ machine after changes:

```bash
cd ~/Local_server
pnpm gateway:test
```

The suite verifies invalid-key rejection, SSE forwarding, one-active-request-per-key enforcement, fifth-request global-capacity rejection, and output-policy enforcement. Node 22 currently labels its built-in SQLite interface experimental; that warning is expected during the test run.

## 8. Metrics and key revocation

Retrieve local metrics from the Mac mini only:

```bash
cd ~/Local_server
ADMIN_TOKEN=$(grep '^GATEWAY_ADMIN_TOKEN=' gateway/.env | cut -d= -f2-)
curl -s http://127.0.0.1:8787/metrics -H "X-Admin-Token: $ADMIN_TOKEN"
```

Revoke a compromised customer key by its non-secret prefix:

```bash
cd ~/Local_server
node --env-file=gateway/.env gateway/src/keys.mjs revoke --prefix=gma_live_EXAMPLE
```

## 9. Convert the validated gateway to a user service

Only after the local tests pass, install it as a user-level macOS service. The template deliberately uses a wrapper that loads the local `.env` file instead of placing secrets inside a launchd plist.

```bash
cd ~/Local_server
NODE_BINARY=$(command -v node)
PROJECT_DIRECTORY="$HOME/Local_server"

sed \
  -e "s|__PROJECT_DIRECTORY__|$PROJECT_DIRECTORY|g" \
  -e "s|__NODE_BINARY__|$NODE_BINARY|g" \
  gateway/scripts/start-gateway.sh.template \
  > gateway/scripts/start-gateway.sh

chmod 700 gateway/scripts/start-gateway.sh

sed -e "s|__PROJECT_DIRECTORY__|$PROJECT_DIRECTORY|g" \
  gateway/launchd/com.inunity.gemma-gateway.plist.template \
  > "$HOME/Library/LaunchAgents/com.inunity.gemma-gateway.plist"

launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.inunity.gemma-gateway.plist" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.inunity.gemma-gateway.plist"
launchctl kickstart -k "gui/$(id -u)/com.inunity.gemma-gateway"
```

Confirm it remains loopback-only:

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

The output must show `127.0.0.1:8787`, not `*:8787` or `0.0.0.0:8787`.

## 10. Stage 1 exit criteria

Stage 1 is complete only when the local health check works, one key streams through the gateway, a second request with the same key receives `429`, a fifth separate active key receives `429`, metrics contain no prompt/answer text, and the user-level service survives an SSH disconnect. **Do not create a Cloudflare public route to port 8787 until these local exit criteria are met.**
