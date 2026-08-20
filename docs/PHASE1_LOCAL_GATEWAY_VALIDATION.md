# Phase 1 Local Gateway Validation

**Status:** Passed locally on the Mac mini through SSH tunnelling.  
**Selected model:** `ggml-org/gemma-4-E2B-it-GGUF:Q8_0` behind llama.cpp.  
**Gateway public model alias:** `gemma-e2b`.  
**Gateway endpoint:** loopback-only `http://127.0.0.1:8787/v1`.

## What was validated

The Phase 1 gateway was tested with the dashboard against the running Mac mini service. The smoke check and same-key fairness check passed. The final capacity check used five distinct invited-user keys with no launch ramp.

| Control | Configured policy | Observed result | Status |
|---|---:|---|---|
| Gateway reachability | Gateway on `127.0.0.1:8787` to llama.cpp on `127.0.0.1:8080` | Health check returned `ok`, model `gemma-e2b`, and backend `reachable`. | Passed |
| Customer-key authentication | Bearer API key required | Valid invited-user keys streamed model output. | Passed |
| Same-key fairness | 1 active generation per key | A second overlapping request from the same key was blocked in the dashboard as expected. | Passed |
| Global capacity | 4 active generations | Four distinct customer keys completed generation. | Passed |
| Fifth-request protection | Fifth request rejected before model dispatch | VU-05 was marked **PROTECTED** with `capacity_busy`. | Passed |
| Stream preservation | OpenAI-compatible SSE relay | The four admitted requests streamed Gemma output and completed with server reason `stop`. | Passed |

## Capacity-test evidence

The five-key test admitted VU-01 through VU-04. Their first meaningful reasoning tokens arrived in approximately **1.60–1.74 seconds**. The dashboard recorded p50 TTFT of **1.65 seconds**, p95 TTFT of **1.74 seconds**, and p95 elapsed time of **18.69 seconds** for the successful requests.

VU-05 did not enter llama.cpp. It received the intentional gateway response `capacity_busy`, which the dashboard displayed as **PROTECTED** rather than a failure. This confirms the gateway preserves the measured four-active-request Mac mini boundary and does not permit invisible minute-long waiting for the fifth interactive user.

> **Operational policy confirmed:** begin with at most four active long generations globally and one active long generation per invited-user key. Return a clear retry response rather than silently queuing a fifth interactive request.

## What remains before public exposure

The local gateway is working, but it must remain loopback-only for now. Before any Cloudflare route or external user is enabled, rotate every test key visible in terminal output or screenshots, install the gateway as the documented user-level `launchd` service, verify it restarts after a terminal/SSH disconnect, and perform the Cloudflare edge-security stage. Do not route Cloudflare directly to llama.cpp port 8080.

## Credential hygiene

The screenshots used during testing displayed API keys. Those keys must be treated as compromised test credentials, revoked by prefix, and replaced before any non-local use. The gateway itself stores only keyed hashes of API keys, but anyone who copied a visible raw key could make requests until that key is revoked.
