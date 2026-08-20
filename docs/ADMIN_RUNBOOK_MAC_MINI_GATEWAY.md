# Mac mini Local LLM Gateway Administrator Runbook

**Applies to:** the Mac mini running Gemma E2B through llama.cpp and the protected Node.js gateway in `~/Local_server`.  
**Current gateway address:** `http://127.0.0.1:8787`.  
**Current llama.cpp address:** `http://127.0.0.1:8080`.  
**Public model name for API users:** `gemma-e2b`.  
**Model behind the gateway:** `ggml-org/gemma-4-E2B-it-GGUF:Q8_0`.

> **Read this first:** the model server is private infrastructure. Keep llama.cpp on `127.0.0.1:8080` permanently. When public access is enabled later, Cloudflare must route only to the gateway on `127.0.0.1:8787`—never directly to port `8080`.

This is the single day-to-day guide for the owner of the Mac mini. It uses **placeholders** only. Do not place real API keys, `gateway/.env`, `GATEWAY_KEY_PEPPER`, or `GATEWAY_ADMIN_TOKEN` in GitHub, screenshots, chat, or a shared document.

## 1. Plain-language map

| Part | Address | Purpose | Who may reach it now |
|---|---|---|---|
| llama.cpp router | `127.0.0.1:8080` | Runs the Gemma model. | Mac mini only. |
| Protected gateway | `127.0.0.1:8787` | Checks API keys and limits before forwarding a valid request to llama.cpp. | Mac mini only; laptop through SSH tunnel. |
| Testing dashboard | `127.0.0.1:3000` | Runs the multi-user test interface. | Mac mini only; laptop through SSH tunnel. |
| Future public API hostname | Cloudflare Tunnel to port `8787` | Phase 2 public API route. | **Not configured yet.** |

The gateway is the security guard. It permits only authenticated, bounded work: one active generation per API key and four active generations globally. A fifth interactive request receives `429 capacity_busy` rather than entering a long invisible queue.

## 2. Standard working position

Run administrative commands after logging in to the Mac mini:

```bash
cd ~/Local_server
git pull origin main
```

Check the folder and installed Node version:

```bash
pwd
node --version
ls gateway
```

The expected project folder is `/Users/inunity/Local_server` (or the equivalent path for the Mac account). Node 22 or newer is required because the gateway uses Node’s built-in SQLite interface.

## 3. Check the model before checking the gateway

The gateway cannot work if llama.cpp is unavailable. Check the local model router:

```bash
curl -s http://127.0.0.1:8080/v1/models
```

The model list must include:

```text
ggml-org/gemma-4-E2B-it-GGUF:Q8_0
```

Check that the router listens only on localhost:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

The output must show `127.0.0.1:8080`. If the model is not running, start or repair the existing llama.cpp router before changing the gateway.

## 4. One-time gateway environment setup

Skip this section if `gateway/.env` already exists and the gateway health check works. Do **not** recreate this file casually: changing `GATEWAY_KEY_PEPPER` makes every existing API key unverifiable and therefore unusable.

Check whether the file exists and has private permissions:

```bash
cd ~/Local_server
ls -l gateway/.env
```

For a first install only, create the file with fresh local-only secrets:

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

| Setting | Current safe starting value | Meaning |
|---|---:|---|
| `GATEWAY_GLOBAL_CONCURRENT` | `4` | Maximum active model generations across all keys. |
| `GATEWAY_PER_KEY_CONCURRENT` | `1` | One active long generation per key; prevents one user monopolising the model. |
| `GATEWAY_DEFAULT_MAX_OUTPUT` | `512` | Standard invited-user output limit. |
| `GATEWAY_ABSOLUTE_MAX_OUTPUT` | `8192` | Owner-only ceiling based on the model configuration. |
| `GATEWAY_DEFAULT_RPM` | `6` | Default requests-per-minute allowance per key. |
| `GATEWAY_DEFAULT_DAILY_REQUESTS` | `50` | Default daily request allowance per key. |

