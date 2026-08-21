# Mattr Labs Local LLM Provider — Gap Register

## Executive position

The service is now a working **invite-only, single-model LLM provider pilot**. The public hostname serves an owner-only chat at `/` and a protected customer API at `/v1/*`; the Mac mini gateway enforces key validation, per-key fairness, global capacity, request limits, and SSE streaming. The private Owner Console can create and revoke keys and inspect safe usage metadata.

It is **not yet ready to be presented as a self-service commercial LLM provider**. The main gaps are operational controls, customer developer experience, rate-abuse protection, backup/alerting discipline, and a clean distinction between an owner tool and a customer product.

> The correct next target is not “add every SaaS feature.” It is a **safe invited alpha**: a few known users, one model, clear limits, manual key issuance, visible operations, and the ability to revoke, recover, and support confidently.

## 1. Current maturity by surface

| Surface | What works today | Maturity | Main gap |
|---|---|---:|---|
| Owner chat | Publicly reachable owner-token gate, streamed Gemma answers, separate Thinking panel, browser-local conversations, fixed composer, bounded history rail | Pilot | It is an owner tool, not a customer chat product; model may occasionally consume its answer budget on reasoning; history is not durable or cross-device. |
| Customer API | OpenAI-compatible `/v1/chat/completions`, SSE, per-key limits, key hashing, revocation, request validation, four-slot global protection | Strong pilot | No public developer documentation, self-service onboarding, usage portal, billing, or customer support flow. |
| API-key control | Owner can create and revoke individual keys; safe prefixes and metadata are retained; raw key appears once | Strong pilot | Console creation currently relies on default policy values; no plan presets, customer self-service rotation, bulk action UI, or proactive expiry/usage alerts. |
| Private Owner Console | Live gateway health, capacity, key list, usage, request activity, key creation and revocation, Provider launch overview | Pilot | It is manually started, has one owner role, has no export/alerts/backups panel, and only a partial deployment/readiness picture. |
| Load Lab | Real capacity and fairness test surface | Ready for internal use | It is an operator test tool, not part of the customer product. |
| Inference runtime | Gemma E2B through private llama.cpp, loopback-only, measured four-request capacity | Stable baseline | One model, one machine, no high availability, no automatic failover, and no model-selection workflow. |
| Cloudflare edge | Tunnel public exposure works; `/healthz` works; unauthenticated API requests return `401`; `/v1` survives the same-host router cutover | Good baseline | Edge rate limiting and owner-chat abuse controls are not yet configured; authenticated external API verification should be recorded again after the final route change. |

## 2. Gaps in the chat interface

### What is intentionally good enough now

The current chat is appropriate as a private owner interface. It does not expose a customer API key in the browser. It separates model reasoning from final content, keeps the composer stable, and keeps session history local to the browser.

### Remaining chat gaps

| Priority | Gap | Why it matters | Recommended action |
|---|---|---|---|
| P0 | Final answer can be absent after a long reasoning trace | A user may see “No final answer was returned,” which weakens trust in the chat product. | Tune the owner-chat generation budget and server instruction; if the model ends after reasoning only, show a clearer retry affordance and log the finish reason. |
| P1 | Owner chat is on a public hostname with only a shared token | The token protects access, but request abuse can still consume the owner-chat key’s capacity. | Add a Cloudflare rate limit for `/chat/api/*`; later, put owner chat behind Cloudflare Access or a separate owner hostname. |
| P1 | Browser-only history | Closing the browser clears conversations; there is no cross-device continuity. | Keep this for the owner pilot. Add persisted history only with owner identity, encryption, retention policy, and backups. |
| P1 | Plain-text output after renderer stabilization | It is safer and stable, but code blocks, tables, syntax highlighting, and rich Markdown are limited. | Add a narrowly tested Markdown renderer later, only after writing regression tests for streamed thinking and stored session content. |
| P2 | Conversation conveniences | Regenerate, edit-and-resend, export, keyboard shortcuts, model settings, and clear title management are not fully productized. | Add after final-answer reliability and operating controls are resolved. |
| P2 | No customer chat workspace | Current chat is deliberately owner-only. | Do not convert it into public customer chat without accounts, tenant isolation, retention policy, and usage controls. |

