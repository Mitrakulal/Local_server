/**
 * Nocturne Ledger style: a warm midnight writing room. The browser keeps only
 * session-scoped conversation text; it never receives CHAT_GATEWAY_KEY.
 */
import { Streamdown } from "streamdown";
import {
  ArrowUp,
  Circle,
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

const SESSION_KEY = "nocturne-ledger-owner-chat-v1";
const greeting: ChatEntry = {
  id: "greeting",
  role: "assistant",
  content:
    "I’m ready for a focused conversation. This chat stays in the current browser session and uses the bounded local model behind your gateway.",
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

function ApertureMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`relative grid h-9 w-9 place-items-center rounded-full border border-[#d6aa69]/50 bg-[#c9954b]/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] ${className}`}
      aria-hidden="true"
    >
      <span className="h-3.5 w-3.5 rounded-full border border-[#d6aa69]/80" />
      <span className="absolute bottom-[8px] h-px w-5 bg-[#d6aa69]" />
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

    const userMessage: ChatEntry = {
      id: crypto.randomUUID(),
      role: "user",
      content,
    };
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
      if (!response.ok) {
        throw new Error(compactError(await response.text(), response.status));
      }
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
              message.id === assistantId
                ? { ...message, content: output, pending: true }
                : message
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
            ? {
                ...message,
                content: output || "The model completed without an answer token.",
                pending: false,
              }
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
          item.id === assistantId
            ? { ...item, content: message, pending: false, error: true }
            : item
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
      <main className="nocturne-shell min-h-screen overflow-hidden bg-[#0e0d10] px-4 py-5 text-[#f5f0e8] sm:px-8 sm:py-8">
        <div className="nocturne-halo pointer-events-none fixed inset-0" />
        <div className="relative mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-6xl flex-col justify-between rounded-[28px] border border-white/[0.07] bg-[#141216]/80 p-5 shadow-[0_35px_120px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:p-8">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <ApertureMark />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#d6aa69]">Orbit</p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#8a8482]">Local conversation room</p>
              </div>
            </div>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-[#817b79] sm:block">Owner access only</span>
          </header>

          <section className="mx-auto w-full max-w-xl py-12 sm:py-20">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#c9954b]">A private threshold</p>
            <h1 className="nocturne-display mt-4 text-4xl leading-[0.98] text-[#f6f0e5] sm:text-6xl">A local mind, kept in view.</h1>
            <p className="mt-6 max-w-md text-sm leading-7 text-[#b8b0aa] sm:text-base">Unlock a session-scoped conversation with the model behind your measured gateway. Your owner token is never saved in this browser.</p>
            <form className="mt-8" onSubmit={submitToken}>
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#9e9690]">Owner chat token</span>
                <div className="mt-2 flex items-center rounded-2xl border border-[#c9954b]/25 bg-black/20 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] focus-within:border-[#d6aa69]/70">
                  <KeyRound className="ml-3 h-4 w-4 text-[#b98547]" />
                  <input value={draftToken} onChange={event => setDraftToken(event.target.value)} type="password" autoComplete="off" placeholder="Paste private owner-chat token" className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-[#f5f0e8] outline-none placeholder:text-[#6e6868]" />
                  <button type="submit" className="rounded-xl bg-[#c9954b] px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-[#171116] transition-transform duration-150 hover:bg-[#d6aa69] active:scale-[0.97]">Enter</button>
                </div>
              </label>
            </form>
            {error && <p className="mt-3 rounded-xl border border-red-300/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-100">{error}</p>}
          </section>

          <footer className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.13em] text-[#6f6967]"><ShieldCheck className="h-3.5 w-3.5 text-[#a48762]" /> Token stays in memory · model key stays on server</footer>
        </div>
      </main>
    );
  }

  return (
    <main className="nocturne-shell min-h-screen bg-[#0e0d10] text-[#eee9e2]">
      <div className="nocturne-halo pointer-events-none fixed inset-0" />
      <div className="relative mx-auto grid min-h-screen max-w-[1680px] grid-cols-1 lg:grid-cols-[238px_minmax(0,1fr)_210px]">
        <aside className="border-b border-white/[0.07] bg-[#131116]/85 p-4 backdrop-blur-xl lg:border-b-0 lg:border-r lg:p-5">
          <div className="flex items-center justify-between lg:block">
            <div className="flex items-center gap-3"><ApertureMark /><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#d6aa69]">Orbit</p><p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-[#817b79]">Owner chat</p></div></div>
            <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#9bb79c]"><Circle className="h-2 w-2 fill-current" /> Local ready</span>
          </div>
          <div className="mt-6 hidden lg:block"><p className="font-mono text-[10px] uppercase tracking-[0.17em] text-[#827a75]">Current folio</p><div className="mt-3 rounded-2xl border border-[#c9954b]/20 bg-[#c9954b]/[0.06] p-3"><p className="text-sm font-medium text-[#eee8dd]">Untitled conversation</p><p className="mt-1 font-mono text-[10px] leading-4 text-[#918881]">Session-scoped · {messages.filter(message => message.id !== "greeting").length} entries</p></div></div>
          <button onClick={clearConversation} disabled={isStreaming} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.025] px-3 py-3 text-xs font-semibold text-[#cbc4ba] transition-colors hover:border-[#c9954b]/50 hover:bg-[#c9954b]/[0.08] disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-4 w-4" /> New conversation</button>
          <p className="mt-4 hidden rounded-xl border border-white/[0.06] bg-black/10 p-3 font-mono text-[10px] leading-4 text-[#746e6b] lg:block">History lives only in this browser session. Clear removes it locally.</p>
        </aside>

        <section className="flex min-h-0 flex-col">
          <header className="flex items-center justify-between border-b border-white/[0.07] px-4 py-4 sm:px-7"><div><p className="font-mono text-[10px] uppercase tracking-[0.17em] text-[#a79d93]">Conversation</p><h1 className="mt-1 text-sm font-semibold text-[#f2ede4]">Gemma E2B · bounded local stream</h1></div><button onClick={clearConversation} disabled={isStreaming} className="flex items-center gap-2 rounded-lg px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#948b83] transition-colors hover:bg-white/[0.05] hover:text-[#dcc8aa] disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" /> Clear</button></header>
          <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8 lg:px-12"><div className="mx-auto max-w-3xl space-y-7">
            {messages.map(message => <article key={message.id} className={`chat-entry ${message.role === "user" ? "ml-auto max-w-[88%] sm:max-w-[75%]" : "max-w-full"}`}><div className={`flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] ${message.role === "user" ? "justify-end text-[#b9afa4]" : "text-[#c9954b]"}`}>{message.role === "assistant" ? <><Sparkles className="h-3.5 w-3.5" /> Orbit</> : "You"}</div><div className={`mt-2 rounded-[18px] px-4 py-3.5 leading-7 ${message.role === "user" ? "bg-[#2b2525] text-[#f4eee5] shadow-[0_10px_24px_rgba(0,0,0,0.14)]" : message.error ? "border border-red-300/20 bg-red-400/[0.05] text-red-100" : "border border-white/[0.07] bg-[#171519]/80 text-[#d9d2c8]"}`}>
              {message.role === "assistant" ? <Streamdown>{message.content || ""}</Streamdown> : <p className="whitespace-pre-wrap">{message.content}</p>}
              {message.pending && <span className="nocturne-cursor ml-1 inline-block h-4 w-px bg-[#d6aa69] align-[-2px]" />}
            </div></article>)}
            <div ref={bottomRef} />
          </div></div>
          <div className="border-t border-white/[0.07] bg-[#111014]/92 px-4 py-4 backdrop-blur-xl sm:px-8"><div className="mx-auto max-w-3xl"><div className="rounded-[22px] border border-white/[0.1] bg-[#1b181b] p-2 shadow-[0_16px_45px_rgba(0,0,0,0.25)] focus-within:border-[#c9954b]/55"><textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} placeholder="Write a considered prompt…" rows={2} disabled={isStreaming} className="max-h-40 min-h-[52px] w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-[#f2ede5] outline-none placeholder:text-[#746e6c] disabled:opacity-50" /><div className="flex items-center justify-between px-2 pb-1"><span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#6f6967]">Enter to send · Shift+Enter for a new line</span>{isStreaming ? <button onClick={cancel} className="flex h-9 items-center gap-2 rounded-xl border border-red-300/20 bg-red-300/[0.08] px-3 text-xs font-semibold text-red-100 transition-colors hover:bg-red-300/[0.14]"><CircleStop className="h-4 w-4" /> Stop</button> : <button onClick={() => void send()} disabled={!draft.trim()} className="grid h-9 w-9 place-items-center rounded-xl bg-[#c9954b] text-[#161014] transition-all duration-150 hover:bg-[#d6aa69] disabled:cursor-not-allowed disabled:opacity-35 active:scale-[0.97]" aria-label="Send message"><ArrowUp className="h-4 w-4" /></button>}</div></div>{error && <p className="mt-2 text-xs text-red-200">{error}</p>}</div></div>
        </section>

        <aside className="hidden border-l border-white/[0.07] bg-[#111014]/70 p-5 lg:block"><p className="font-mono text-[10px] uppercase tracking-[0.17em] text-[#827a75]">Living margin</p><div className="mt-5 space-y-5"><div><p className="font-mono text-[9px] uppercase tracking-[0.13em] text-[#817871]">Model</p><p className="mt-1 text-sm text-[#e4ddd3]">gemma-e2b</p></div><div><p className="font-mono text-[9px] uppercase tracking-[0.13em] text-[#817871]">Capacity</p><p className="mt-1 text-sm text-[#e4ddd3]">4 shared streams</p><p className="mt-1 font-mono text-[10px] leading-4 text-[#766f6b]">This owner chat uses one bounded gateway identity.</p></div><div className="border-t border-white/[0.06] pt-5"><p className="font-mono text-[9px] uppercase tracking-[0.13em] text-[#817871]">Session note</p><p className="mt-1 text-xs leading-5 text-[#a79e95]">Conversation text stays in this browser session. It is not stored as a server transcript.</p></div></div></aside>
      </div>
    </main>
  );
}
