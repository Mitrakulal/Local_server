/**
 * Public beta chat workspace: fixed-height conversation shell with local browser
 * history, live three-seat availability, deliberate answer budgets, and a
 * locked API preview. CHAT_GATEWAY_KEY remains server-side.
 */
import {
  ArrowDown,
  CircleDot,
  Check,
  ChevronDown,
  Copy,
  Ellipsis,
  Menu,
  MessageCirclePlus,
  LockKeyhole,
  Paperclip,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
type AnswerMode = "standard" | "long";
type PublicChatStatus = {
  active: number;
  limit: number;
  available: number;
  accepting: boolean;
  standard_max_output: number;
  long_max_output: number;
};

const SESSION_KEY = "mattr-chat-workspace-v2";
const MAX_STORED_CONVERSATIONS = 12;
const STICKY_SCROLL_THRESHOLD = 96;
const INITIAL_PUBLIC_STATUS: PublicChatStatus = {
  active: 0,
  limit: 3,
  available: 3,
  accepting: true,
  standard_max_output: 1024,
  long_max_output: 2048,
};

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
    pending: false,
    error: entry.error === true,
  };
}

function loadSession(): SessionState {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<SessionState>) : undefined;
    const conversations = Array.isArray(parsed?.conversations)
      ? parsed.conversations
          .flatMap(value => {
            if (!value || typeof value !== "object") return [];
            const conversation = value as Record<string, unknown>;
            if (typeof conversation.id !== "string" || !Array.isArray(conversation.messages)) return [];
            const messages = conversation.messages
              .map(normalizeEntry)
              .filter((message): message is ChatEntry => message !== null);
            return [
              {
                id: conversation.id,
                title: typeof conversation.title === "string" ? conversation.title : "New chat",
                messages: messages.length ? messages : [greeting()],
              },
            ];
          })
          .slice(0, MAX_STORED_CONVERSATIONS)
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
  const thinking = typeof message.thinking === "string" ? message.thinking : "";
  if (!thinking) return null;

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
        <p className="whitespace-pre-wrap break-words">{thinking}</p>
      </div>
    </details>
  );
}

