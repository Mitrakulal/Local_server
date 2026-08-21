/**
 * Reference-grounded chat workspace: persistent browser-session history rail,
 * focused reading column, anchored composer, and a separate Thinking disclosure.
 * CHAT_GATEWAY_KEY remains server-side.
 */
import { Streamdown } from "streamdown";
import {
  Check,
  ChevronDown,
  Copy,
  Ellipsis,
  Menu,
  MessageCirclePlus,
  Paperclip,
  Plus,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

type Role = "user" | "assistant";
type ChatEntry = {
  id: string;
  role: Role;
  content: string;
  thinking?: string;
  pending?: boolean;
  error?: boolean;
};
type Conversation = { id: string; title: string; messages: ChatEntry[] };
type SessionState = { activeId: string; conversations: Conversation[] };

const SESSION_KEY = "mattr-chat-workspace-v2";
const greeting = (): ChatEntry => ({
  id: crypto.randomUUID(),
  role: "assistant",
  content: "I’m here. What would you like to think through?",
});
const freshConversation = (): Conversation => ({
  id: crypto.randomUUID(),
  title: "New chat",
  messages: [greeting()],
});

function normalizeEntry(value: unknown): ChatEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.id !== "string" ||
    (entry.role !== "user" && entry.role !== "assistant") ||
    typeof entry.content !== "string"
  ) {
    return null;
  }

  return {
    id: entry.id,
    role: entry.role,
    content: entry.content,
    thinking: typeof entry.thinking === "string" ? entry.thinking : undefined,
    // A browser refresh cannot safely resume a stream from an older bundle.
    pending: false,
    error: entry.error === true,
  };
}

function loadSession(): SessionState {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<SessionState>) : undefined;
    const conversations = Array.isArray(parsed?.conversations)
      ? parsed.conversations.flatMap(value => {
          if (!value || typeof value !== "object") return [];
          const conversation = value as Record<string, unknown>;
          if (typeof conversation.id !== "string" || !Array.isArray(conversation.messages)) return [];
          const messages = conversation.messages
            .map(normalizeEntry)
            .filter((message): message is ChatEntry => message !== null);
          return [{
            id: conversation.id,
            title: typeof conversation.title === "string" ? conversation.title : "New chat",
            messages: messages.length ? messages : [greeting()],
          }];
        })
      : [];
    if (conversations.length) {
      const activeId = conversations.some(conversation => conversation.id === parsed?.activeId)
        ? parsed!.activeId!
        : conversations[0]!.id;
      return { activeId, conversations };
    }
  } catch {
    // A malformed local session is safely replaced with one empty chat.
  }
  const conversation = freshConversation();
  return { activeId: conversation.id, conversations: [conversation] };
}

function compactError(raw: string, status: number) {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; code?: string } };
    return parsed.error?.message || parsed.error?.code || `Request failed (${status}).`;
  } catch {
    return raw.trim().slice(0, 220) || `Request failed (${status}).`;
  }
}

function titleFromPrompt(content: string) {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > 34 ? `${clean.slice(0, 34).trimEnd()}…` : clean || "New chat";
}

/**
 * Gemma sometimes presents a narrated working trace followed by a final-output
 * heading in its normal content stream. Keep the two presentation layers apart.
 */
function separateReasoning(raw: string) {
  const marker = /(?:^|\n)\s*(?:\*\*)?\s*(?:final\s+(?:output|answer)(?:\s+generation)?|final\s+response)\s*(?:\*\*)?\s*:?\s*/i;
  const match = marker.exec(raw);
  if (match?.index && match.index > 0) {
    return {
      thinking: raw.slice(0, match.index).trim(),
      answer: raw.slice(match.index + match[0].length).trim(),
    };
  }
  return { thinking: "", answer: raw };
}