## 3. Gaps in the customer API and developer experience

| Priority | Gap | Current consequence | Recommended action |
|---|---|---|---|
| P0 | Exposed test keys have not been fully rotated | Any key visible in screenshots, pasted commands, or chat logs must be treated as compromised. | Revoke by prefix, issue fresh owner/invite keys, and verify old keys return `401`. |
| P0 | No Cloudflare edge rate rule | A valid or invalid request flood can still reach the tunnel and consume gateway work before the per-key policy is useful. | Add a coarse Cloudflare rate-limiting rule for `POST /v1/chat/completions`; keep the gateway as the capacity authority. |
| P0 | Authenticated public API test needs a clean recorded check | Health and unauthenticated protection are verified, but a fresh clean SSE check proves customer success end-to-end. | Test with a newly issued private key through the public hostname; record `data: [DONE]` without sharing the key. |
| P1 | No public developer documentation route | A customer cannot independently learn the base URL, supported model, streaming format, limits, errors, or SDK configuration. | Build a small public `/developers` page with no secrets and an invite-request contact path. |
| P1 | No plan presets in the key-creation UI | Every new key gets default limits unless the owner uses the CLI or later backend controls. | Add Invite, Owner, and Long-output presets with explicit limit values and a confirmation summary. |
| P1 | No customer usage visibility | Customers will ask why they hit `429` or daily limits. | Start with an owner-sent manual usage summary; build a customer portal only after authentication is in place. |
| P1 | No formal versioning/support contract | Client integrations need error semantics, timeout guidance, model lifecycle policy, and contact path. | Publish an API reference, error table, changelog, and support expectations. |
| P2 | Missing API families | There are no embeddings, responses API, files, images, tools, batching, or webhooks. | Keep them out of the alpha. Each changes memory, security, and support needs. |
| P2 | No billing/self-service signup | You cannot sell automatically yet. | Use manual invite access first; add billing only after measured demand and an explicit commercial policy. |

## 4. Gaps in the private admin and operations interface

| Priority | Gap | Current consequence | Recommended action |
|---|---|---|---|
| P0 | Admin console is not a permanent managed service | It needs `pnpm admin:start` when used, which is fine for a pilot but not an always-ready operations surface. | Install a loopback-only launchd service for the console, or make the command center a built static route within the existing router while retaining SSH-only access. |
| P0 | No tested SQLite backup and restore runbook | Key metadata and usage events are operationally important. A host or disk issue could lose provider records. | Add encrypted daily backup, off-device copy, retention policy, and one restore rehearsal. |
| P0 | No alerting | You may discover tunnel, model, disk, or gateway failure only after a customer reports it. | Add simple uptime checks for public API and local gateway, plus disk-space/process restart alerts. |
| P1 | Provider launch tab has manual gates | It clarifies the state but cannot independently prove Cloudflare rule presence, backup freshness, or exposed-key rotation. | Add recorded operator check timestamps first; automate only after the basic control model is stable. |
| P1 | No date-range/export analysis | It is harder to review customer adoption or support issues over time. | Add CSV export and 7/30-day usage views, keeping prompts and answers excluded. |
| P1 | Single owner role only | A helper cannot have limited access without sharing the owner token. | Add roles only when a second operator is real; use Cloudflare Access identity before building roles from scratch. |
| P1 | No key rotation workflow | Revoke-and-create works, but no guided replacement handover or expiry reminder exists. | Add “rotate key” as a two-step UI action with an expiry warning and audit entry. |
| P2 | No billing ledger or invoices | Manual commercial operation remains manual. | Add only after product pricing and customer contracts are decided. |

## 5. Infrastructure, security, and reliability gaps

