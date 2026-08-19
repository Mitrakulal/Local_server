# Phase 0 test plan

## Purpose

This phase establishes the safe concurrent capacity of one local model on one Mac mini. It does not certify a public service, guarantee an SLA, or test tenant billing. The result is a measured operating envelope: a tested model, context cap, output cap, useful concurrency range, queue behavior, and the conditions that cause service degradation.

## What one virtual user means

One virtual user is one independent streaming request sent to the configured OpenAI-compatible `/v1/chat/completions` endpoint. Virtual users are launched together or with a ramp delay and remain independent. They are not browser tabs, human accounts, or durable conversations.

The dashboard can run shared-prefix tests and unique-prompt tests. Shared-prefix tests are useful for observing prompt-cache effects. Unique-prompt tests better represent different customers sending unrelated work.

## Metric contract

| Metric | Definition | Why it matters |
|---|---|---|
| Active users | Requests currently waiting for or receiving a model response. | Shows the concurrent pressure applied to the server. |
| Completed users | Requests that reached a normal terminal event. | Confirms the test finished cleanly. |
| Failed users | Requests ending in a network, HTTP, parse, timeout, or cancellation error. | Identifies capacity or configuration problems. |
| Queue wait | Time from the browser dispatching a request to the first response byte or model output becoming available. | Reveals admission delay and scheduler saturation. |
| TTFT | Time from request dispatch to the first non-empty streamed token. | The most important interactive-latency signal. |
| Elapsed time | Time from request dispatch until completion, error, or cancellation. | Shows total customer experience. |
| Reported prompt tokens | Input tokens returned by the server in a usage object, when available. | Allows later capacity and price analysis. |
| Reported completion tokens | Output tokens returned by the server in a usage object, when available. | Allows later capacity and price analysis. |
| Generation rate | Reported completion tokens divided by the time after first token, when both values exist. | Tracks useful model generation speed. |

The dashboard must show `not reported` rather than invent token counts when an inference server does not return streaming usage.

## Test sequence

| Test | Users | Prompt shape | Goal |
|---|---:|---|---|
| Baseline | 1 | Short, unique prompt | Establish TTFT, elapsed time, and useful generation speed without contention. |
| Shared-prefix | 2 then 4 | Identical system/user prefix, short answer | Observe whether prompt caching or batching changes prefill behavior. |
| Independent chats | 2 then 4 | User-specific prompt suffixes | Measure realistic unrelated users sharing one model. |
| Long-context probe | 1 then 2 | Long input within the chosen cap, short answer | Measure prefill cost and identify an acceptable context limit. |
| Long-output probe | 1 then 2 | Short input, bounded longer answer | Measure sustained decoding and slot occupancy. |
| Recovery | Repeat baseline after a busy run | Short prompt | Confirm latency returns near baseline after the queue drains. |

## Safe default starting values

| Setting | Start with | Do not change until baseline is recorded |
|---|---:|---|
| Model | One known-good model | Yes |
| Virtual users | 1 | Yes |
| User ramp | 500 ms | Yes |
| Maximum output | 128 tokens | Yes |
| Input context | A conservative cap for the selected model | Yes |
| Request timeout | 90 seconds for a short-output test | Yes |
| Gateway/model slots | 1 or 2 | Yes |

After the baseline is stable, increase only **one variable** per test: users, context size, output length, or model slot count. Changing several at the same time makes the result hard to interpret.

## Starting go/no-go rules

These are operational starting thresholds, not universal standards. Tune them to the customer experience you want to offer.

| Observation | Interpretation | Action |
|---|---|---|
| Zero errors and two-user p95 TTFT is close to the one-user baseline | The machine likely has headroom for a small concurrent workload. | Test the next concurrency step. |
| Aggregate completed work improves but individual TTFT rises moderately | Batching is trading individual latency for total throughput. | Decide whether the target product values throughput or chat responsiveness. |
| Queue wait rises sharply between one concurrency step and the next | The server is at or beyond useful slot capacity. | Set the lower step as the candidate public limit. |
| Repeated 429/503 responses from the gateway | Admission limits are functioning. | Keep the cap; do not replace it with an unbounded queue. |
| Model crash, system-wide unresponsiveness, or memory-pressure symptoms | The configuration is unsafe. | Stop, reduce slots/context/output, restart, and repeat from a lower level. |
| Baseline remains slow after a busy run | Cache, model swapping, or process recovery may be impaired. | Investigate before increasing load. |

## Data-handling rule

Use synthetic prompts in Phase 0. Do not put customer data, API secrets, personal data, proprietary documents, or production system prompts into a browser-based load test. The dashboard must not persist the configured API key or prompt text beyond the active browser session unless the operator explicitly exports a local result file.

## Phase 0 output

At the end of Phase 0, record the model/version, server settings, dashboard settings, test date, p50/p95 TTFT, p50/p95 elapsed time, errors, chosen public concurrency cap, queue cap, maximum input context, maximum output tokens, and the reason for each selected limit. These values become the initial gateway policy for Phase 1.

## Sources

[1]: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md "llama.cpp server documentation"

[2]: https://docs.ollama.com/faq "Ollama FAQ"

[3]: https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/ "vLLM automatic prefix caching"
