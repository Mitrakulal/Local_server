# Phase 0 final decision: Gemma E2B on the Mac mini

## Decision

**Selected model:** `ggml-org/gemma-4-E2B-it-GGUF:Q8_0` served through the local llama.cpp router at `http://127.0.0.1:8080/v1`.

The Qwen3 4B candidate was evaluated and rejected for this service because the user preferred the observed Gemma E2B answer quality. No further Qwen setup or benchmark work is required for Phase 0.

## Verified test environment

| Component | Verified value |
|---|---|
| Host | Mac mini M4 with 16 GB unified memory |
| Inference runtime | llama.cpp router mode |
| API interface | OpenAI-compatible `/v1/chat/completions` with SSE streaming |
| Selected model | `ggml-org/gemma-4-E2B-it-GGUF:Q8_0` |
| Model context setting | 8,192 tokens |
| Test dashboard | Phase 0 browser dashboard, accessed remotely through an SSH local-port tunnel |
| Long-workload settings | 8,192 requested output tokens, 500 ms user ramp, 200,000 ms timeout in the six-user test |

## What Phase 0 proved

The selected model streams correctly through llama.cpp. Its earliest meaningful tokens can arrive in `choices[0].delta.reasoning_content` before normal answer text arrives in `choices[0].delta.content`. The dashboard was updated to measure time-to-first-stream from either field and to preserve the full bounded stream in separate reasoning and answer panels.

The one-user long-answer test showed a first stream in approximately 0.83 seconds and approximately 42.2 output tokens per second. In the two-user test, per-user throughput was approximately 24.2 and 25.0 tokens per second, while total throughput increased. This is expected continuous-batching behavior: per-user capacity is shared while aggregate work rises.

The six-user long-workload test demonstrated **four effective active inference slots**. VU-01 through VU-04 received their first streams in approximately 0.82 to 1.55 seconds. VU-05 and VU-06 received their first streams only after approximately 65.40 and 70.32 seconds, respectively. Therefore, the queue begins with the **fifth** request under this workload.

> The measured four-request limit applies to this model, quantization, context setting, prompt size, output budget, llama.cpp configuration, and Mac mini. It is an operating baseline, not a universal capacity number for all future workloads.

## Phase 0 operating conclusion

| Scenario | Phase 0 conclusion |
|---|---|
| Single user | Good interactive experience for this long workload. |
| Two active long users | Still responsive; a good initial smooth-interaction target. |
| Four active long users | Technical active-capacity boundary; usable only when customers accept reduced per-user generation speed. |
| Fifth or later long user | Queues materially; do not present this as immediate interactive service. |

The selected operating policy for the next phase is: **four global active model requests at most**, with a **maximum of one active long request per customer API key**. A fifth request should be either rejected with a retry indication for interactive API use or accepted into an explicit asynchronous queue with a visible position/status. Do not silently leave users waiting for a minute.

## Phase 1 readiness checklist

Phase 0 is complete for model selection and baseline capacity. Phase 1 should add a protected gateway in front of llama.cpp with the following controls:

1. Per-customer API keys, revocation, and usage records.
2. A global four-request semaphore plus one-active-request-per-key limit.
3. A bounded queue or explicit `429`/`503` retry response for the fifth interactive request.
4. Request limits for body size, input tokens, output tokens, timeout, and rate per key.
5. Cloudflare Tunnel/Access at the edge; do not publicly expose the raw llama.cpp port.
6. Structured request logs recording key ID, model, queue wait, TTFT, elapsed time, finish reason, and error category without storing unnecessary prompt content.
7. Separate short-response and long-response service limits, tested independently.

## Current status

**Phase 0 is complete.** The remaining immediate operational action is to restore/run the Gemma-only router on port 8080 after the discontinued Qwen experiment, then proceed to gateway design rather than more model comparison.
