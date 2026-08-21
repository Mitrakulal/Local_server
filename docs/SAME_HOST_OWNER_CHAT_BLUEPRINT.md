# Same-host Owner Chat Blueprint

## Purpose

Add a smooth, ChatGPT-style **owner chat** at `https://google.mattrlabs.online/` while preserving the existing developer API at `https://google.mattrlabs.online/v1`. The public hostname continues to expose only controlled paths; raw llama.cpp on port 8080 and the private Owner Console on port 3000 remain unavailable through Cloudflare.

## First-release scope

The first release is an **owner-only chat**, not a public customer chat service. It has one active conversation in the current browser session, streamed responses, a clear-conversation action, and no server-side transcript database. Browser-session history is stored only in `sessionStorage`; closing the browser session or pressing Clear removes it locally. This avoids inventing account recovery, multi-device synchronization, retention policy, or a shared customer transcript store before they are needed.

| Capability | First release | Later customer version |
|---|---|---|
| Access | One owner chat token | Real user accounts and invite-only access |
| Conversations | One browser-session conversation | Multiple persisted conversations per user |
| History storage | Browser `sessionStorage` only | Database with explicit retention policy |
| Gateway identity | One internal `owner-chat` API key | Separate per-user or per-plan gateway identities |
| Capacity | One active owner-chat request | Per-user quotas plus shared four-slot capacity |
| Billing | None | Usage plans and payment flow, if needed |

## Same-host path contract

```text
https://google.mattrlabs.online/
    └─ Chat application HTML and assets

https://google.mattrlabs.online/chat/api/completions
    └─ Owner-chat backend; requires X-Chat-Owner-Token
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

The chat browser never receives `GATEWAY_ADMIN_TOKEN`, `OWNER_CONSOLE_TOKEN`, or `CHAT_GATEWAY_KEY`. It only sends an owner-entered `OWNER_CHAT_TOKEN` to `/chat/api/completions`. The local router checks that token using timing-safe comparison, injects the internal chat gateway key while proxying, and forwards only the model stream.

The internal `CHAT_GATEWAY_KEY` is created as a distinct `owner-chat` tenant key. It should keep the existing one-active-request limit and receive a limited output allowance; it must not be reused as a customer key or typed into a browser.

## Local routing before Cloudflare cutover

The same-host router is a separate loopback process on port 3001:

```text
Cloudflare Tunnel (after cutover)
  google.mattrlabs.online → http://127.0.0.1:3001

Router port 3001
  /v1/*, /healthz → gateway port 8787
  /chat/api/*     → authenticated owner-chat proxy → gateway port 8787
  everything else → built Chat application
```

The current tunnel YAML must continue to target port 8787 until local checks prove both `/v1/chat/completions` and `/chat/api/completions` work through port 3001. Cutover is one reversible YAML line change backed by the existing timestamped configuration backup process.

## Session decision

Use **one session-scoped conversation** now. This gives a real ChatGPT-like flow—multi-turn context within a browser tab/session—without storing prompts and answers on the server. The chat page clearly explains that history remains only in the present browser session. A later customer application can add saved sessions only after selecting a database, writing a retention policy, adding user authentication, and isolating every user’s data.

## Acceptance checks

1. A browser without `OWNER_CHAT_TOKEN` receives `401` from `/chat/api/completions`.
2. An owner chat request streams through the local router and ends in `data: [DONE]`.
3. A developer request to `/v1/chat/completions` still requires its own API key and streams unchanged.
4. Port 8080 and `/admin` remain unavailable through the same public hostname.
5. The chat page clears browser-session history locally and never exposes the internal key in source, network payload, or browser storage.

## Local interface validation

The implementation was opened against a temporary router with validation-only placeholder secrets. The supplied chat-product references now govern the visual layout: the owner token gate sits inside the same compact app shell, and successful login renders a persistent session-history rail, a thin central header, a centered reading-first conversation feed, compact assistant message actions, and one large composer anchored below the feed. The browser-session history rail contains only genuinely created local conversations. The private load lab and Owner Console retain their separate operational visual systems.

Assistant messages now keep model-emitted `reasoning_content` separate from final content. The workspace presents a light gray native **Thinking** disclosure above the main answer. For Gemma-style ordinary content that explicitly marks a `Final Output` or `Final Answer`, the interface uses that marker to keep the preceding user-facing reasoning summary inside the disclosure and the final response below it. The server prompt also asks the model not to narrate its planning in final content.
