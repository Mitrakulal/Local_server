# Phase 1 Handoff: From Measured Capacity to a Protected API

Phase 0 produces **evidence**. Phase 1 converts that evidence into an enforceable product boundary. Do not expose the raw model server as the public API, even if it supports an API key.

## 1. The Phase 1 architecture

```text
Customer application
        |
        v
Cloudflare edge: TLS, coarse abuse controls, optional Access policy
        |
        v
Cloudflare Tunnel: outbound connection only
        |
        v
Local gateway: tenant API key, allowed-model check, token/body limits,
               active-request limit, bounded queue, usage records, redacted logs
        |
        v
Model server on localhost: one fixed loaded model and tested server slots
```

Cloudflare Tunnel helps avoid direct origin exposure because the local connector establishes an outbound connection to Cloudflare.[1] It is an exposure layer, not the quota authority. Cloudflare rate limiting is useful at the edge, but its own documentation notes that counters are not precise enough to guarantee an exact number of requests will reach the origin.[2] The local gateway must be the authoritative admission-control point.

## 2. Translate the Phase 0 result into policy

Suppose Phase 0 shows that two active requests are stable and four produce bad p95 latency. The public policy should not let each customer send four streams directly to the model. A practical initial mapping is:

| Phase 0 measurement | Phase 1 policy translation |
|---|---|
| Stable active model slots | Global gateway semaphore. The gateway never admits more active work than the tested model slot count. |
| First unacceptable concurrency step | Queue/reject boundary. Requests above the stable level wait in a bounded queue or receive `429`/`503`. |
| Tested maximum context | Gateway validation for total input tokens. |
| Tested maximum output | Gateway cap for `max_tokens` and equivalent fields. |
| Measured p95 service time | Request deadline and alert threshold. |
| Recovered baseline behavior | Health-check expectation after queue drain or a restart. |
| Observed error mode | Alert rule and runbook trigger. |

The gateway should enforce limits by authenticated key. It must not use the client-supplied `user` value as the tenant boundary. A real key record should have a tenant ID, scopes, expiry, revocation flag, allowed models, active-request cap, requests-per-minute cap, tokens-per-minute cap, daily/monthly budget, and usage history.

## 3. Required controls before public testing

| Control | Minimum Phase 1 requirement |
|---|---|
| Network binding | Model backend listens only on `127.0.0.1`; public traffic can reach only the gateway through the Tunnel. |
| API keys | Random, individually revocable tenant keys; store only a salted hash/digest; show the secret once. |
| Key scopes | Restrict by allowed model, plan, expiration, and maximum active requests. |
| Request validation | JSON/body size, message content, model allowlist, context cap, output cap, timeout cap, and stream settings. |
| Admission control | Global semaphore plus per-key semaphore and a short bounded queue. |
| Overload response | `429` with `Retry-After` for quota/concurrency, or `503` for temporary global saturation. |
| Usage record | Request ID, tenant/key ID, model, start/end time, terminal status, prompt/output tokens if available, and latency. Do not log raw prompts by default. |
| Alerting | Model process unhealthy, tunnel unavailable, p95 TTFT breach, queue saturation, repeated auth failures, and unexpected restart. |
| Tool safety | Tools, shell execution, MCP, file access, arbitrary adapters, and arbitrary model paths disabled for untrusted tenants. |

llama.cpp supports its own API-key and CORS configuration, but its documentation also warns against enabling server tools in untrusted environments.[3] Keep an inference server as a restricted backend rather than trusting it as a full multi-tenant control plane.

## 4. Context policy after Phase 0

Keep the public chat-completions API stateless at first. The customer sends the `messages` array for each request. This avoids silently retaining sensitive conversations and limits what your service needs to protect.

If you later offer server-managed conversations, build a separate tenant-scoped conversation store. An opaque conversation ID must always be checked against the authenticated tenant. Apply retention and delete policies, a maximum stored-context token budget, and a clear privacy notice. Conversation history is durable product data; KV cache is only a transient model-performance optimization.

## 5. Capacity and queue policy

The gateway queue should be deliberately short. An unbounded queue turns a capacity problem into a long hidden wait and can consume memory, sockets, and support time. Use a queue cap measured from actual Phase 0 behavior, then reject work quickly and transparently when the service is saturated.

The user experience differs by product:

| Product | Appropriate behavior under saturation |
|---|---|
| Interactive chat | Very short queue; fast `429`/`503` when full; customer can retry. |
| Background summarization | Longer queued job with a visible job state and maximum execution time. |
| Internal team service | Per-team quotas and a compact operational dashboard. |
| Paid API | Per-key concurrency and token limits tied to the selected plan. |

## 6. Do not do these things

Do not publicly expose a raw Ollama, llama.cpp, or MLX-LM port. Do not use a shared permanent key across customers. Do not set permissive CORS for an internet-facing model endpoint. Do not let callers select arbitrary local model paths, tools, adapters, or shell commands. Do not let an overloaded service queue forever. Do not claim high availability from one Mac mini.

## References

[1]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/ "Cloudflare Tunnel documentation"

[2]: https://developers.cloudflare.com/waf/rate-limiting-rules/ "Cloudflare rate limiting documentation"

[3]: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md "llama.cpp HTTP Server documentation"

