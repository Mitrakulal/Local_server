/**
 * Luminous Utility style: an Apple-inspired, daylight conversation surface.
 * The browser keeps only session-scoped conversation text; it never receives
 * CHAT_GATEWAY_KEY or any gateway administrator secret.
 */
import { Streamdown } from "streamdown";
import {
  ArrowUp,
  CircleStop,
  KeyRound,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";
type ChatEntry = {
  id: string;
  role: Role;
  content: string;
  pending?: boolean;
  error?: boolean;
};

const SESSION_KEY = "luminous-utility-owner-chat-v1";
const greeting: ChatEntry = {
  id: "greeting",
  role: "assistant",
  content:
    "I’m ready when you are. This conversation stays in the current browser session and runs through your bounded local gateway.",
};

function loadSession() {
  try {
    const value = window.sessionStorage.getItem(SESSION_KEY);
    const parsed = value ? (JSON.parse(value) as ChatEntry[]) : undefined;
    return Array.isArray(parsed) && parsed.length ? parsed : [greeting];
  } catch {
    return [greeting];
  }
}

function compactError(raw: string, status: number) {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; code?: string } };
    return parsed.error?.message || parsed.error?.code || `Request failed (${status}).`;
  } catch {
    return raw.trim().slice(0, 220) || `Request failed (${status}).`;
  }
}

function PrismMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`grid h-10 w-10 place-items-center rounded-[14px] bg-gradient-to-br from-[#3558e8] via-[#6985ff] to-[#dfe6ff] shadow-[0_10px_24px_rgba(74,103,234,0.28)] ${className}`}
      aria-hidden="true"
    >
      <span className="h-3.5 w-3.5 rounded-full border border-white/80 bg-white/70 shadow-[0_1px_5px_rgba(29,29,31,0.18)]" />
    </span>
  );
}

