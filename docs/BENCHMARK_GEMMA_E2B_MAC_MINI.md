# Verified Benchmark: Gemma E2B on Mac mini via llama.cpp

**Recorded:** 19 August 2026  
**Author:** Manus AI, based on the operator’s Phase 0 dashboard captures  
**Status:** Verified for the exact workload below; not a universal capacity guarantee.

## Executive conclusion

> Under the tested long-answer workload, this Mac mini and llama.cpp configuration supported **four promptly streaming requests at once**. The **fifth request was the first to queue**, and the sixth queued behind the active group as well. All six requests completed without faults, but queued users experienced materially worse time to first stream.

The practical initial operating boundary is therefore **four active requests per loaded model**. For interactive customers, do not allow unbounded waiting beyond four active requests. For a protected gateway, return a controlled `429` or `503` with retry guidance after the fourth active request, unless the caller has explicitly selected a batch/async queue.

## Exact tested configuration

| Item | Verified value |
|---|---|
| Host | User-owned **Mac mini M4 with 16 GB unified memory**. |
| Inference runtime | **llama.cpp** router/API, bound to `127.0.0.1:8080`. |
| Model ID | `ggml-org/gemma-4-E2B-it-GGUF:Q8_0`. This exact model name—not an Ollama model name—must be used in API requests. |
| Model size | Gemma **E2B** (approximately two billion parameters), Q8_0 GGUF quantization. |
| Context configuration observed in the llama.cpp preset | `8192` tokens. |
| API shape | OpenAI-compatible `POST /v1/chat/completions` with SSE streaming. |
| Dashboard endpoint | `http://127.0.0.1:8080/v1`. |
| Number of virtual users | `6`. |
| Launch ramp | `500 ms` between virtual-user launches. |
| Maximum output requested | `8192` tokens. |
| Request timeout | `200000 ms` (200 seconds). |
| User isolation | Enabled. Every virtual user received the shared base prompt plus a small independent-user suffix. |
| Workload | Long structured response: 12 numbered sections of 80–120 words, each with a concrete recommendation, followed by a checklist. |

The model emitted a separated `reasoning_content` stream before its final `content` stream. The tester measures first stream from the first meaningful reasoning or answer token, then presents both channels separately.

## Six-user evidence

The following values were read from the completed Phase 0 virtual-user channels. **First stream** is the best available queue/concurrency indicator; a large rise means a request waited before the model began useful output.

| Virtual user | First stream | Elapsed time | Server-reported output rate | Interpretation |
|---|---:|---:|---:|---|
| VU-01 | 0.911 s | 66.69 s | 23.5 tok/s | Promptly admitted to the active inference group. |
| VU-02 | 1.50 s | 72.31 s | 22.1 tok/s | Promptly admitted to the active inference group. |
| VU-03 | 1.33 s | 72.42 s | 22.9 tok/s | Promptly admitted to the active inference group. |
| VU-04 | 1.55 s | 77.80 s | 22.7 tok/s | Promptly admitted to the active inference group. |
| VU-05 | 65.40 s | 131.65 s | 23.8 tok/s | **Queued** until a first-wave request freed capacity. |
| VU-06 | 70.32 s | 129.40 s | 23.1 tok/s | **Queued** until a first-wave request freed capacity. |

| Derived observation | Value | Meaning |
|---|---:|---|
| Immediate active capacity | **4 requests** | VU-01 through VU-04 all reached first stream in 0.911–1.55 seconds. |
| Queue start | **5th request** | VU-05, not VU-06, is the first queued request. |
| First-wave p50 first-stream time | 1.415 s | Typical initial interactive latency under the tested four-user load. |
| First-wave p95 first-stream time | 1.543 s | Tail initial latency within the active group. |
| First-wave mean output rate | 22.8 tok/s | Per-request rate across the first four concurrent long answers. |
| Queued first-stream delay | 65.40–70.32 s | Too long for an interactive chat experience; acceptable only for a clearly asynchronous/batch queue. |
| Run faults | 0 / 6 | All requests eventually completed in this exact test. |

## Correct interpretation

The run shows **four active inference slots**, not six. The five- and six-user requests completed because llama.cpp queued them; success does not mean six concurrent users received interactive service. VU-05 and VU-06 waited roughly a minute before their first useful streamed token, which is a poor interactive experience even though the final response completed.

The model’s total throughput was effectively shared across the active requests. Each of the first four long streams reported roughly 22–24 tokens/second. This is a strong and useful result for a small local host, but it must be treated as a workload-specific measurement: model, quantization, context length, requested output length, prompt complexity, and thermal condition all matter.

## Initial operating policy

The initial gateway should make the measured boundary explicit rather than relying on the inference server’s internal queue alone.

| Workload class | Active model requests | Queue behavior | Gateway response after capacity | Rationale |
|---|---:|---|---|---|
| Interactive chat/API | 4 globally | Prefer no hidden queue. | Return `429 Too Many Requests` or `503 Service Unavailable` with a `Retry-After` value. | The 5th request waited about 65 seconds in this test, which is unsuitable for interactive use. |
| Opt-in batch/async task | 4 globally | Queue up to 2 initially, with visible position/status. | Accept only when the caller agrees to asynchronous completion. | VU-05 and VU-06 completed successfully, but with long first-stream waits. |
| Per API key | 1 active by default | Do not let one customer occupy all four global slots. | Queue/reject that customer’s additional request first. | This is a fairness control; it was not separately benchmarked and should be re-tested before commercial launch. |

If serving the model directly with `llama serve`, set the server’s initial parallel-slot configuration explicitly to **four** with `-np 4` or `--parallel 4`; llama.cpp documents this option as the number of server slots for concurrent requests.[1] If using the existing llama.cpp router, enforce the same **four active request** limit at the gateway/control-plane layer until a future benchmark proves a different safe limit.

## Recommended next tests

Run each experiment three times and change only one variable per experiment. Record the actual prompt, output cap, model state, and ambient/thermal conditions with every run.

| Priority | Experiment | Pass criterion |
|---:|---|---|
| 1 | Repeat this exact six-user test on a different day. | Four requests remain promptly streaming; fifth request remains the clear queue boundary. |
| 2 | Run a short interactive prompt at 1, 2, 3, 4, and 5 users. | Select a separate capacity policy for short-chat work, if different. |
| 3 | Run the long workload at 4 users with a 4096-token cap. | Compare response time, answer completeness, and concurrency behavior against the 8192-token workload. |
| 4 | Measure CPU/GPU memory and system responsiveness during the six-user run. | Confirm the Mac mini remains responsive and no memory pressure/swap condition is introduced. |
| 5 | Put a gateway in front of llama.cpp with a global limit of 4 and one active request per test API key. | Validate fairness, `429` behavior, logs, and cancellation. |

## Limitations and safety notes

This result is a **capacity observation**, not a customer-facing service-level agreement. It does not test public-internet latency, Cloudflare routing, authentication overhead, malicious inputs, billing, long-lived conversation context, or a mix of model types. It also does not establish that 16 GB unified memory safely supports every model, context length, or multimodal request.

Do not expose the llama.cpp endpoint itself publicly. Keep it bound to `127.0.0.1`; expose only a future authenticated gateway that enforces the active-request and per-key limits above.

## References

[1]: https://llama.app/docs/serve "llama.cpp — Running a server"