export default function OwnerChat() {
  const [session, setSession] = useState<SessionState>(() => loadSession());
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState("");
  const [capacityNotice, setCapacityNotice] = useState("");
  const [publicStatus, setPublicStatus] = useState<PublicChatStatus>(INITIAL_PUBLIC_STATUS);
  const [answerMode, setAnswerMode] = useState<AnswerMode>("standard");
  const [apiPreviewOpen, setApiPreviewOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottomRef = useRef(true);

  const activeConversation = useMemo(
    () => session.conversations.find(conversation => conversation.id === session.activeId) || session.conversations[0]!,
    [session]
  );

  const visibleConversations = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase();
    return query
      ? session.conversations.filter(conversation => conversation.title.toLocaleLowerCase().includes(query))
      : session.conversations;
  }, [historyQuery, session.conversations]);

  const scrollToLatest = (behavior: ScrollBehavior = "smooth") => {
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  };

  useEffect(() => {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    if (stickToBottomRef.current) {
      window.requestAnimationFrame(() => scrollToLatest(isStreaming ? "auto" : "smooth"));
    }
  }, [activeConversation.messages, isStreaming, session.activeId]);

  useEffect(() => {
    if (!draft && composerRef.current) composerRef.current.style.height = "auto";
  }, [draft]);

  useEffect(() => {
    let active = true;
    const refreshStatus = async () => {
      try {
        const response = await fetch("/chat/api/status", { cache: "no-store" });
        if (!response.ok) return;
        const next = (await response.json()) as PublicChatStatus;
        if (active) setPublicStatus(next);
      } catch {
        // Keep the last known availability label during a transient network interruption.
      }
    };
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 4_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const updateActive = (apply: (conversation: Conversation) => Conversation) => {
    setSession(current => ({
      ...current,
      conversations: current.conversations.map(conversation =>
        conversation.id === current.activeId ? apply(conversation) : conversation
      ),
    }));
  };

  const createConversation = () => {
    if (isStreaming) return;
    const conversation = freshConversation();
    stickToBottomRef.current = true;
    setSession(current => ({
      activeId: conversation.id,
      conversations: [conversation, ...current.conversations].slice(0, MAX_STORED_CONVERSATIONS),
    }));
    setError("");
    setDraft("");
  };

  const selectConversation = (conversationId: string) => {
    if (isStreaming) return;
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    setSession(current => ({ ...current, activeId: conversationId }));
  };

  const clearConversation = () => {
    if (isStreaming) return;
    stickToBottomRef.current = true;
    updateActive(conversation => ({ ...conversation, title: "New chat", messages: [greeting()] }));
    setError("");
    setDraft("");
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

  const onMessageScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    const atBottom = distanceFromBottom < STICKY_SCROLL_THRESHOLD;
    stickToBottomRef.current = atBottom;
    setShowJumpToLatest(!atBottom && activeConversation.messages.length > 2);
  };

  const onDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    setDraft(textarea.value);
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || isStreaming) return;

    const userMessage: ChatEntry = { id: crypto.randomUUID(), role: "user", content };
    const assistantId = crypto.randomUUID();
    const assistantMessage: ChatEntry = { id: assistantId, role: "assistant", content: "", thinking: "", pending: true };
    const requestMessages = [...activeConversation.messages.slice(1), userMessage].map(({ role, content: messageContent }) => ({ role, content: messageContent }));

    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    setDraft("");
    setError("");
    setCapacityNotice("");
    updateActive(conversation => ({
      ...conversation,
      title: conversation.title === "New chat" ? titleFromPrompt(content) : conversation.title,
      messages: [...conversation.messages, userMessage, assistantMessage],
    }));
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/chat/api/completions", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: requestMessages, answer_mode: answerMode }),
      });
      if (!response.ok) {
        const message = compactError(await response.text(), response.status);
        if (response.status === 429) setCapacityNotice(message);
        throw new Error(message);
      }
      if (!response.body) throw new Error("The model returned no stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let output = "";
      let nativeThinking = "";

      const updateStream = () => {
        const split = separateReasoning(output);
        updateActive(conversation => ({
          ...conversation,
          messages: conversation.messages.map(message =>
            message.id === assistantId
              ? { ...message, content: split.answer, thinking: nativeThinking || split.thinking, pending: true }
              : message
          ),
        }));
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
      updateActive(conversation => ({
        ...conversation,
        messages: conversation.messages.map(message =>
          message.id === assistantId
            ? {
                ...message,
                content: split.answer || (nativeThinking ? "The model completed without a separate final answer." : output || "The model completed without an answer token."),
                thinking: nativeThinking || split.thinking,
                pending: false,
              }
            : message
        ),
      }));
    } catch (reason) {
      const message = controller.signal.aborted
        ? "Response stopped. This session remains available."
        : reason instanceof Error
          ? reason.message
          : "The local model connection failed.";
      updateActive(conversation => ({
        ...conversation,
        messages: conversation.messages.map(item =>
          item.id === assistantId ? { ...item, content: message, pending: false, error: true } : item
        ),
      }));
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      void fetch("/chat/api/status", { cache: "no-store" })
        .then(response => (response.ok ? response.json() : null))
        .then(next => next && setPublicStatus(next as PublicChatStatus))
        .catch(() => undefined);
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const capacityTone = publicStatus.accepting
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
  const capacityLabel = `${publicStatus.active} / ${publicStatus.limit} active`;
  const selectedOutput = answerMode === "long"
    ? publicStatus.long_max_output
    : publicStatus.standard_max_output;

  return (
    <main className="reference-chat-shell h-[100dvh] overflow-hidden bg-[#e9ebf1] p-0 text-[#202124] sm:p-5">
      <div className="mx-auto grid h-full min-h-0 max-w-[1440px] grid-cols-1 overflow-hidden bg-[#fafbfc] sm:h-[calc(100dvh-2.5rem)] sm:rounded-[24px] sm:border sm:border-white/90 sm:shadow-[0_22px_65px_rgba(49,54,72,0.16)] md:grid-cols-[236px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 flex-col overflow-hidden border-r border-[#e1e3ea] bg-[#f3f4f9] p-4 md:flex">
          <div className="flex shrink-0 items-center justify-between px-1">
            <div className="flex items-center gap-2.5"><BrandMark /><span className="text-sm font-semibold tracking-[-0.02em]">Mattr Chat</span></div>
            <button className="rounded-lg p-1.5 text-[#7a7d88] transition-colors hover:bg-white active:scale-[0.97]" aria-label="Collapse navigation"><Menu className="h-4 w-4" /></button>
          </div>

          <button onClick={createConversation} disabled={isStreaming} className="mt-7 flex shrink-0 items-center gap-2 rounded-[11px] px-2.5 py-2.5 text-left text-[13px] font-medium text-[#31343d] transition-colors hover:bg-white disabled:opacity-45"><MessageCirclePlus className="h-4 w-4" /> New chat</button>
          <button onClick={() => { setHistorySearchOpen(open => !open); setHistoryQuery(""); }} className="mt-1 flex shrink-0 items-center gap-2 rounded-[11px] px-2.5 py-2.5 text-left text-[13px] text-[#686b75] transition-colors hover:bg-white"><Search className="h-4 w-4" /> Search</button>

          {historySearchOpen && (
            <div className="mt-2 flex shrink-0 items-center gap-2 rounded-[11px] border border-[#dce0ec] bg-white px-2.5 py-2 shadow-[0_4px_12px_rgba(43,49,72,0.05)]">
              <Search className="h-3.5 w-3.5 shrink-0 text-[#9095a3]" />
              <input autoFocus value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} placeholder="Find a chat" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[#a2a6b2]" />
              <button onClick={() => { setHistorySearchOpen(false); setHistoryQuery(""); }} className="rounded p-0.5 text-[#969aa5] hover:bg-[#f1f2f6]" aria-label="Close search"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          <div className="mt-6 flex min-h-0 flex-1 flex-col border-t border-[#e0e2e9] pt-5">
            <div className="flex items-center justify-between px-2.5"><p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-[#9295a0]">This session</p><span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#9ca0aa]">{session.conversations.length}</span></div>
            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {visibleConversations.map(conversation => (
                <button key={conversation.id} onClick={() => selectConversation(conversation.id)} className={`w-full truncate rounded-[10px] px-2.5 py-2.5 text-left text-[12px] transition-colors ${conversation.id === activeConversation.id ? "bg-[#e4e7fb] font-medium text-[#373d62]" : "text-[#666a75] hover:bg-white"}`}>{conversation.title}</button>
              ))}
              {!visibleConversations.length && <p className="px-2.5 py-3 text-[11px] text-[#9a9ea9]">No matching chats.</p>}
            </div>
          </div>

          <div className="mt-4 shrink-0 border-t border-[#e0e2e9] pt-4"><p className="px-2.5 text-[11px] leading-5 text-[#858894]">Recent chats stay in this browser session.</p><div className="mt-4 flex items-center gap-2 px-2.5 text-[11px] text-[#747783]"><CircleDot className="h-3.5 w-3.5 text-emerald-500" /> Public beta · 3 shared seats</div></div>
        </aside>

        <section className="relative flex min-h-0 flex-col overflow-hidden bg-[#fbfcfd]">
          <header className="flex h-[62px] shrink-0 items-center justify-between border-b border-[#e6e8ee] px-4 sm:px-7">
            <div className="flex items-center gap-2.5"><button className="rounded-lg p-1.5 text-[#747783] md:hidden" aria-label="Open conversations"><Menu className="h-4 w-4" /></button><button className="flex items-center gap-2 rounded-[8px] bg-[#f0f2f7] px-2.5 py-1.5 text-[12px] font-medium text-[#363943]"><span>Gemma E2B</span><ChevronDown className="h-3.5 w-3.5 text-[#7b7e88]" /></button></div>
            <div className="flex items-center gap-1.5"><span className={`hidden rounded-full border px-2.5 py-1 text-[10px] font-medium sm:inline-flex ${capacityTone}`}><span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${publicStatus.accepting ? "bg-emerald-500" : "bg-amber-500"}`} />Live capacity · {capacityLabel}</span><button onClick={() => setApiPreviewOpen(open => !open)} className="flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] text-[#6f727c] transition-colors hover:bg-[#f1f2f5]"><LockKeyhole className="h-3.5 w-3.5" /> API</button><button onClick={clearConversation} disabled={isStreaming} className="rounded-[8px] px-2.5 py-1.5 text-[12px] text-[#6f727c] transition-colors hover:bg-[#f1f2f5] disabled:opacity-40">Clear</button><button className="rounded-[8px] p-1.5 text-[#6f727c] transition-colors hover:bg-[#f1f2f5]" aria-label="More options"><Ellipsis className="h-4 w-4" /></button></div>
          </header>

          {capacityNotice && <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-[11px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800 sm:mx-7"><span><span className="font-semibold">Live chat is busy.</span> {capacityNotice}</span><button onClick={() => setCapacityNotice("")} className="rounded p-1 text-amber-700 hover:bg-amber-100" aria-label="Dismiss capacity message"><X className="h-3.5 w-3.5" /></button></div>}

          {apiPreviewOpen && <div className="absolute right-4 top-[70px] z-20 w-[min(330px,calc(100%-2rem))] rounded-[16px] border border-[#dce0eb] bg-white p-4 shadow-[0_16px_35px_rgba(40,46,67,0.16)] sm:right-7"><div className="flex items-start justify-between gap-3"><div><p className="text-[12px] font-semibold text-[#333741]">Developer API</p><p className="mt-1 text-[11px] leading-5 text-[#747987]">Issued-key API access is invitation-only while the public developer experience is being prepared.</p></div><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[#7c8ee6]" /></div><div className="mt-3 rounded-[10px] border border-[#e5e7ee] bg-[#f7f8fb] px-3 py-2 text-[10px] text-[#777b86]">API access · coming soon</div><p className="mt-3 text-[10px] leading-4 text-[#969aa5]">Existing issued keys continue to work privately at the API endpoint.</p></div>}

          <div ref={messageScrollRef} onScroll={onMessageScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8 md:px-14">
            <div className="mx-auto max-w-[700px] space-y-7 pb-8">
              {activeConversation.messages.map(message => (
                <article key={message.id} className={message.role === "user" ? "ml-auto max-w-[88%] sm:max-w-[75%]" : "max-w-full"}>
                  <ThinkingPanel message={message} />
                  <div className={`reference-message ${message.role === "user" ? "rounded-[11px] bg-[#e3e7fb] px-3.5 py-2.5 text-[14px] leading-6 text-[#303752]" : message.error ? "text-[#b23b35]" : "text-[15px] leading-7 text-[#2f3138]"}`}>
                    {message.role === "assistant" ? <p className="whitespace-pre-wrap break-words">{message.content || (message.pending ? "" : "No final answer was returned.")}</p> : <p className="whitespace-pre-wrap">{message.content}</p>}
                    {message.pending && <span className="reference-stream-cursor ml-1 inline-block h-4 w-[2px] bg-[#7c8ee6] align-[-2px]" />}
                  </div>
                  {message.role === "assistant" && !message.pending && !message.error && <div className="mt-2 flex items-center gap-1 text-[#8a8d96]"><button onClick={() => void copyMessage(message)} className="rounded-md p-1.5 transition-colors hover:bg-[#f0f1f5]" aria-label="Copy response">{copiedId === message.id ? <Check className="h-3.5 w-3.5 text-[#5a7a62]" /> : <Copy className="h-3.5 w-3.5" />}</button><button className="rounded-md p-1.5 transition-colors hover:bg-[#f0f1f5]" aria-label="Helpful"><ThumbsUp className="h-3.5 w-3.5" /></button><button className="rounded-md p-1.5 transition-colors hover:bg-[#f0f1f5]" aria-label="Not helpful"><ThumbsDown className="h-3.5 w-3.5" /></button></div>}
                </article>
              ))}
              <div ref={bottomRef} />
            </div>
          </div>

          {showJumpToLatest && <button onClick={() => scrollToLatest()} className="absolute bottom-[108px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[#d9dde8] bg-white/95 px-3 py-2 text-[11px] font-medium text-[#596074] shadow-[0_8px_20px_rgba(37,43,64,0.12)] backdrop-blur transition-transform hover:-translate-y-0.5 active:scale-[0.97]"><ArrowDown className="h-3.5 w-3.5" /> Jump to latest</button>}

          <div className="shrink-0 border-t border-[#e6e8ee] bg-[#fbfcfd] px-4 pb-4 pt-3 sm:px-8 sm:pb-5">
            <div className="mx-auto max-w-[700px]">
              <div className="rounded-[18px] border border-[#dfe1e8] bg-white px-3 py-2 shadow-[0_7px_20px_rgba(39,43,57,0.08)] transition-shadow focus-within:border-[#aab5eb] focus-within:ring-4 focus-within:ring-[#7c8ee6]/10">
                <textarea ref={composerRef} value={draft} onChange={onDraftChange} onKeyDown={onComposerKeyDown} placeholder="Ask anything" rows={1} disabled={isStreaming} className="max-h-40 min-h-[48px] w-full resize-none overflow-y-auto bg-transparent px-1 py-2 text-[15px] leading-6 outline-none placeholder:text-[#a4a7b0] disabled:opacity-50" />
                <div className="flex items-center justify-between gap-3 pt-1"><div className="flex items-center gap-1"><button className="grid h-8 w-8 place-items-center rounded-[8px] text-[#747783] transition-colors hover:bg-[#f1f2f5]" aria-label="Add"><Plus className="h-4 w-4" /></button><div className="ml-1 flex items-center rounded-[9px] bg-[#f1f2f6] p-0.5 text-[10px] font-medium"><button onClick={() => setAnswerMode("standard")} disabled={isStreaming} className={`rounded-[7px] px-2 py-1.5 transition-colors ${answerMode === "standard" ? "bg-white text-[#41455c] shadow-[0_1px_3px_rgba(42,47,67,0.13)]" : "text-[#858995] hover:text-[#555a66]"}`}>Standard · 1K</button><button onClick={() => setAnswerMode("long")} disabled={isStreaming} className={`rounded-[7px] px-2 py-1.5 transition-colors ${answerMode === "long" ? "bg-white text-[#41455c] shadow-[0_1px_3px_rgba(42,47,67,0.13)]" : "text-[#858995] hover:text-[#555a66]"}`}>Long · 2K</button></div></div>{isStreaming ? <button onClick={cancel} className="rounded-[10px] bg-[#f4eeee] px-3 py-2 text-[12px] font-semibold text-[#a9443c]">Stop</button> : <button onClick={() => void send()} disabled={!draft.trim()} className="grid h-8 w-8 place-items-center rounded-full bg-[#7c8ee6] text-white shadow-[0_4px_10px_rgba(91,109,202,0.32)] transition-all hover:bg-[#6f81dd] disabled:cursor-not-allowed disabled:opacity-35 active:scale-[0.97]" aria-label="Send message"><Send className="h-3.5 w-3.5" /></button>}</div>
              </div>
              {error && <p className="mt-2 text-xs text-[#b23b35]">{error}</p>}
              <p className="mt-2 text-center text-[10px] text-[#9a9da6]">{selectedOutput.toLocaleString()} token {answerMode === "long" ? "long-answer" : "standard"} limit · Enter to send · Shift + Enter for a new line.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
