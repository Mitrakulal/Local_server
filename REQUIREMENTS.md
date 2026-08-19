# Phase 0 Load Lab: Requirements and Runbook

This file is the quick start for the ZIP package. It tells you what must be ready before you run the multi-user local LLM test dashboard.

## 1. Package purpose

The package contains a React/Vite dashboard that sends concurrent, independent streaming requests to a local OpenAI-compatible LLM endpoint. It is designed to measure time to first token, total response time, per-user errors, and the degradation caused by increased virtual-user demand.

The package is for **Phase 0 local testing only**. It is not a public API gateway, billing system, tenant database, or customer portal.

## 2. Required software

| Component | Requirement | Check |
|---|---|---|
| Host | Your continuously running Mac mini or another trusted local machine. | The model and dashboard should initially run on the same machine. |
| Node.js | Node.js 20 or later. | `node --version` |
| Package manager | pnpm 10 or later. | `pnpm --version` |
| Local model server | An OpenAI-compatible streaming chat-completions endpoint. | Use the `curl` test below. |
| Browser | A current Chromium, Safari, or Firefox browser. | Open the Vite local URL. |

The project uses React, TypeScript, Vite, Tailwind CSS, and the preconfigured UI components listed in `package.json`. Install these with `pnpm install`; do not include `node_modules` in source control or the ZIP.

## 3. Required model-server behavior

The dashboard expects these request properties:

| Requirement | Expected value |
|---|---|
| Request method | `POST` |
| Endpoint | `<base-url>/chat/completions`, normally `http://127.0.0.1:<port>/v1/chat/completions` |
| Body format | JSON with `model`, `messages`, `stream: true`, and `max_tokens` |
| Response format | OpenAI-style Server-Sent Events using `data:` lines and incremental `choices[].delta.content` fields |
| Network binding | The local model server initially listens only on `127.0.0.1` |
| Browser CORS | Explicitly allows the dashboard origin, normally `http://localhost:3000` |
| Authentication | Optional only for a localhost Phase 0 test; otherwise use a local test-only bearer key |

Verify the model endpoint before starting the dashboard:

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

For llama.cpp, the official server documentation includes local host binding, API keys, CORS origins, parallel slots, continuous batching, and prompt caching controls.[1] Ollama documents browser-origin controls and concurrency variables.[2] MLX-LM provides an OpenAI-like local HTTP server, but its own server documentation advises against treating that server as a production security boundary.[3]

## 4. First local run

```bash
pnpm install
pnpm dev
```

Open the local Vite URL, normally `http://localhost:3000`. In the left rail, set the endpoint base, test model name, a local test key if needed, and the synthetic prompt. Keep the initial settings conservative:

| Setting | First-run value |
|---|---:|
| Virtual users | 1 |
| Launch ramp | 500 ms |
| Maximum output | 128 tokens |
| Browser timeout | 90 seconds |
| Independent-user suffix | Enabled |

Run the one-user baseline at least three times. Then make the **same** test with two users. Change only one variable per subsequent run.

## 5. Required safety rules

Do not use customer data, private documents, secrets, personally identifying information, or a reusable production master key in Phase 0. Keep the model server on localhost. Do not expose this browser dashboard publicly. A Cloudflare Tunnel can be part of the later Phase 1 architecture, but it does not replace a local gateway that enforces tenant keys, quotas, request validation, and bounded admission control.[4]

## 6. Documentation included in this package

| File | Contents |
|---|---|
| `README.md` | Project overview and local launch. |
| `docs/LAPTOP_TO_MAC_MINI_TESTING.md` | Every Mac mini, SSH-tunnel, laptop browser, interface, and first-test command. |
| `docs/PHASE0_OPERATOR_GUIDE.md` | Detailed endpoint setup, CORS, dashboard operation, metrics, troubleshooting, and exit criteria. |
| `docs/PHASE0_TEST_PLAN.md` | Repeatable benchmark sequence and capacity decision method. |
| `docs/PHASE0_RESULTS_TEMPLATE.md` | Test-result record you should complete for each meaningful run. |
| `docs/PHASE1_HANDOFF.md` | How measured limits become protected gateway policy. |
| `ideas.md` | Interface design rationale and visual system. |

## 7. Phase 0 exit requirement

Phase 0 is complete only when you have a written result showing a specific model, server configuration, prompt/output range, stable active-request limit, p95 time to first token, error behavior, and queue/rejection decision. The result must explain why each public limit exists.

## References

[1]: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md "llama.cpp HTTP Server documentation"

[2]: https://docs.ollama.com/faq "Ollama FAQ"

[3]: https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md "MLX-LM HTTP Model Server"

[4]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/ "Cloudflare Tunnel documentation"