function BrandMark() {
  return (
    <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-[#1f2228] text-[11px] font-semibold text-white">
      M
    </span>
  );
}

function ThinkingPanel({ message }: { message: ChatEntry }) {
  if (!message.thinking) return null;
  return (
    <details
      className="reference-thinking mb-3 rounded-[11px] border border-[#e1e4ea] bg-[#f5f6f8] text-[#626773]"
      open={message.pending}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12px] font-medium [&::-webkit-details-marker]:hidden">
        <ChevronDown className="reference-thinking-chevron h-3.5 w-3.5" />
        <span>{message.pending ? "Thinking…" : "Thinking"}</span>
        {!message.pending && <span className="text-[#9ba0aa]">Show summary</span>}
      </summary>
      <div className="border-t border-[#e1e4ea] px-3 py-2.5 text-[12px] leading-5 text-[#747983]">
        <Streamdown>{message.thinking}</Streamdown>
      </div>
    </details>
  );
}

function LoginScreen({ error, onLogin }: { error: string; onLogin: (token: string) => void }) {
  const [token, setToken] = useState("");

  return (
    <main className="reference-chat-shell min-h-screen bg-[#e9ebf1] p-3 text-[#202124] sm:p-7">
      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1280px] overflow-hidden rounded-[25px] border border-white/80 bg-[#f8f9fb] shadow-[0_22px_65px_rgba(49,54,72,0.16)] sm:min-h-[calc(100vh-3.5rem)]">
        <aside className="hidden w-[236px] flex-col border-r border-[#e2e4eb] bg-[#f3f4f9] p-5 md:flex">
          <div className="flex items-center gap-2.5"><BrandMark /><span className="text-sm font-semibold tracking-[-0.02em]">Mattr Chat</span></div>
          <div className="mt-9 rounded-[14px] bg-white/70 px-3 py-3 text-xs text-[#686b75]">Private local workspace</div>
          <div className="mt-auto flex items-center gap-2 text-[11px] text-[#747783]"><ShieldCheck className="h-3.5 w-3.5 text-[#6979c4]" /> Owner access only</div>
        </aside>
        <section className="flex flex-1 flex-col p-5 sm:p-9 md:pl-14">
          <header className="flex items-center justify-between"><div className="flex items-center gap-2 md:hidden"><BrandMark /><span className="text-sm font-semibold">Mattr Chat</span></div><span className="ml-auto rounded-full border border-[#dde0eb] bg-white px-3 py-1.5 text-[11px] font-medium text-[#666b7b]">Private session</span></header>
          <form onSubmit={event => { event.preventDefault(); onLogin(token); }} className="mx-auto flex w-full max-w-[580px] flex-1 flex-col justify-center py-12">
            <p className="text-[12px] font-semibold text-[#7786cb]">OWNER CHAT</p>
            <h1 className="mt-3 text-[34px] font-semibold tracking-[-0.045em] text-[#22242a] sm:text-[42px]">Continue your conversation.</h1>
            <p className="mt-4 max-w-md text-[15px] leading-6 text-[#737681]">This lightweight workspace keeps your conversation in this browser session. The model key stays on the Mac mini.</p>
            <label className="mt-9 block"><span className="text-[12px] font-medium text-[#565964]">Owner chat token</span><div className="mt-2 flex items-center rounded-[16px] border border-[#dadde8] bg-white p-1.5 shadow-[0_5px_16px_rgba(37,41,56,0.06)] focus-within:border-[#92a0e7] focus-within:ring-4 focus-within:ring-[#7c8ee6]/10"><input value={token} onChange={event => setToken(event.target.value)} type="password" autoComplete="off" placeholder="Paste private token" className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm outline-none placeholder:text-[#a4a7b0]" /><button type="submit" className="rounded-[12px] bg-[#252831] px-4 py-3 text-xs font-semibold text-white transition-transform active:scale-[0.97]">Continue</button></div></label>
            {error && <p className="mt-3 rounded-[12px] border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-[#ae3029]">{error}</p>}
          </form>
        </section>
      </div>
    </main>
  );
}

export default function OwnerChat() {
  const [ownerToken, setOwnerToken] = useState("");
  const [session, setSession] = useState<SessionState>(() => loadSession());
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const activeConversation = useMemo(
    () => session.conversations.find(conversation => conversation.id === session.activeId) || session.conversations[0]!,
    [session]
  );

  useEffect(() => window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)), [session]);
  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [activeConversation.messages, isStreaming]);

  const updateActive = (apply: (conversation: Conversation) => Conversation) => {
    setSession(current => ({ ...current, conversations: current.conversations.map(conversation => conversation.id === current.activeId ? apply(conversation) : conversation) }));
  };
  const createConversation = () => {
    if (isStreaming) return;
    const conversation = freshConversation();
    setSession(current => ({ activeId: conversation.id, conversations: [conversation, ...current.conversations] }));
    setError("");
    setDraft("");
  };
  const clearConversation = () => {
    if (isStreaming) return;
    updateActive(conversation => ({ ...conversation, title: "New chat", messages: [greeting()] }));
    setError("");
    setDraft("");
  };
  const handleLogin = (token: string) => {
    const value = token.trim();
    if (value.length < 32) {
      setError("Enter the full private owner-chat token from the Mac mini environment file.");
      return;
    }
    setOwnerToken(value);
    setError("");
  };
  const cancel = () => abortRef.current?.abort();
  const copyMessage = async (message: ChatEntry) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(null), 1200);
    } catch {
      setError("Copy was unavailable in this browser.");
    }
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || isStreaming || !ownerToken) return;
    const userMessage: ChatEntry = { id: crypto.randomUUID(), role: "user", content };
    const assistantId = crypto.randomUUID();
    const assistantMessage: ChatEntry = { id: assistantId, role: "assistant", content: "", thinking: "", pending: true };
    const requestMessages = [...activeConversation.messages.slice(1), userMessage].map(({ role, content: messageContent }) => ({ role, content: messageContent }));

    setDraft("");
    setError("");
    updateActive(conversation => ({ ...conversation, title: conversation.title === "New chat" ? titleFromPrompt(content) : conversation.title, messages: [...conversation.messages, userMessage, assistantMessage] }));
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/chat/api/completions", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", "x-owner-chat-token": ownerToken }, body: JSON.stringify({ messages: requestMessages, max_tokens: 512 }) });
      if (!response.ok) throw new Error(compactError(await response.text(), response.status));
      if (!response.body) throw new Error("The model returned no stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let output = "";
      let nativeThinking = "";
      const updateStream = () => {
        const split = separateReasoning(output);
        updateActive(conversation => ({ ...conversation, messages: conversation.messages.map(message => message.id === assistantId ? { ...message, content: split.answer, thinking: nativeThinking || split.thinking, pending: true } : message) }));
      };
      const applyLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") return;
        try {
          const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null } }> };
          const delta = chunk.choices?.[0]?.delta;
          const answerToken = typeof delta?.content === "string" ? delta.content : "";
          const reasoningToken = typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "";
          if (!answerToken && !reasoningToken) return;
          output += answerToken;
          nativeThinking += reasoningToken;
          updateStream();
        } catch {
          // Preserve a valid stream if one upstream SSE event is malformed.
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
      const split = separateReasoning(output);
      updateActive(conversation => ({ ...conversation, messages: conversation.messages.map(message => message.id === assistantId ? { ...message, content: split.answer || (nativeThinking ? "The model completed without a separate final answer." : output || "The model completed without an answer token."), thinking: nativeThinking || split.thinking, pending: false } : message) }));
    } catch (reason) {
      const message = controller.signal.aborted ? "Response stopped. This session remains available." : reason instanceof Error ? reason.message : "The local model connection failed.";
      updateActive(conversation => ({ ...conversation, messages: conversation.messages.map(item => item.id === assistantId ? { ...item, content: message, pending: false, error: true } : item) }));
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

  if (!ownerToken) return <LoginScreen error={error} onLogin={handleLogin} />;

  return (
    <main className="reference-chat-shell min-h-screen bg-[#e9ebf1] p-0 text-[#202124] sm:p-5">
      <div className="mx-auto grid min-h-screen max-w-[1440px] grid-cols-1 overflow-hidden bg-[#fafbfc] sm:min-h-[calc(100vh-2.5rem)] sm:rounded-[24px] sm:border sm:border-white/90 sm:shadow-[0_22px_65px_rgba(49,54,72,0.16)] md:grid-cols-[236px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 flex-col border-r border-[#e1e3ea] bg-[#f3f4f9] p-4 md:flex">
          <div className="flex items-center justify-between px-1"><div className="flex items-center gap-2.5"><BrandMark /><span className="text-sm font-semibold tracking-[-0.02em]">Mattr Chat</span></div><button className="rounded-lg p-1.5 text-[#7a7d88] transition-colors hover:bg-white" aria-label="Collapse navigation"><Menu className="h-4 w-4" /></button></div>
          <button onClick={createConversation} disabled={isStreaming} className="mt-7 flex items-center gap-2 rounded-[11px] px-2.5 py-2.5 text-left text-[13px] font-medium text-[#31343d] transition-colors hover:bg-white disabled:opacity-45"><MessageCirclePlus className="h-4 w-4" /> New chat</button>
          <button className="mt-1 flex items-center gap-2 rounded-[11px] px-2.5 py-2.5 text-left text-[13px] text-[#686b75] transition-colors hover:bg-white"><Search className="h-4 w-4" /> Search</button>
          <div className="mt-6 border-t border-[#e0e2e9] pt-5"><p className="px-2.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-[#9295a0]">This session</p><div className="mt-2 space-y-1">{session.conversations.map(conversation => <button key={conversation.id} onClick={() => !isStreaming && setSession(current => ({ ...current, activeId: conversation.id }))} className={`w-full truncate rounded-[10px] px-2.5 py-2.5 text-left text-[12px] transition-colors ${conversation.id === activeConversation.id ? "bg-[#e4e7fb] font-medium text-[#373d62]" : "text-[#666a75] hover:bg-white"}`}>{conversation.title}</button>)}</div></div>
          <div className="mt-auto border-t border-[#e0e2e9] pt-4"><p className="px-2.5 text-[11px] leading-5 text-[#858894]">History remains in this browser session only.</p><div className="mt-4 flex items-center gap-2 px-2.5 text-[11px] text-[#747783]"><ShieldCheck className="h-3.5 w-3.5 text-[#6e7ec8]" /> Private owner access</div></div>
        </aside>
        <section className="flex min-h-0 flex-col bg-[#fbfcfd]">
          <header className="flex h-[62px] items-center justify-between border-b border-[#e6e8ee] px-4 sm:px-7"><div className="flex items-center gap-2.5"><button className="rounded-lg p-1.5 text-[#747783] md:hidden" aria-label="Open conversations"><Menu className="h-4 w-4" /></button><button className="flex items-center gap-2 rounded-[8px] bg-[#f0f2f7] px-2.5 py-1.5 text-[12px] font-medium text-[#363943]"><span>Gemma E2B</span><ChevronDown className="h-3.5 w-3.5 text-[#7b7e88]" /></button></div><div className="flex items-center gap-1"><button onClick={clearConversation} disabled={isStreaming} className="rounded-[8px] px-2.5 py-1.5 text-[12px] text-[#6f727c] transition-colors hover:bg-[#f1f2f5] disabled:opacity-40">Clear</button><button className="rounded-[8px] p-1.5 text-[#6f727c] transition-colors hover:bg-[#f1f2f5]" aria-label="More options"><Ellipsis className="h-4 w-4" /></button></div></header>
          <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8 md:px-14"><div className="mx-auto max-w-[680px] space-y-7 pb-8">{activeConversation.messages.map(message => <article key={message.id} className={message.role === "user" ? "ml-auto max-w-[88%] sm:max-w-[75%]" : "max-w-full"}><ThinkingPanel message={message} /><div className={`reference-message ${message.role === "user" ? "rounded-[11px] bg-[#e3e7fb] px-3.5 py-2.5 text-[14px] leading-6 text-[#303752]" : message.error ? "text-[#b23b35]" : "text-[15px] leading-7 text-[#2f3138]"}`}>{message.role === "assistant" ? <Streamdown>{message.content || (message.pending ? "" : "No final answer was returned.")}</Streamdown> : <p className="whitespace-pre-wrap">{message.content}</p>}{message.pending && <span className="reference-stream-cursor ml-1 inline-block h-4 w-[2px] bg-[#7c8ee6] align-[-2px]" />}</div>{message.role === "assistant" && !message.pending && !message.error && <div className="mt-2 flex items-center gap-1 text-[#8a8d96]"><button onClick={() => void copyMessage(message)} className="rounded-md p-1.5 transition-colors hover:bg-[#f0f1f5]" aria-label="Copy response">{copiedId === message.id ? <Check className="h-3.5 w-3.5 text-[#5a7a62]" /> : <Copy className="h-3.5 w-3.5" />}</button><button className="rounded-md p-1.5 transition-colors hover:bg-[#f0f1f5]" aria-label="Helpful"><ThumbsUp className="h-3.5 w-3.5" /></button><button className="rounded-md p-1.5 transition-colors hover:bg-[#f0f1f5]" aria-label="Not helpful"><ThumbsDown className="h-3.5 w-3.5" /></button></div>}</article>)}<div ref={bottomRef} /></div></div>
          <div className="border-t border-[#e6e8ee] bg-[#fbfcfd] px-4 pb-4 pt-3 sm:px-8 sm:pb-5"><div className="mx-auto max-w-[700px]"><div className="rounded-[18px] border border-[#dfe1e8] bg-white px-3 py-2 shadow-[0_7px_20px_rgba(39,43,57,0.08)] transition-shadow focus-within:border-[#aab5eb] focus-within:ring-4 focus-within:ring-[#7c8ee6]/10"><textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} placeholder="Ask anything" rows={2} disabled={isStreaming} className="min-h-[48px] max-h-40 w-full resize-none bg-transparent px-1 py-2 text-[15px] leading-6 outline-none placeholder:text-[#a4a7b0] disabled:opacity-50" /><div className="flex items-center justify-between gap-3 pt-1"><div className="flex items-center gap-1"><button className="grid h-8 w-8 place-items-center rounded-[8px] text-[#747783] transition-colors hover:bg-[#f1f2f5]" aria-label="Add"><Plus className="h-4 w-4" /></button><button className="flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[12px] font-medium text-[#50535d] transition-colors hover:bg-[#f1f2f5]"><SlidersHorizontal className="h-3.5 w-3.5" /> Tools</button><button className="hidden h-8 items-center gap-1.5 rounded-[8px] px-2 text-[12px] text-[#676a74] sm:flex"><Paperclip className="h-3.5 w-3.5" /> Attach</button></div>{isStreaming ? <button onClick={cancel} className="rounded-[10px] bg-[#f4eeee] px-3 py-2 text-[12px] font-semibold text-[#a9443c]">Stop</button> : <button onClick={() => void send()} disabled={!draft.trim()} className="grid h-8 w-8 place-items-center rounded-full bg-[#7c8ee6] text-white shadow-[0_4px_10px_rgba(91,109,202,0.32)] transition-all hover:bg-[#6f81dd] disabled:cursor-not-allowed disabled:opacity-35 active:scale-[0.97]" aria-label="Send message"><Send className="h-3.5 w-3.5" /></button>}</div></div>{error && <p className="mt-2 text-xs text-[#b23b35]">{error}</p>}<p className="mt-2 text-center text-[10px] text-[#9a9da6]">Local AI can make mistakes. Check important responses.</p></div></div>
        </section>
      </div>
    </main>
  );
}
