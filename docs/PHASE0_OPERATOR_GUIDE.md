# Phase 0 Operator Guide: Multi-User Local LLM Capacity Testing

**Audience:** The operator of one Mac mini hosting a local model.  
**Goal:** Measure a safe initial operating envelope before building a public multi-tenant service.  
**Scope:** One tested model, a trusted local browser, synthetic prompts, and a local OpenAI-compatible streaming endpoint.

> **The question Phase 0 answers is not “can the server accept requests?” It is “at what concurrency, context length, and output limit does this model still provide a customer experience I can honestly support?”**

## 1. What the dashboard does and does not do

The dashboard creates several **virtual users**. Each virtual user is one independent `POST /v1/chat/completions` streaming request. You control the endpoint, model identifier, number of virtual users, launch ramp, maximum output, timeout, system instruction, and user prompt. The interface then shows each request as a separate channel.

The application is deliberately browser-side. It is suitable for Phase 0 only when it runs on your trusted Mac and calls a local endpoint. It is not a secure API proxy, does not persist tenants, does not count billable tokens reliably across every server, and should not be deployed publicly with real customer credentials.

| Dashboard capability | Included in Phase 0 | Reason |
|---|---|---|
| Concurrent virtual users | Yes | Measures shared-model contention. |
| Streaming output preview | Yes | Confirms actual stream behavior and catches stalled channels. |
| TTFT, response start, elapsed time | Yes | Establishes interactive latency and tail latency. |
| Server-reported usage | When provided | Useful evidence, but not fabricated if the backend omits it. |
| API key persistence | No | Reduces the risk of leaving a reusable secret in the browser. |
| Customer accounts or billing | No | These belong in the Phase 1 gateway/control plane. |
| Public origin protection | No | Phase 0 must be local and trusted. |

## 2. Recommended Phase 0 topology

Run the dashboard and model server on the same Mac. Keep the model server bound to localhost. If Cloudflare Tunnel is already running, leave it out of the initial benchmark path; otherwise you will measure the edge network path, Tunnel behavior, and browser geography as well as the model.

```text
Your browser at http://localhost:3000
          |
          | browser fetch with a local-only test key
          v
OpenAI-compatible local model endpoint at 127.0.0.1:<port>/v1
          |
          v
One loaded local model and its KV cache
```

The browser and model server use different local ports, so the model server must permit the dashboard’s browser origin through CORS. CORS is not authentication; it merely controls which browser origins may call the server. Keep the allowed origin specific to the dashboard URL.

## 3. Prepare the local model endpoint

### 3.1 Verify the endpoint contract

The load tester expects a streaming OpenAI-style chat-completions route. The dashboard converts the configured base URL to:

```text
<endpoint-base>/chat/completions
```

For example, the base `http://127.0.0.1:8080/v1` becomes `http://127.0.0.1:8080/v1/chat/completions`. The request contains a model string, a `messages` array, `stream: true`, and `max_tokens`.

Before using the interface, issue one manual request from the Mac. Confirm that it returns a streaming response and that the model name is accepted.

```bash
curl -N http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_PHASE0_TEST_KEY' \
  -d '{
    "model": "YOUR_MODEL_NAME",
    "stream": true,
    "max_tokens": 32,
    "messages": [{"role": "user", "content": "Reply with one sentence about bounded queues."}]
  }'
```

Replace the model name and only use a **local Phase 0 key**, not an administrative/master credential. A success response should normally include multiple Server-Sent Event lines starting with `data:` and ending in `[DONE]` for OpenAI-style servers.

### 3.2 llama.cpp server example

llama.cpp documents its HTTP server as supporting OpenAI-compatible chat routes, parallel server slots, continuous batching, prompt caching, cache reuse, CORS controls, and API keys.[1] A local Phase 0 command can follow this shape:

```bash
llama-server \
  -m /absolute/path/to/your-model.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --api-key YOUR_PHASE0_TEST_KEY \
  --cors-origins http://localhost:3000 \
  --parallel 2 \
  --cont-batching \
  --cache-prompt
```

Use the actual command name and model path produced by your llama.cpp installation. Start with `--parallel 1` or `--parallel 2`; do not jump directly to a large number of slots. The server’s `--parallel` setting is the model-side active slot count, while the dashboard’s virtual-user count represents demand placed on those slots.

### 3.3 Ollama local endpoint

Ollama documents OpenAI-compatible API use and documents concurrency controls through `OLLAMA_MAX_LOADED_MODELS`, `OLLAMA_NUM_PARALLEL`, and `OLLAMA_MAX_QUEUE`.[2] Its FAQ also documents `OLLAMA_ORIGINS` for browser-origin configuration.[2]

For a local browser dashboard, ensure the allowed browser origin is limited to the local dashboard origin, such as `http://localhost:3000`, then restart the Ollama process using the environment setup appropriate for your macOS installation. Do not use a wildcard origin merely to avoid a CORS error, especially if the model endpoint can be reached outside localhost.

Use the endpoint and model identifier exposed by your own Ollama installation. The dashboard is compatible only if the route accepts the OpenAI chat-completions streaming shape; validate with the manual request first.