## 5. Health checks and temporary foreground start

Use these commands at any time to check the gateway:

```bash
curl -s http://127.0.0.1:8787/healthz
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

Expected health response:

```json
{"status":"ok","model":"gemma-e2b","backend":"reachable"}
```

Expected listener: `127.0.0.1:8787`, never `*:8787` or `0.0.0.0:8787`.

For an initial local-only test, start the gateway in the foreground:

```bash
cd ~/Local_server
node --env-file=gateway/.env gateway/src/index.mjs
```

Leave that terminal open. Stop this temporary process with `Ctrl+C`. Once the persistent service in the next section is installed, do **not** also run a second foreground copy.

## 6. Persistent gateway service: launchd

The gateway needs to keep running when an SSH terminal closes. macOS `launchd` handles this. The gateway was observed healthy on port 8787, but this section must be completed and verified before treating it as an SSH-independent service.

> **Important correction:** the generated templates contain placeholders written with **two underscore characters**: `__PROJECT_DIRECTORY__` and `__NODE_BINARY__`. The `sed` commands below must use those exact underscore placeholders. Do not replace them with `**PROJECT_DIRECTORY**` or `**NODE_BINARY**`; that would leave an invalid path in the generated service files.

First generate or regenerate the wrapper and service definition:

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
```

Confirm that no unreplaced placeholder remains. This command should print **nothing**:

```bash
grep -n '__PROJECT_DIRECTORY__\|__NODE_BINARY__' \
  gateway/scripts/start-gateway.sh \
  "$HOME/Library/LaunchAgents/com.inunity.gemma-gateway.plist"
```

Load and start the service:

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.inunity.gemma-gateway.plist" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.inunity.gemma-gateway.plist"
launchctl kickstart -k "gui/$(id -u)/com.inunity.gemma-gateway"

sleep 3
launchctl print "gui/$(id -u)/com.inunity.gemma-gateway"
curl -s http://127.0.0.1:8787/healthz
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

The `launchctl print` output must describe `com.inunity.gemma-gateway`; the health endpoint must be `ok`; and `lsof` must show `127.0.0.1:8787`.

### Service controls and logs

| Task | Command |
|---|---|
| Restart after a gateway code change | `launchctl kickstart -k "gui/$(id -u)/com.inunity.gemma-gateway"` |
| Inspect service state | `launchctl print "gui/$(id -u)/com.inunity.gemma-gateway"` |
| Read recent normal log output | `tail -n 100 ~/Local_server/gateway/logs/gateway.out.log` |
| Read recent error output | `tail -n 100 ~/Local_server/gateway/logs/gateway.err.log` |
| Stop and remove service registration | `launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.inunity.gemma-gateway.plist"` |
| Confirm port after restart | `lsof -nP -iTCP:8787 -sTCP:LISTEN` |

To prove that the service survives an SSH disconnect, first run the health check. Then exit the SSH terminal normally, reconnect, and run the same health check again. A successful response after reconnecting proves the service did not depend on the prior terminal.

## 7. Create API keys

Every user receives a different API key. The gateway stores only a keyed hash, so it prints a raw key **once** at creation. Copy it straight into a password manager and never paste it into chat or a screenshot.

### Standard invited-user key

```bash
cd ~/Local_server
node --env-file=gateway/.env gateway/src/keys.mjs create \
  --tenant=invite-01 \
  --label="Invited user 01" \
  --expires-days=30
```

This type receives the standard 512-token output limit.

### Private owner long-output key

```bash
cd ~/Local_server
node --env-file=gateway/.env gateway/src/keys.mjs create \
  --tenant=owner-private \
  --label="Owner private 8K key" \
  --expires-days=30 \
  --max-output=8192
```

This key is for your private testing. It allows up to 8,192 output tokens but still follows the one-active-request-per-key and four-global-active-request protections.

## 8. View, revoke, and rotate keys

### View active-key metadata safely

This command lists only non-secret metadata. It does **not** show raw API keys or stored hashes.