| Priority | Gap | Risk | Recommended action |
|---|---|---|---|
| P0 | Key rotation | A previously exposed live key can be used by anyone who captured it. | Revoke every exposed prefix and replace with fresh keys before external invitations. |
| P0 | Edge abuse protection | A four-slot local model has limited tolerance for bursts and invalid-traffic floods. | Add Cloudflare rate rules for API and owner-chat proxy paths; retain gateway concurrency/rate checks. |
| P0 | Backups and restore test | A local SQLite file is a single operational dependency. | Daily encrypted backup, off-device storage, restore drill. |
| P0 | Monitoring and alerting | Failures can be silent. | Monitor tunnel/public health, gateway health, llama reachability, disk, memory pressure, and launchd restarts. |
| P1 | Public health information policy | `/healthz` currently confirms model/backend availability to the public. | Decide whether this is intentional; either keep minimal public health or move detailed health behind an owner boundary. |
| P1 | Security headers / edge policy review | The public UI and API should have deliberate header, method, and caching rules. | Review CSP, HSTS, CORS, method allow-list, and `x-powered-by` removal after core P0 work. |
| P1 | Separate emergency access route | Restarting the shared Cloudflare Tunnel can momentarily disrupt SSH access. | Keep a documented recovery route and local console access plan; do not expose raw model ports as a shortcut. |
| P2 | High availability | One Mac mini is a single point of failure. | Do not promise uptime SLA. Add a second host only after paying demand justifies it. |

## 6. Commercial and trust gaps

| Priority | Gap | Why it matters | Recommended action |
|---|---|---|---|
| P1 | No public positioning page | People cannot tell what the service offers, who it is for, or how to request access. | Build a narrow landing/developer page: one model, invite-only API, privacy statement, and request-access contact. |
| P1 | No API terms, privacy statement, or retention disclosure | Customers need to know what is logged and what is not. | Publish concise policy pages before accepting external users. |
| P1 | No customer support workflow | Support will otherwise happen in random messages without issue tracking. | Define contact channel, expected response window, and key-incident process. |
| P1 | No pricing/plan statement | Selling access without limits or price clarity creates disputes. | Start with manual invitation terms; use simple fixed plans only after observing actual costs and demand. |
| P2 | No payments/tax/invoicing flow | Full commercial launch needs regional legal and financial decisions. | Do not add checkout until terms, support, refund approach, and plan economics are finalized. |

## 7. Recommended execution order

### Stage 1 — Before inviting any new external user

1. Rotate exposed keys and prove old keys fail.
2. Add Cloudflare rate limits for customer API and owner-chat proxy traffic.
3. Complete one authenticated public API stream test with a fresh key.
4. Install a persistent private Owner Console service or document its deliberate on-demand operating model.
5. Add encrypted SQLite backup plus one restore test.
6. Add basic uptime and host-alert checks.

### Stage 2 — First invited alpha

1. Publish a small developer quick-start and errors/limits reference.
2. Use manual key issuance with an explicit standard plan and expiry.
3. Add Provider Command Center plan presets and a guided rotate-key operation.
4. Track real demand: active slots, time-to-first-token, 429 causes, customer daily use, and support issues.

### Stage 3 — Only after real user demand

1. Decide whether customers need a portal or whether manual operation remains better.
2. Add customer authentication, isolated tenant data, and customer usage views only if needed.
3. Add billing only after terms, pricing, and operating costs are clear.
4. Consider a second host, additional models, persistent conversation history, or advanced API features only after capacity and privacy decisions are documented.

## 8. What not to build next

Do **not** add public admin access, file upload, agent tools, automatic payments, many models, or customer chat accounts before Stage 1 is complete. Those features would expand the attack surface and support load faster than this four-slot host can safely absorb.

## Bottom line

The core technology is working. The gaps are mostly the unglamorous pieces that make a provider trustworthy: **key hygiene, edge limits, backups, monitoring, developer documentation, clear customer limits, and operator workflow**. Address those first, then grow the product deliberately.