### 3.4 MLX-LM and other backends

MLX-LM offers an OpenAI-like HTTP API with streaming, but its own server document says it is not recommended for production because it implements only basic security checks.[3] For Phase 0 it can be a valid local backend. For later phases, place it behind a separate authenticated gateway; do not expose it directly through a public tunnel.

For any other backend, use the manual `curl` check and confirm all of the following before testing:

| Requirement | What to verify |
|---|---|
| Route | The endpoint accepts `POST /v1/chat/completions` or the configured equivalent. |
| Streaming | The server returns incremental events rather than one JSON response at the end. |
| CORS | The browser at the dashboard’s origin is explicitly allowed. |
| Authentication | A local-only test key is valid if authentication is enabled. |
| Model name | The model string used in the dashboard is accepted. |
| Binding | The server listens on `127.0.0.1`, not a public network interface. |

## 4. Run the dashboard locally

From the project directory, install dependencies and start the local development server.

```bash
pnpm install
pnpm dev
```

Open the URL printed by Vite, normally `http://localhost:3000`. If Vite uses a different port, change the allowed CORS origin at the model server to that exact origin and restart the model server.

The dashboard stores configuration in React state only. Refreshing the page clears the API key and test state. This behavior is intentional.

### 4.1 Configuration fields

| Field | Meaning | Practical Phase 0 guidance |
|---|---|---|
| Endpoint base URL | The local API base, normally ending in `/v1`. | Use `127.0.0.1`, not your public Cloudflare hostname. |
| API key | A bearer credential sent on each request. | Use an ephemeral local test key. Leave blank only if the local server is intentionally unauthenticated and localhost-bound. |
| Model name | The exact identifier expected by the local backend. | Keep one fixed tested model for the entire benchmark matrix. |
| Users | Concurrent demand generated by the browser. | Start at 1, then 2, then 4 only after recording the earlier results. |
| Ramp | Delay between virtual-user launches. | Start at 500 ms. Use 0 only when testing a burst. |
| Max output | Requested maximum completion size. | Start at 128 tokens so requests terminate quickly. |
| Timeout | Browser cancellation threshold. | Start at 90,000 ms for short-output tests. |
| System instruction | Shared prefix for the test. | Keep identical for cache tests; avoid sensitive system prompts. |
| User prompt | Primary work supplied to the model. | Use synthetic, repeatable prompts. |
| Independent users | Adds a distinct suffix to each virtual user’s prompt. | Keep enabled for realistic unrelated-user tests. Disable only for a shared-prefix experiment. |

## 5. The correct test sequence

The test plan is deliberately sequential. You are looking for the point at which the next concurrency increase causes an unacceptable rise in tail latency, queue wait, errors, or recovery time. The exact acceptable point depends on the service you intend to sell, but the evidence method stays the same.

### Step 1: record a baseline

Set **Users = 1**, Ramp = 500 ms, Max output = 128, and a short prompt. Run the test at least three times. Record the typical time to first token and elapsed time. If the one-user baseline is unstable, do not test more users yet.

### Step 2: repeat with two users

Do not change the prompt, model, output cap, server slot count, or endpoint. Set **Users = 2**. Compare p50/p95 TTFT and completion time to the baseline. A modest individual slowdown may be acceptable if aggregate work rises and the interactive experience remains comfortable.

### Step 3: continue by powers of two

If two users are stable, test four. Do not assume eight will work because four did. A local model can hit a sharp memory or scheduling limit as total contexts grow. Choose a virtual-user count that gives a predictable customer experience, not the highest count that completes once.

### Step 4: isolate prompt-prefill behavior

Run one long-context test using a known safe context size with a short answer. Then repeat with two users. This captures prompt-prefill pressure separately from long decoding. Prefix caching can speed the shared input portion of similar requests, but it does not speed newly generated output tokens.[4]

### Step 5: isolate output-length behavior

Run short inputs with a larger bounded output. This identifies how long each slot stays busy when customers generate long text. A test with a 128-token cap and a test with a 1,000-token cap represent very different production workloads.

### Step 6: test recovery

After a busy run, repeat the original one-user baseline. The response should return near its original range. If it remains degraded, investigate model swapping, memory pressure, stalled connections, cache behavior, or a model-server problem before proceeding.

## 6. Read the metrics correctly

### Response start versus TTFT

**Response start** is when the browser receives a successful HTTP response stream. **Time to first token (TTFT)** is when the browser receives the first non-empty text token. TTFT is more useful for interactive chat because a server can accept a connection immediately while the request is still waiting to be scheduled or prefilling a long prompt.