```bash
cd ~/Local_server
node --env-file=gateway/.env gateway/src/keys.mjs list --status=active
```

View all active and revoked records:

```bash
node --env-file=gateway/.env gateway/src/keys.mjs list --status=all
```

### Revoke one key by its safe prefix

Use this when an API key appeared in a screenshot, terminal paste, chat message, or another location you do not fully control. Use only its prefix, never the full raw key:

```bash
node --env-file=gateway/.env gateway/src/keys.mjs revoke \
  --prefix=gma_live_EXAMPLE
```

An exposed test credential from the earlier tests must be treated as compromised. Existing private keys that were never shown anywhere may remain active.

### Deactivate every active key

Use this only for a complete reset, such as before a public launch. It disables **all** active keys, including the owner key.

```bash
cd ~/Local_server
node --env-file=gateway/.env gateway/src/keys.mjs revoke-all \
  --confirm=REVOKE_ALL_ACTIVE_KEYS
```

Then check that no active keys remain:

```bash
node --env-file=gateway/.env gateway/src/keys.mjs list --status=active
```

### Verify that an old exposed key is rejected

This avoids adding the raw old secret directly to shell history:

```bash
read -s OLD_KEY
printf '\n'

curl -sS -o /dev/null -w 'Old-key HTTP status: %{http_code}\n' \
  http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OLD_KEY" \
  -d '{"model":"gemma-e2b","stream":false,"max_tokens":8,"messages":[{"role":"user","content":"Reply with OK."}]}'

unset OLD_KEY
```

Expected result: `Old-key HTTP status: 401`.

## 9. Test the gateway locally

Replace `PASTE_NEW_KEY_LOCALLY` only in your own terminal. Do not publish the resulting command history or screenshot.

```bash
curl -N http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer PASTE_NEW_KEY_LOCALLY' \
  -d '{
    "model":"gemma-e2b",
    "stream":true,
    "max_tokens":128,
    "messages":[{"role":"user","content":"Reply in one sentence: the protected local gateway is working."}]
  }'
```

You should receive streamed `data:` events. Gemma may send `reasoning_content` before normal answer text; that is expected.

Run the automated gateway checks after changing gateway code:

```bash
cd ~/Local_server
npx pnpm@10.4.1 gateway:test
```

The suite verifies invalid-key blocking, SSE forwarding, same-key fairness, the four-active global capacity rule, output bounds, and safe key inventory/bulk revocation.

## 10. Use the dashboard from the Windows laptop through SSH

Start the dashboard on the Mac mini when needed:

```bash
cd ~/Local_server
npx pnpm@10.4.1 exec vite --host 127.0.0.1 --port 3000
```

From Windows PowerShell, open a private tunnel to the dashboard and gateway:

```powershell
ssh -N -L 3000:127.0.0.1:3000 -L 8787:127.0.0.1:8787 mac
```

Open `http://localhost:3000` in the Windows browser. For gateway tests, use the following values:

| Dashboard field | Value |
|---|---|
| Endpoint base URL | `http://127.0.0.1:8787/v1` |
| Model name | `gemma-e2b` |
| API key | A private test or invited-user key, entered locally only. |
| Smoke test output cap | `128` |
| Standard customer output cap | `512` |

The successful validated result is four separate keys generating concurrently while the fifth is shown as the expected `capacity_busy` protection block. Do not use one key for the five-key capacity test; one key is intentionally limited to one active request.

To close the tunnel or dashboard, press `Ctrl+C` in the relevant terminal.

## 11. Local metrics

The metrics endpoint is owner-only and must remain local. Retrieve it on the Mac mini:

```bash
cd ~/Local_server
ADMIN_TOKEN=$(grep '^GATEWAY_ADMIN_TOKEN=' gateway/.env | cut -d= -f2-)
curl -s http://127.0.0.1:8787/metrics -H "X-Admin-Token: $ADMIN_TOKEN"
unset ADMIN_TOKEN
```

