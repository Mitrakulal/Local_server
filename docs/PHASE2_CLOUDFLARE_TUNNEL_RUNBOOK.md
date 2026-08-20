# Phase 2 Cloudflare Tunnel Runbook: Public Gateway Access

**Purpose:** publish the protected local LLM gateway through Cloudflare without exposing the Gemma llama.cpp router.  
**Allowed origin:** `http://127.0.0.1:8787`.  
**Never publish:** llama.cpp on port `8080`, the dashboard on port `3000`, or the local `/metrics` administration endpoint.  
**Example public API hostname:** `api.example.com`; replace this with a real subdomain in every dashboard field and command below.

> **The public request path:** API client → `https://api.example.com` → Cloudflare → existing Cloudflare Tunnel → `http://127.0.0.1:8787` → private llama.cpp at `127.0.0.1:8080`.

Cloudflare Tunnel works by keeping an outbound connection from the Mac mini to Cloudflare, so a public API hostname can reach the gateway without opening an inbound router port or revealing a directly reachable origin IP.[1]

## 1. Choose the operating method

The existing tunnel should be configured through the Cloudflare dashboard unless there is a specific need to automate Cloudflare account changes. The account integration visible in this project is currently disabled, and it is not required for the safer dashboard method.

| Approach | Tradeoffs | Cost | Setup complexity |
|---|---|---|---|
| **Cloudflare dashboard with the existing tunnel** | The clearest approach; you approve every hostname and rule visually. Best for one Mac mini and one API hostname. | Uses the existing Cloudflare account and plan. | Low. |
| **Account-connected Cloudflare API automation** | Repeatable when managing many domains or rules, but gives automation access to account infrastructure and needs explicit connector approval. | Depends on the existing Cloudflare plan. | Higher. |

Use the **dashboard method** for this first Phase 2 route. Do not create a Quick Tunnel (`trycloudflare.com`) for this API: Cloudflare documents Quick Tunnels as testing-only and states that they do not support Server-Sent Events, which this gateway uses for model streaming.[2]

## 2. Mandatory pre-flight check on the Mac mini

Before adding a public hostname, connect by SSH to the Mac mini and run:

```bash
cd ~/Local_server
git pull origin main

curl -s http://127.0.0.1:8080/v1/models
curl -s http://127.0.0.1:8787/healthz
lsof -nP -iTCP:8080 -sTCP:LISTEN
lsof -nP -iTCP:8787 -sTCP:LISTEN
launchctl print "gui/$(id -u)/com.inunity.gemma-gateway"
```

The required results are:

| Check | Required result |
|---|---|
| Model list | Contains `ggml-org/gemma-4-E2B-it-GGUF:Q8_0`. |
| Gateway health | `{"status":"ok","model":"gemma-e2b","backend":"reachable"}`. |
| llama.cpp listener | `127.0.0.1:8080`, not a public bind address. |
| Gateway listener | `127.0.0.1:8787`, not a public bind address. |
| Persistent service | `launchctl print` recognizes `com.inunity.gemma-gateway`. |

Disconnect SSH normally, reconnect, and repeat the gateway health check. This is the required proof that the gateway is independent of the SSH terminal.

### API-key gate

Any API key that appeared in a screenshot, copied terminal output, chat message, or other non-private location must be revoked **before** public access. A key that has remained private in a password manager may remain active. Use the administrator runbook to inspect prefixes, revoke an exposed key, or perform a complete key reset.

## 3. Add one published application route to the existing tunnel

Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/). Go to **Networking → Tunnels**, select the existing healthy tunnel on the Mac mini, and then select **Routes → Add route → Published application**. Cloudflare’s current dashboard workflow maps a public hostname directly to a local service URL.[3]

Enter the following values:

| Dashboard field | Value |
|---|---|
| Hostname subdomain | `api` |
| Domain | Your Cloudflare-managed domain, producing `api.example.com` |
| Service type | `HTTP` |
| Service URL | `http://127.0.0.1:8787` |

Select **Add route**. Do not create routes for `http://127.0.0.1:8080`, `http://127.0.0.1:3000`, `/metrics`, SSH, or any other local service.

For a fully Cloudflare-managed DNS zone, the dashboard automatically creates the hostname DNS record. With a partial CNAME zone, create the required CNAME at the authoritative DNS provider after adding the route, following the Cloudflare route instructions.[4]

> A route points to the **gateway service URL**, not to a URL path. The local gateway decides which API paths are available. The important protection is that its upstream model router stays on loopback and is not published.

## 4. Wait for tunnel health and test the public route

Return to **Networking → Tunnels** and wait until the existing tunnel is shown as **Healthy**. From a network that is not the Mac mini, test the public health endpoint:

```powershell
curl.exe -i https://api.example.com/healthz
```

You should receive HTTP `200` and a small JSON health response. Then confirm that an unauthenticated API request is rejected:

```powershell
curl.exe -i https://api.example.com/v1/chat/completions `
  -H "Content-Type: application/json" `
  -d '{"model":"gemma-e2b","stream":false,"max_tokens":8,"messages":[{"role":"user","content":"Reply with OK."}]}'
```

The required result is HTTP `401` with the gateway’s `invalid_api_key` response. This confirms the Cloudflare route reaches the gateway rather than exposing the model directly.

Finally, use a newly created **private** API key. Paste it only in your terminal, not into a screenshot or chat:

