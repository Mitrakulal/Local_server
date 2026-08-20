# Phase 0 LLM Load Tester

This project is a browser-based **Phase 0 capacity-testing instrument** for a local, OpenAI-compatible LLM server. It launches multiple independent streaming requests, displays every virtual user’s output and status, and reports the latency evidence needed to choose safe initial concurrency limits.

It is designed for a Mac mini running a small local model through llama.cpp, Ollama, MLX-LM, or another endpoint that implements the OpenAI Chat Completions streaming format. It is intentionally a **testing dashboard**, not a production API gateway and not a customer-facing billing system.

## Stage 1 local protected gateway

The Stage 1 implementation now lives in [`gateway/`](gateway/). It keeps llama.cpp private on `127.0.0.1:8080` and adds a loopback-only OpenAI-compatible gateway on `127.0.0.1:8787` with hashed API keys, one-active-request-per-key, four active requests globally, input/output bounds, and SSE forwarding. Read [`gateway/README.md`](gateway/README.md) before running it on the Mac mini.

## Documentation map

| Document | Use it for |
|---|---|
| [Operator guide](docs/PHASE0_OPERATOR_GUIDE.md) | Full setup, CORS, key handling, dashboard operation, metric interpretation, and troubleshooting. |
| [Laptop-to-Mac-mini guide](docs/LAPTOP_TO_MAC_MINI_TESTING.md) | Every SSH, dashboard, model-port, and first benchmark command for testing from a separate laptop. |
| [Test plan](docs/PHASE0_TEST_PLAN.md) | Repeatable baseline, concurrency, context, output, and recovery experiments. |
| [Results template](docs/PHASE0_RESULTS_TEMPLATE.md) | Recording measurements and choosing tested operating limits. |
| [Verified Gemma E2B benchmark](docs/BENCHMARK_GEMMA_E2B_MAC_MINI.md) | The observed Mac mini six-user test, four active-request boundary, queue evidence, and recommended initial gateway limits. |
| [Phase 1 handoff](docs/PHASE1_HANDOFF.md) | Turning the measured limits into gateway policy for a protected multi-tenant API. |
| [Phase 1 local gateway validation](docs/PHASE1_LOCAL_GATEWAY_VALIDATION.md) | The completed local smoke, fairness, and five-key capacity tests, plus the remaining requirements before public exposure. |

## Local launch

Run this dashboard **on the same trusted Mac** as the local model server for Phase 0. This avoids exposing an API key to a hosted webpage and avoids testing Cloudflare rather than the model.

```bash
pnpm install
pnpm dev
```

Open the local URL shown by Vite, normally `http://localhost:3000`. Configure the dashboard with an endpoint base such as `http://127.0.0.1:8080/v1`; it adds `/chat/completions` automatically.

> Do not deploy this dashboard publicly and paste a reusable production API key into it. For Phase 0, a browser-held key is acceptable only on a machine you control, with an ephemeral or local-only testing credential.

## Primary capability

The dashboard sends one request per virtual user, optionally with a small launch ramp. It records response-start time, time to first non-empty streamed token, total elapsed time, errors, and any usage fields the inference server returns. It does **not** invent token counts when the server omits streaming usage.

The recommended first test is one virtual user with a short prompt and a 128-token output cap. Repeat the exact same run with two users. Change one variable per test and write the result into the supplied template.