The gateway logs request metadata only. It should not store prompt text, answer text, or raw API keys.

## 12. Update procedure

When a documented gateway update is available:

```bash
cd ~/Local_server
git pull origin main
npx pnpm@10.4.1 gateway:test
launchctl kickstart -k "gui/$(id -u)/com.inunity.gemma-gateway"
sleep 3
curl -s http://127.0.0.1:8787/healthz
```

If the update changes either launchd template, regenerate the wrapper and plist using **Section 6** before restarting the service.

## 13. Troubleshooting

| Symptom | Meaning | Safe first action |
|---|---|---|
| Health response says `backend: unreachable` | The gateway runs, but llama.cpp is unavailable. | Check `curl -s http://127.0.0.1:8080/v1/models`. |
| No process is listening on 8787 | Gateway service is not running. | Run `launchctl print ...` and inspect `gateway.err.log`. |
| `Address already in use` in gateway log | A foreground gateway or older service owns port 8787. | Identify it with `lsof`; do not launch a second process. Use `launchctl kickstart` for the service. |
| `401 invalid_api_key` | Key is unknown, expired, or revoked. | List active metadata; create a replacement key if appropriate. |
| `429 key_concurrency_exceeded` | The same key has an active generation. | Wait for its current stream to finish; issue separate user keys. |
| `429 capacity_busy` | Four active requests are already admitted. | Retry later; this is healthy protection, not a llama.cpp failure. |
| `422 output_limit_exceeded` | Request asks for more tokens than the key allows. | Use `512` for normal keys or the private owner 8K key where appropriate. |
| Service file uses placeholder text | The template substitution command was typed incorrectly. | Regenerate it with the exact **underscore** commands in Section 6. |

## 14. Phase 2 public-exposure gate

Do **not** create a public Cloudflare route until every item below is true.

| Required condition | Status to verify |
|---|---|
| llama.cpp remains private | `lsof` shows `127.0.0.1:8080`. |
| Gateway remains private locally | `lsof` shows `127.0.0.1:8787`. |
| Persistent service works | Health check still succeeds after an SSH disconnect and reconnect. |
| Exposed test keys handled | Every key ever shown outside your private records is revoked. |
| Fresh user keys created | Each user has a separate new key, stored privately. |
| Cloudflare destination selected | Tunnel target will be `http://127.0.0.1:8787`, never port 8080. |
| Admin isolation planned | Metrics access must use a separate protected admin hostname or remain local. |
| Edge limits planned | Add a coarse Cloudflare rate rule before inviting external users. |

When these requirements are complete, the next documented work is configuring the Cloudflare Tunnel route and edge protection. That is a separate controlled step; it is not performed by the commands in this runbook.

## 15. Daily 60-second checks

```bash
curl -s http://127.0.0.1:8787/healthz
lsof -nP -iTCP:8080 -sTCP:LISTEN
lsof -nP -iTCP:8787 -sTCP:LISTEN
launchctl print "gui/$(id -u)/com.inunity.gemma-gateway" >/dev/null && echo "launchd service registered"
```

All checks should show a healthy gateway and loopback-only listeners. If any line looks different, resolve it before changing public networking or issuing a new customer key.

## Related documents

| Document | Use it for |
|---|---|
| [`gateway/README.md`](../gateway/README.md) | Focused Stage 1 gateway setup and command reference. |
| [`PHASE1_LOCAL_GATEWAY_VALIDATION.md`](PHASE1_LOCAL_GATEWAY_VALIDATION.md) | Evidence that the local smoke, fairness, and five-key capacity tests passed. |
| [`LAPTOP_TO_MAC_MINI_TESTING.md`](LAPTOP_TO_MAC_MINI_TESTING.md) | Detailed laptop SSH-tunnel and dashboard testing guide. |
| [`PHASE1_PROTECTED_GATEWAY_BLUEPRINT.md`](PHASE1_PROTECTED_GATEWAY_BLUEPRINT.md) | Detailed gateway architecture, policy, and staged rollout design. |