```powershell
curl.exe -N https://api.example.com/v1/chat/completions `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer PASTE_PRIVATE_KEY_LOCALLY" `
  -d '{"model":"gemma-e2b","stream":true,"max_tokens":128,"messages":[{"role":"user","content":"Reply in one sentence: secure remote streaming works."}]}'
```

The expected result is streamed `data:` events. Do not use a Quick Tunnel for this check because it does not support SSE.[2]

## 5. Add a coarse Cloudflare edge rate rule

The gateway remains the main per-key policy enforcer: it permits one active request per key, four active requests globally, and the configured per-key request limits. The Cloudflare rule is a second, coarse **IP-based abuse brake**. It is not a replacement for gateway API keys.

In the Cloudflare dashboard, go to **Security → Security rules → Create rule → Rate limiting rules**.[5] Create this initial rule:

| Setting | Value |
|---|---|
| Rule name | `api-gateway-post-per-ip` |
| Matching expression | `http.host eq "api.example.com" and http.request.uri.path eq "/v1/chat/completions" and http.request.method eq "POST"` |
| Counting characteristic | `IP` (`ip.src`) |
| Rate | `60` requests per `1 minute` |
| Action | `Block` |
| Block response | HTTP `429`, `application/json`, body `{"error":{"code":"edge_rate_limited","message":"Too many requests. Retry later."}}` |
| Mitigation duration | `1 minute` |

The rule scope deliberately matches the exact expensive chat-completion endpoint and POST method. Cloudflare recommends matching the exact path that receives traffic, and its rate rules support IP-based counters, a 60-second period, and a custom `429` response.[5] [6]

Start at 60 requests/minute/IP because this is an outer network-abuse limit, not the customer product quota. The gateway’s default per-key rate is lower. Revisit the edge threshold after observing real customer traffic, especially if multiple legitimate users share one public IP. Available rate-limit settings can vary by Cloudflare plan.[6]

## 6. Do not put Cloudflare Access in front of the customer API hostname

The customer-facing API already requires the gateway’s `Authorization: Bearer gma_live_...` key. Applying interactive Cloudflare Access to `api.example.com` would require browsers or API clients to complete an additional Access login or present a Cloudflare service token, which breaks ordinary OpenAI-compatible clients unless you deliberately design for that second authentication layer.

Instead, use this split:

| Surface | Phase 2 decision |
|---|---|
| `api.example.com` | Public through the tunnel; protected by gateway API keys, gateway limits, and the Cloudflare edge-rate rule. |
| `/metrics` administration | Keep local-only and retrieve over SSH. Do not publish it yet. |
| Future `admin.example.com` | Only create after the gateway explicitly separates admin-host traffic; protect it with a Cloudflare Access Allow policy limited to your owner identity and MFA. Cloudflare Access applications are deny-by-default and require an explicit Allow policy.[7] |
| llama.cpp `:8080` | Never public; no Cloudflare route. |
| Dashboard `:3000` | Never public; use SSH tunnels only. |

## 7. Browser CORS warning

The current `GATEWAY_CORS_ORIGINS` setting permits only local dashboard origins. That is correct for now. Do not add `*`.

Normal API customers should call `https://api.example.com/v1` from their own backend/server, not from a browser. If you later build a trusted browser application that must call this API directly, add only that exact HTTPS origin to `GATEWAY_CORS_ORIGINS`, restart the gateway service, and recognize that browser-held API keys are inherently harder to protect.

## 8. Rollback

If the external test fails, or if you accidentally target the wrong local port, remove the published application route in **Networking → Tunnels → [your tunnel] → Routes**. This removes the public hostname mapping without changing the local gateway or llama.cpp services.

If the tunnel route is correct but traffic is unhealthy, leave both local services loopback-only, inspect the tunnel health in the dashboard, and inspect the local gateway logs:

```bash
tail -n 100 ~/Local_server/gateway/logs/gateway.out.log
tail -n 100 ~/Local_server/gateway/logs/gateway.err.log
```

## 9. Phase 2 completion record

Phase 2 is ready to close only when all of these are true:

| Requirement | Evidence |
|---|---|
| Tunnel route is gateway-only | Tunnel route service is `http://127.0.0.1:8787`. |
| Model router remains private | Mac mini shows `127.0.0.1:8080` with no Cloudflare route. |
| Gateway survives SSH disconnect | Health check succeeds after disconnect/reconnect. |
| Public route reaches the gateway | External unauthenticated request receives `401 invalid_api_key`. |
| Authenticated SSE works | Fresh private key receives streamed `data:` events through the public hostname. |
| Edge protection exists | The exact-path POST rate rule is deployed. |
| Exposed keys are retired | All known exposed test keys are revoked before real customer use. |
| Admin remains isolated | Metrics stays local/SSH-only until a separately protected admin surface is built. |

## References

[1]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/ "Cloudflare Tunnel"

[2]: https://developers.cloudflare.com/tunnel/setup/ "Set up Cloudflare Tunnel"

[3]: https://developers.cloudflare.com/tunnel/setup/ "Publish a public hostname route"

[4]: https://developers.cloudflare.com/tunnel/routing/ "Cloudflare Tunnel routing and DNS"

[5]: https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/ "Create a rate limiting rule in the dashboard"

[6]: https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/ "Rate limiting rule parameters"

[7]: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/ "Publish and protect a self-hosted application with Cloudflare Access"
