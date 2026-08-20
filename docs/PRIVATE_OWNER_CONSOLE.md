# Private Owner Console

## Purpose and security boundary

The private Owner Console adds an administrator page to the existing **port-3000** dashboard. It is for the Mac mini owner only. It exposes real gateway operational data, not customer prompts or secret material.

> **Do not add `google.mattrlabs.online`, port 3000, `/admin`, `/admin/api`, or `/metrics` to a Cloudflare public hostname.** The public hostname continues to expose only the customer API through port 8787.

The console uses two separate secrets. The browser holds the owner-console token in memory only for the current session. The local port-3000 server verifies that token, then adds `GATEWAY_ADMIN_TOKEN` itself while talking to the loopback gateway. The browser does not receive `GATEWAY_ADMIN_TOKEN`, and the gateway does not store raw customer keys.

| Component     | Address                              | Who can reach it               | Purpose                                          |
| ------------- | ------------------------------------ | ------------------------------ | ------------------------------------------------ |
| Customer API  | `https://google.mattrlabs.online/v1` | Customers with a valid API key | OpenAI-compatible Gemma completions.             |
| Gateway       | `127.0.0.1:8787`                     | Mac mini and SSH tunnel only   | Enforces API key, capacity, and request policy.  |
| Owner Console | `127.0.0.1:3000/admin`               | Owner over SSH tunnel only     | Usage, key metadata, server health, and testing. |
| llama.cpp     | `127.0.0.1:8080`                     | Mac mini only                  | Raw inference runtime.                           |

## One-time setup

On the Mac mini, create a dedicated owner-console token. Do not reuse an existing customer API key or the gateway admin token.

```bash
cd ~/Local_server

OWNER_CONSOLE_TOKEN=$(openssl rand -hex 32)
printf '\nOWNER_CONSOLE_TOKEN=%s\n' "$OWNER_CONSOLE_TOKEN" >> gateway/.env
chmod 600 gateway/.env
```

Store the resulting `OWNER_CONSOLE_TOKEN` in a password manager. It is the value you will paste once into the private console login screen. Never paste it into chat, a screenshot, GitHub, or a customer application.

Start the private dashboard with the same environment file as the gateway:

```bash
cd ~/Local_server
pnpm admin:start
```

This command binds Vite to `127.0.0.1:3000`. Keep this terminal open while using the console. A permanent `launchd` service can be added after the console is validated.

## Connect from Windows

Open one Windows PowerShell terminal and keep this SSH tunnel running:

```powershell
ssh -N -L 3000:127.0.0.1:3000 -L 8787:127.0.0.1:8787 mac
```

Then open this address in the Windows browser:

```text
http://127.0.0.1:3000/admin
```

Paste the owner-console token when asked. The browser keeps it only in current React memory; refreshing, closing the tab, or navigating away locks the console again.

## What the console shows

The Owner Console reads the gateway’s SQLite metadata ledger. It shows the current active-generation count, the four-request gateway limit, backend health, active/revoked key counts, per-key daily request usage, reported output tokens, enforcement results, timings, expiry, and key policy values. It never displays raw historical API keys, API-key hashes, customer prompts, or model answers.

Use **Customers & keys** to create a key, note the raw value one time in a password manager, then share it with the intended customer through an appropriate private channel. Use **Revoke** to disable one prefix immediately for new requests. Use **Request activity** to diagnose `429`, `4xx`, `5xx`, latency, and completion-cap events.

The original `/` page remains the private **Load Lab**. Use it for controlled one-user, fairness, and capacity tests after changing inference or policy settings. Do not use it as a customer portal.

## Troubleshooting

| Symptom                                                  | Meaning and next action                                                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Owner console secrets are not configured`               | Add a 32+ character `OWNER_CONSOLE_TOKEN` to `gateway/.env`, then restart `pnpm admin:start`.                                                        |
| Login returns `Owner-console authentication is required` | Re-enter the owner-console token exactly; do not use a `gma_live_...` customer key.                                                                  |
| Console says gateway administration is unavailable       | Confirm the gateway is healthy at `http://127.0.0.1:8787/healthz` on the Mac mini, then confirm `pnpm admin:start` was launched with `gateway/.env`. |
| Browser cannot open port 3000                            | Ensure the SSH command includes `-L 3000:127.0.0.1:3000` and that `pnpm admin:start` is running on the Mac mini.                                     |

## Operational rule

Keep the port-3000 Owner Console private over SSH until you deliberately build a separate Cloudflare Access-protected admin hostname. The public customer API and the owner console are different security surfaces.
