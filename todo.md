# Phase 0 delivery checklist

- [x] Define the test plan model, safe default limits, and metric calculations.
- [x] Build the endpoint configuration and virtual-user scenario controls.
- [x] Build the concurrent streaming request runner with cancellation and bounded launch behavior.
- [x] Build live per-user status cards, response previews, and aggregate percentile metrics.
- [x] Document local API prerequisites, endpoint format, CORS, and key-handling guidance.
- [x] Document benchmark scenarios, metric definitions, result interpretation, and go/no-go thresholds.
- [x] Document failure modes, troubleshooting, data-handling limits, and the transition to a protected gateway.
- [x] Validate the TypeScript build and perform a local visual verification.
- [x] Transfer the complete source and documentation into the selected GitHub repository.
- [ ] Run the first real baseline against the Mac mini endpoint, then repeat with two virtual users.
- [x] Create a clean ZIP archive containing the dashboard source and all Phase 0 requirement documentation.
- [x] Publish the completed dashboard source and documentation to `Mitrakulal/Local_server`.
- [x] Write a beginner-friendly laptop-to-Mac-mini SSH testing guide with all commands and first benchmark steps.
- [ ] Trigger automatic loading of `ggml-org/gemma-4-E2B-it-GGUF:Q8_0` through a router chat request, verify its streamed response, and run the first one-user dashboard baseline.
- [ ] Verify the model locally on the Mac mini, then verify the forwarded endpoint from Windows PowerShell using `curl.exe` after the SSH tunnel is open.
- [x] Verify that the llama.cpp router sends OpenAI-compatible SSE token events.
- [x] Update the dashboard to treat llama.cpp `delta.reasoning_content` as a valid first stream token and display it separately from `delta.content`.