export default function OwnerChat() {
  const [ownerToken, setOwnerToken] = useState("");
  const [draftToken, setDraftToken] = useState("");
  const [messages, setMessages] = useState<ChatEntry[]>(() => loadSession());
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isStreaming]);

  const clearConversation = () => {
    if (isStreaming) return;
    setError("");
    setMessages([greeting]);
    window.sessionStorage.removeItem(SESSION_KEY);
  };

  const submitToken = (event: FormEvent) => {
    event.preventDefault();
    const value = draftToken.trim();
    if (value.length < 32) {
      setError("Enter the full private owner-chat token from the Mac mini environment file.");
      return;
    }
    setOwnerToken(value);
    setDraftToken("");
    setError("");
  };

  const cancel = () => abortRef.current?.abort();

  const send = async () => {
    const content = draft.trim();
    if (!content || isStreaming) return;
    if (!ownerToken) {
      setError("Owner chat access is required before sending a message.");
      return;
    }

    const userMessage: ChatEntry = { id: crypto.randomUUID(), role: "user", content };
    const assistantId = crypto.randomUUID();
    const assistantMessage: ChatEntry = {
      id: assistantId,
      role: "assistant",
      content: "",
      pending: true,
    };
    const conversation = [...messages, userMessage]
      .filter(message => message.id !== "greeting")
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }));

    setDraft("");
    setError("");
    setMessages(current => [...current, userMessage, assistantMessage]);
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/chat/api/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-owner-chat-token": ownerToken,
        },
        body: JSON.stringify({ messages: conversation, max_tokens: 512 }),
      });
      if (!response.ok) throw new Error(compactError(await response.text(), response.status));
      if (!response.body) throw new Error("The model returned no stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let output = "";
      const applyLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") return;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null } }>;
          };
          const delta = chunk.choices?.[0]?.delta;
          const token =
            typeof delta?.content === "string"
              ? delta.content
              : typeof delta?.reasoning_content === "string"
                ? delta.reasoning_content
                : "";
          if (!token) return;
          output += token;
          setMessages(current =>
            current.map(message =>
              message.id === assistantId ? { ...message, content: output, pending: true } : message
            )
          );
        } catch {
          // One malformed upstream event must not discard a valid stream.
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        lines.forEach(applyLine);
        if (done) break;
      }
      if (buffer) applyLine(buffer);
      setMessages(current =>
        current.map(message =>
          message.id === assistantId
            ? { ...message, content: output || "The model completed without an answer token.", pending: false }
            : message
        )
      );
    } catch (reason) {
      const message =
        controller.signal.aborted
          ? "Response stopped. Your previous messages remain in this session."
          : reason instanceof Error
            ? reason.message
            : "The local model connection failed.";
      setMessages(current =>
        current.map(item =>
          item.id === assistantId ? { ...item, content: message, pending: false, error: true } : item
        )
      );
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  if (!ownerToken) {
    return (
      <main className="luminous-shell min-h-screen overflow-hidden bg-[#f5f5f7] px-4 py-4 text-[#1d1d1f] sm:px-7 sm:py-7">
        <div className="luminous-atmosphere pointer-events-none fixed inset-0" />
        <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl flex-col justify-between overflow-hidden rounded-[32px] border border-white/80 bg-white/65 p-5 shadow-[0_24px_80px_rgba(30,44,84,0.11)] backdrop-blur-2xl sm:min-h-[calc(100vh-3.5rem)] sm:p-8">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <PrismMark />
              <div>
                <p className="text-[15px] font-semibold tracking-[-0.025em] text-[#1d1d1f]">Mattr Chat</p>
                <p className="mt-0.5 text-[11px] font-medium text-[#6e6e73]">Private local conversation</p>
              </div>
            </div>
            <span className="hidden rounded-full border border-[#d2d8ef] bg-white/70 px-3 py-1.5 text-[11px] font-medium text-[#5363a9] sm:block">Owner access</span>
          </header>

          <section className="mx-auto w-full max-w-xl py-14 sm:py-24">
            <div className="mb-7 flex items-center gap-2 text-[12px] font-medium text-[#5267b8]">
              <span className="h-2 w-2 rounded-full bg-[#67b691] shadow-[0_0_0_4px_rgba(103,182,145,0.12)]" />
              Local model available
            </div>
            <h1 className="luminous-display max-w-lg text-[46px] leading-[0.96] tracking-[-0.058em] text-[#1d1d1f] sm:text-[68px]">
              A private space to think.
            </h1>
            <p className="mt-7 max-w-md text-[16px] leading-7 text-[#6e6e73]">
              A calm conversation surface for your local model. The session stays in this browser, while the model key stays on your server.
            </p>
            <form className="mt-9" onSubmit={submitToken}>
              <label className="block">
                <span className="text-[12px] font-semibold text-[#515154]">Owner chat token</span>
                <div className="mt-2 flex items-center rounded-[18px] border border-[#d9d9dc] bg-white p-1.5 shadow-[0_8px_26px_rgba(29,29,31,0.06)] transition-shadow focus-within:border-[#8ca0ff] focus-within:shadow-[0_0_0_4px_rgba(91,124,250,0.12)]">
                  <KeyRound className="ml-3 h-4 w-4 text-[#7a7a80]" />
                  <input
                    value={draftToken}
                    onChange={event => setDraftToken(event.target.value)}
                    type="password"
                    autoComplete="off"
                    placeholder="Paste private owner-chat token"
                    className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-[#1d1d1f] outline-none placeholder:text-[#9b9ba1]"
                  />
                  <button type="submit" className="rounded-[14px] bg-[#1d1d1f] px-4 py-3 text-xs font-semibold text-white transition-all duration-150 hover:bg-[#323235] active:scale-[0.97]">Continue</button>
                </div>
              </label>
            </form>
            {error && <p className="mt-3 rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#b42318]">{error}</p>}
          </section>

          <footer className="flex items-center gap-2 text-[11px] font-medium text-[#86868b]"><ShieldCheck className="h-4 w-4 text-[#6377d3]" /> Session-only history · key remains server-side</footer>
        </div>
      </main>
    );
  }

  return (
    <main className="luminous-shell min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      <div className="luminous-atmosphere pointer-events-none fixed inset-0" />
      <div className="relative mx-auto grid min-h-screen max-w-[1680px] grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)_230px]">
        <aside className="border-b border-[#e6e6e9] bg-white/70 p-4 backdrop-blur-xl lg:border-b-0 lg:border-r lg:p-5">
          <div className="flex items-center justify-between lg:block">
            <div className="flex items-center gap-3"><PrismMark /><div><p className="text-[15px] font-semibold tracking-[-0.025em]">Mattr Chat</p><p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#86868b]">Owner session</p></div></div>
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#2d8b5e]"><span className="h-2 w-2 rounded-full bg-[#56b27d]" /> Available</span>
          </div>
          <div className="mt-7 hidden lg:block"><p className="text-[11px] font-semibold text-[#86868b]">Current conversation</p><div className="mt-3 rounded-[18px] border border-[#e6e6e9] bg-white p-3.5 shadow-[0_6px_18px_rgba(29,29,31,0.035)]"><p className="text-sm font-medium">Untitled conversation</p><p className="mt-1 text-[11px] leading-4 text-[#86868b]">Session only · {messages.filter(message => message.id !== "greeting").length} messages</p></div></div>
          <button onClick={clearConversation} disabled={isStreaming} className="mt-4 flex w-full items-center justify-center gap-2 rounded-[15px] border border-[#dedee2] bg-white px-3 py-3 text-xs font-semibold text-[#3a3a3c] transition-all hover:border-[#b9c4ff] hover:bg-[#f7f8ff] disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-4 w-4 text-[#566dd0]" /> New conversation</button>
          <p className="mt-4 hidden rounded-[15px] bg-[#f0f2fa] p-3 text-[11px] leading-5 text-[#69708e] lg:block">Conversation history stays in this browser session. Clear removes it here.</p>
        </aside>

        <section className="flex min-h-0 flex-col">
          <header className="flex items-center justify-between border-b border-[#e6e6e9] bg-white/45 px-4 py-4 backdrop-blur-xl sm:px-8"><div><p className="text-[11px] font-semibold text-[#86868b]">Conversation</p><h1 className="mt-0.5 text-[15px] font-semibold tracking-[-0.015em]">Gemma E2B</h1></div><button onClick={clearConversation} disabled={isStreaming} className="flex items-center gap-2 rounded-[11px] px-2.5 py-2 text-[11px] font-semibold text-[#6e6e73] transition-colors hover:bg-white hover:text-[#1d1d1f] disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" /> Clear</button></header>
          <div className="flex-1 overflow-y-auto px-4 py-9 sm:px-9 lg:px-14"><div className="mx-auto max-w-3xl space-y-8">
            {messages.map(message => <article key={message.id} className={`luminous-chat-entry ${message.role === "user" ? "ml-auto max-w-[88%] sm:max-w-[75%]" : "max-w-full"}`}><div className={`flex items-center gap-2 text-[11px] font-semibold ${message.role === "user" ? "justify-end text-[#6e6e73]" : "text-[#5369c5]"}`}>{message.role === "assistant" ? <><Sparkles className="h-3.5 w-3.5" /> Mattr</> : "You"}</div><div className={`mt-2 rounded-[20px] px-4 py-3.5 text-[15px] leading-7 ${message.role === "user" ? "bg-[#1d1d1f] text-white shadow-[0_10px_24px_rgba(29,29,31,0.12)]" : message.error ? "border border-red-200 bg-red-50 text-[#b42318]" : "border border-[#e6e6e9] bg-white/82 text-[#2e2e31] shadow-[0_8px_24px_rgba(29,29,31,0.035)]"}`}>{message.role === "assistant" ? <Streamdown>{message.content || ""}</Streamdown> : <p className="whitespace-pre-wrap">{message.content}</p>}{message.pending && <span className="luminous-cursor ml-1 inline-block h-4 w-[2px] bg-[#5b7cfa] align-[-2px]" />}</div></article>)}
            <div ref={bottomRef} />
          </div></div>
          <div className="border-t border-[#e6e6e9] bg-white/70 px-4 py-4 backdrop-blur-xl sm:px-8"><div className="mx-auto max-w-3xl"><div className="rounded-[22px] border border-[#dcdce1] bg-white p-2 shadow-[0_12px_36px_rgba(29,29,31,0.08)] transition-shadow focus-within:border-[#a8b6ff] focus-within:shadow-[0_0_0_4px_rgba(91,124,250,0.12)]"><textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} placeholder="Ask anything…" rows={2} disabled={isStreaming} className="max-h-40 min-h-[54px] w-full resize-none bg-transparent px-3 py-2 text-[15px] leading-6 text-[#1d1d1f] outline-none placeholder:text-[#9b9ba1] disabled:opacity-50" /><div className="flex items-center justify-between px-2 pb-1"><span className="text-[10px] font-medium text-[#86868b]">Enter to send · Shift + Enter for a new line</span>{isStreaming ? <button onClick={cancel} className="flex h-9 items-center gap-2 rounded-[12px] bg-[#fff1f0] px-3 text-xs font-semibold text-[#c0392b] transition-colors hover:bg-[#ffe4e1]"><CircleStop className="h-4 w-4" /> Stop</button> : <button onClick={() => void send()} disabled={!draft.trim()} className="grid h-9 w-9 place-items-center rounded-[12px] bg-[#5b7cfa] text-white shadow-[0_7px_16px_rgba(91,124,250,0.3)] transition-all duration-150 hover:bg-[#4b6bea] disabled:cursor-not-allowed disabled:opacity-35 active:scale-[0.97]" aria-label="Send message"><ArrowUp className="h-4 w-4" /></button>}</div></div>{error && <p className="mt-2 text-xs text-[#c0392b]">{error}</p>}</div></div>
        </section>

        <aside className="hidden border-l border-[#e6e6e9] bg-white/55 p-5 backdrop-blur-xl lg:block"><p className="text-[11px] font-semibold text-[#86868b]">About this session</p><div className="mt-5 space-y-6"><div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a9aa0]">Model</p><p className="mt-1 text-sm font-medium">gemma-e2b</p></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a9aa0]">Shared capacity</p><p className="mt-1 text-sm font-medium">4 active responses</p><p className="mt-1 text-[11px] leading-4 text-[#86868b]">This private chat uses one bounded gateway identity.</p></div><div className="border-t border-[#e7e7ea] pt-5"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a9aa0]">Privacy</p><p className="mt-1 text-[12px] leading-5 text-[#6e6e73]">Conversation text stays in this browser session. It is not stored as a server transcript.</p></div></div></aside>
      </div>
    </main>
  );
}
