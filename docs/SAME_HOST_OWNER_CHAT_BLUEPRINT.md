# Same-host Public Mattr Chat Blueprint

## Purpose

Add a smooth, ChatGPT-style **public Mattr Chat** at `https://google.mattrlabs.online/` while preserving the existing issued-key developer API at `https://google.mattrlabs.online/v1`. The public hostname continues to expose only controlled paths; raw llama.cpp on port 8080 and the private Owner Console on port 3000 remain unavailable through Cloudflare.

## First-release scope

The first public release is a **small three-seat chat**, not a customer account or transcript service. It has browser-session conversations, streamed responses, a clear-conversation action, and no server-side transcript database. Browser-session history is stored only in `sessionStorage`; closing the browser session or pressing Clear removes it locally. This avoids inventing account recovery, multi-device synchronization, retention policy, or a shared customer transcript store before they are needed.

| Capability | First release | Later customer version |
|---|---|---|
| Access | Public chat with three shared active seats | Real user accounts and persisted tenant access |
| Conversations | One browser-session conversation | Multiple persisted conversations per user |
| History storage | Browser `sessionStorage` only | Database with explicit retention policy |
| Gateway identity | One internal `public-chat` API key, server-side only | Separate per-user or per-plan gateway identities |
| Capacity | Three public chat seats; gateway retains four global slots | Per-user quotas plus shared four-slot capacity |
| Billing | None | Usage plans and payment flow, if needed |

## Same-host path contract

```text
https://google.mattrlabs.online/
    └─ Chat application HTML and assets

https://google.mattrlabs.online/chat/api/completions
    └─ Public-chat backend; server admission limit of three active streams
    └─ Adds the internal CHAT_GATEWAY_KEY server-side
    └─ Streams SSE from gateway to browser

https://google.mattrlabs.online/v1/*
    └─ Existing gateway API proxy; client-supplied gma_live_ key remains required

https://google.mattrlabs.online/healthz
    └─ Existing public gateway health proxy

http://127.0.0.1:3000/admin
    └─ Existing SSH-only Owner Console; never routed publicly

http://127.0.0.1:8080
    └─ Raw llama.cpp; never routed publicly
```

## Security boundary

The chat browser never receives `GATEWAY_ADMIN_TOKEN`, `OWNER_CONSOLE_TOKEN`, or `CHAT_GATEWAY_KEY`. It sends only a bounded conversation and selected answer mode to `/chat/api/completions`. The local router reserves one of three public seats, injects the internal chat gateway key while proxying, and releases the seat on completion, failure, or disconnect.

The internal `CHAT_GATEWAY_KEY` is created as a distinct `public-chat` tenant key with an explicit three-active-request policy and 2,048-token maximum. The public interface requests either a 1,024-token standard answer or a 2,048-token long answer. This key must not be reused as a customer key or typed into a browser.

## Local routing before Cloudflare cutover

The same-host router is a separate loopback process on port 3001:

```text
Cloudflare Tunnel (after cutover)
  google.mattrlabs.online → http://127.0.0.1:3001

Router port 3001
  /v1/*, /healthz → gateway port 8787
  /chat/api/*     → public-chat admission/proxy → gateway port 8787
  everything else → built Chat application
```

The public tunnel now targets port 3001. The retained timestamped port-8787 configuration backup remains the immediate rollback option if either chat or API verification fails.

## Session decision

Use **one session-scoped conversation** now. This gives a real ChatGPT-like flow—multi-turn context within a browser tab/session—without storing prompts and answers on the server. The chat page clearly explains that history remains only in the present browser session. A later customer application can add saved sessions only after selecting a database, writing a retention policy, adding user authentication, and isolating every user’s data.

## Acceptance checks

1. A browser can open the public chat without a manager-token screen and `GET /chat/api/status` reports the live `active`, `limit`, and answer-budget fields.
2. Three simultaneous public chat requests are admitted; a fourth receives `429 chat_capacity_full`; an admitted request streams through the router and ends in `data: [DONE]`.
3. A developer request to `/v1/chat/completions` still requires its own API key and streams unchanged.
4. Port 8080 and `/admin` remain unavailable through the same public hostname.
5. The chat page clears browser-session history locally and never exposes the internal key in source, network payload, or browser storage.

## Local interface validation

The implementation was opened against a temporary router with validation-only placeholder secrets. The supplied chat-product references govern the visual layout: the public workspace renders directly with a persistent session-history rail, a thin central header, a green live-capacity label, a centered reading-first conversation feed, compact assistant message actions, a locked API-coming-soon preview, and one large composer anchored below the feed. The composer exposes a 1K standard / 2K long-answer control. The browser-session history rail contains only genuinely created local conversations. The private Load Lab and Owner Console retain their separate operational visual systems.

Assistant messages now keep model-emitted `reasoning_content` separate from final content. The workspace presents a light gray native **Thinking** disclosure above the main answer. For Gemma-style ordinary content that explicitly marks a `Final Output` or `Final Answer`, the interface uses that marker to keep the preceding user-facing reasoning summary inside the disclosure and the final response below it. The server prompt also asks the model not to narrate its planning in final content.