| Metric pattern | Likely meaning | Suggested next action |
|---|---|---|
| Response start and TTFT both close to baseline | Low contention. | Test the next concurrency step. |
| Response start is quick but TTFT rises with users | The HTTP layer accepts work, but the model scheduler/prefill stage is congested. | Treat the extra wait as real queueing; lower public concurrency or add a queue policy. |
| p50 is acceptable but p95 rises sharply | Some customers see a much worse experience than the average. | Use p95—not only the average—to set an initial public cap. |
| Total completed work rises but each TTFT slows moderately | Batching may be improving aggregate throughput while reducing per-user responsiveness. | Choose based on product type: batch jobs may accept this; chat usually should not. |
| Errors or cancellations begin at the next level | The tested capacity was exceeded or the timeout is too aggressive. | Return to the lower stable level and investigate before retrying. |
| No reported token count | The backend did not include streaming usage. | Still use TTFT/elapsed data; do not estimate billable usage from the UI. |

### The capacity decision

The safe initial public concurrency is normally the **highest tested level that remains stable at p95**, not the maximum number that completed once. If one user has 700 ms TTFT, two users have 900 ms p95 TTFT, and four users have 6 s p95 TTFT with occasional failures, choose two as the initial service-level concurrent capacity. Add a gateway queue rather than sending unlimited fourth and fifth requests directly to the model.

## 7. Troubleshooting guide

| Symptom | Most likely cause | Verify and fix |
|---|---|---|
| Browser shows a CORS error | The model server does not allow the dashboard origin. | Allow the exact local origin such as `http://localhost:3000`; restart the model server. Do not use `*` on an internet-accessible endpoint. |
| `401 Unauthorized` | Wrong test API key or server authentication mismatch. | Test the exact key with the manual `curl` command; make sure the dashboard key has no hidden whitespace. |
| `404 Not Found` | Wrong endpoint base or backend does not expose OpenAI-style chat completions. | Check the base ends in `/v1` if appropriate; confirm the manual request route. |
| `400 Bad Request` | Unsupported model name, message schema, or parameter. | Use the model ID the backend lists; begin with the default system/user messages and a low `max_tokens`. |
| All users time out | The model is overloaded, stalled, or the timeout is too small for the selected workload. | Stop the run; perform a one-user baseline; reduce output/context/slots before increasing the timeout. |
| User cards show no output but no immediate error | Endpoint is non-streaming or returns a nonstandard stream format. | Inspect the manual `curl -N` response. The tool expects `data:` JSON events with OpenAI-style `choices[].delta.content`. |
| Token counts are `not reported` | The backend omits `usage` in streamed events. | This is expected for some servers. Keep using latency data; obtain billing counters later from the gateway. |
| First run is slow, later shared-prefix runs are faster | Warm model/cache behavior. | Record both cold and warm state. Do not advertise the warm result as a universal guarantee. |
| The Mac becomes slow or the model process crashes | Contexts, slots, or model residency exceeded a safe memory limit. | Stop traffic, lower the test level, restart the model, and retest from the last stable configuration. |
| A browser extension or another web page can call the local model | CORS was allowed too broadly. | Restrict the allowed origin, review the browser origin, and keep the model bound to localhost. |

## 8. Security and data-handling rules for Phase 0

Use only synthetic prompts. Do not load customer documents, proprietary source code, secrets, personally identifying information, or production prompts into a browser test. The dashboard displays streamed output in the browser and does not replace the need for an actual data-retention policy.

Keep the model server on localhost. Cloudflare Tunnel is useful when you later need controlled remote access because it makes an outbound connection rather than exposing the origin directly.[5] It does not replace per-key authentication, origin-side quotas, request validation, or a gateway. For now, leave public exposure out of the capacity test.

The OWASP GenAI Security Project identifies model denial of service, sensitive information disclosure, supply-chain vulnerabilities, and excessive agency among the risks relevant to LLM systems.[6] In Phase 0, reduce these risks by using a fixed local model, keeping tools disabled, restricting network exposure, using synthetic data, and enforcing a short timeout.

## 9. Capture the result

After each meaningful configuration, fill in [the results template](PHASE0_RESULTS_TEMPLATE.md). Save the following together: the model/version, inference-server command or environment settings, dashboard settings, TTFT percentiles, elapsed-time percentiles, error count, and the resulting decision.

The record must say **why** a limit exists. “Two concurrent users” without a prompt length, output cap, p95 TTFT, and server configuration is not a usable operating rule.

## 10. Exit criteria and next phase

Phase 0 is complete when you have a repeatable configuration that meets your intended experience at one tested concurrency level, a written result template for it, and a confirmed overload behavior. You should be able to say: “For this model and this prompt/output range, two active requests are stable; additional work must queue or be rejected.”

Move to Phase 1 only after that decision exists. Phase 1 introduces the authenticated gateway, tenant-scoped API keys, quotas, authoritative request admission, token accounting, redacted logging, and Cloudflare edge controls. Use [the Phase 1 handoff](PHASE1_HANDOFF.md) to translate your measured values into gateway policy.

## References

[1]: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md "llama.cpp HTTP Server documentation"

[2]: https://docs.ollama.com/faq "Ollama FAQ: CORS and concurrent processing"

[3]: https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md "MLX-LM HTTP Model Server"

[4]: https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/ "vLLM automatic prefix caching"

[5]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/ "Cloudflare Tunnel documentation"

[6]: https://genai.owasp.org/llm-top-10/ "OWASP GenAI Security Project"
