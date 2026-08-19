# Phase 0 Results Record

Copy this document for every test configuration that you intend to compare. The purpose is to preserve the conditions behind a result, not merely the best observed number.

## Test identity

| Field | Value |
|---|---|
| Test ID | `P0-YYYYMMDD-XX` |
| Operator | |
| Date and local time | |
| Mac state | Cold model / warm model / restarted model |
| Test objective | Baseline / shared prefix / independent users / long context / long output / recovery |

## Server configuration

| Field | Value |
|---|---|
| Backend | llama.cpp / Ollama / MLX-LM / other |
| Backend version | |
| Model identifier and quantization | |
| Model context setting | |
| Server slots / parallel setting | |
| Continuous batching | On / Off / Unknown |
| Prompt caching | On / Off / Unknown |
| Local endpoint | `http://127.0.0.1:.../v1` |
| CORS origin allowed | |

## Dashboard configuration

| Field | Value |
|---|---|
| Virtual users | |
| User ramp | |
| Independent-user suffix | On / Off |
| Prompt description and approximate length | |
| Maximum output tokens | |
| Browser timeout | |

## Measured outcome

| Metric | Value | Notes |
|---|---:|---|
| Completed users | | |
| Failed users | | Include HTTP status or error text. |
| Cancelled users | | |
| p50 TTFT | | |
| p95 TTFT | | |
| p50 elapsed | | |
| p95 elapsed | | |
| Server-reported prompt tokens | | Mark `not reported` if absent. |
| Server-reported completion tokens | | Mark `not reported` if absent. |
| Mac/model-server symptoms | | Memory pressure, crash, unexpected swapping, slow recovery, or none. |

## Decision

> **Decision:** Accept / reject / repeat with one changed variable.

Explain the decision in complete sentences. State whether this configuration becomes the candidate capacity limit, why it is acceptable or unacceptable, and what single variable will change in the next run.

| Candidate policy value | Chosen value | Evidence |
|---|---:|---|
| Active model slots | | |
| Public active-request limit | | |
| Gateway queue cap | | |
| Maximum input context | | |
| Maximum output tokens | | |
| Request timeout | | |
| Recommended customer plan | Interactive chat / batch / internal only / not ready |
