# Phase 0 LLM Load Tester

This project is a browser-based **Phase 0 capacity-testing instrument** for a local, OpenAI-compatible LLM server. It launches multiple independent streaming requests, displays every virtual user’s output and status, and reports the latency evidence needed to choose safe initial concurrency limits.

It is designed for a Mac mini running a small local model through llama.cpp, Ollama, MLX-LM, or another endpoint that implements the OpenAI Chat Completions streaming format. It is intentionally a **testing dashboard**, not a production API gateway and not a customer-facing billing system.

## Documentation map

| Document | Use it for |
|---|---|
| [Operator guide](docs/PHASE0_OPERATOR_GUIDE.md) | Full setup, CORS, key handling, dashboard operation, metric interpretation, and troubleshooting. |
| [Test plan](docs/PHASE0_TEST_PLAN.md) | Repeatable baseline, concurrency, context, output, and recovery experiments. |
| [Results template](docs/PHASE0_RESULTS_TEMPLATE.md) | Recording measurements and choosing tested operating limits. |
| [Phase 1 handoff](docs/PHASE1_HANDOFF.md) | Turning the measured limits into gateway policy for a protected multi-tenant API. |

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
