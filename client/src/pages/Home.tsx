/**
 * Instrument Panel style: an asymmetric load laboratory with a fixed setup rail,
 * a central live capacity field, and a stream-evidence strip for each virtual user.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity,
  ArrowUpRight,
  Check,
  CircleStop,
  Clock3,
  Copy,
  Gauge,
  KeyRound,
  Play,
  RadioTower,
  RotateCcw,
  Settings2,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  TimerReset,
  UsersRound,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

type UserStatus = "queued" | "waiting" | "streaming" | "completed" | "error" | "cancelled";

type VirtualUser = {
  id: number;
  status: UserStatus;
  output: string;
  error?: string;
  startedAt?: number;
  responseStartMs?: number;
  firstTokenMs?: number;
  elapsedMs?: number;
  promptTokens?: number;
  completionTokens?: number;
};

type EventItem = {
  id: number;
  timestamp: string;
  tone: "neutral" | "good" | "warn" | "bad";
  message: string;
};

type TestConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
  virtualUsers: number;
  rampMs: number;
  maxTokens: number;
  timeoutMs: number;
  systemPrompt: string;
  prompt: string;
  uniqueSuffix: boolean;
};

const initialConfig: TestConfig = {
  endpoint: "http://127.0.0.1:8080/v1",
  apiKey: "",
  model: "your-local-model",
  virtualUsers: 2,
  rampMs: 500,
  maxTokens: 128,
  timeoutMs: 90_000,
  systemPrompt: "You are a concise local assistant. Be accurate and direct.",
  prompt: "Explain, in three practical points, why concurrent LLM requests need bounded queueing.",
  uniqueSuffix: true,
};

const statusStyle: Record<UserStatus, string> = {
  queued: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  waiting: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  streaming: "border-teal-300/30 bg-teal-300/10 text-teal-100",
  completed: "border-teal-300/25 bg-teal-300/10 text-teal-100",
  error: "border-red-400/30 bg-red-400/10 text-red-200",
  cancelled: "border-stone-400/25 bg-stone-400/10 text-stone-300",
};

const statusDot: Record<UserStatus, string> = {
  queued: "bg-amber-300",
  waiting: "bg-amber-300 animate-pulse",
  streaming: "bg-teal-300 animate-pulse",
  completed: "bg-teal-300",
  error: "bg-red-400",
  cancelled: "bg-stone-400",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function formatMs(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(2)} s`;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function completionUrl(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function metricTone(value: number, baseline: number) {
  if (!baseline) return "bg-stone-500";
  if (value <= baseline * 1.2) return "bg-teal-300";
  if (value <= baseline * 1.7) return "bg-amber-300";
  return "bg-red-400";
}

function HeaderMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl border border-orange-300/35 bg-orange-400/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
        <img className="h-7 w-7" src="/manus-storage/phase0-calibration-mark_addb599f.png" alt="Phase 0 calibration mark" />
      </div>
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-[-0.04em] text-stone-100">PHASE 0</span>
          <span className="h-3.5 w-px bg-orange-400/70" />
          <span className="text-sm font-bold tracking-[-0.04em] text-orange-300">LOAD LAB</span>
        </div>
        <span className="absolute bottom-[-3px] right-0 h-px w-[61px] bg-orange-400/85" />
        <p className="mono mt-0.5 text-[10px] uppercase tracking-[0.16em] text-stone-500">Local LLM capacity observation</p>
      </div>
    </div>
  );
}

function MetricReadout({ label, value, hint, accent = false }: { label: string; value: string; hint: string; accent?: boolean }) {
  return (
    <div className="min-w-0 border-l border-stone-700/70 pl-4 first:border-l-0 first:pl-0">
      <p className="panel-label">{label}</p>
      <p className={`mono mt-1 truncate text-lg font-semibold tracking-[-0.04em] ${accent ? "text-orange-300" : "text-stone-100"}`}>{value}</p>
      <p className="mono mt-0.5 text-[10px] text-stone-500">{hint}</p>
    </div>
  );
}

function CapacityMeter({ users, planned }: { users: VirtualUser[]; planned: number }) {
  const laneCount = clamp(Math.max(planned, 4), 4, 12);
  const queued = users.filter((user) => user.status === "queued" || user.status === "waiting").length;
  const active = users.filter((user) => user.status === "streaming").length;
  const complete = users.filter((user) => user.status === "completed").length;

  return (
    <div className="rounded-2xl border border-stone-700/80 bg-stone-950/55 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="panel-label text-orange-300/85">Request lane bus</p>
          <p className="mono mt-1 text-sm font-semibold text-stone-100">{active} active · {queued} waiting · {complete} complete</p>
        </div>
        <span className="mono rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-[10px] text-stone-400">{laneCount} lanes drawn</span>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {Array.from({ length: laneCount }, (_, index) => {
          const status = users[index]?.status ?? "queued";
          const color = status === "streaming" ? "bg-orange-400" : status === "completed" ? "bg-teal-300" : status === "error" ? "bg-red-400" : status === "cancelled" ? "bg-stone-500" : users[index] ? "bg-amber-300" : "meter-segment";
          return (
            <div className="rounded-sm border border-stone-700/80 bg-stone-900/70 p-1" key={index}>
              <div className={`h-6 rounded-[2px] ${color}`} />
              <p className="mono mt-1 text-center text-[8px] text-stone-500">{String(index + 1).padStart(2, "0")}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChannelCard({ user, baselineTtft }: { user: VirtualUser; baselineTtft?: number }) {
  const generationRate = user.completionTokens && user.elapsedMs && user.firstTokenMs
    ? user.completionTokens / Math.max((user.elapsedMs - user.firstTokenMs) / 1_000, 0.001)
    : undefined;
  const progress = user.status === "completed" ? 100 : user.status === "streaming" ? 58 : user.status === "waiting" ? 24 : user.status === "error" || user.status === "cancelled" ? 100 : 8;

  return (
    <article className="instrument-panel sweep-in relative overflow-hidden rounded-2xl border border-stone-700/70 p-4">
      <div className="absolute inset-x-0 top-0 h-px hairline" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${statusDot[user.status]}`} />
          <span className="mono text-xs font-semibold text-stone-100">VU-{String(user.id).padStart(2, "0")}</span>
        </div>
        <span className={`mono rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${statusStyle[user.status]}`}>{user.status}</span>
      </div>

      <div className="mt-4 h-1 overflow-hidden rounded-full bg-stone-800">
        <div className={`h-full rounded-full transition-all duration-200 ${user.status === "error" ? "bg-red-400" : user.status === "cancelled" ? "bg-stone-500" : "bg-orange-400"}`} style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <p className="panel-label">TTFT</p>
          <p className="mono mt-1 text-xs text-stone-200">{formatMs(user.firstTokenMs)}</p>
        </div>
        <div>
          <p className="panel-label">Response start</p>
          <p className="mono mt-1 text-xs text-stone-200">{formatMs(user.responseStartMs)}</p>
        </div>
        <div>
          <p className="panel-label">Elapsed</p>
          <p className="mono mt-1 text-xs text-stone-200">{formatMs(user.elapsedMs)}</p>
        </div>
        <div>
          <p className="panel-label">Output rate</p>
          <p className="mono mt-1 text-xs text-stone-200">{generationRate ? `${generationRate.toFixed(1)} tok/s` : "not reported"}</p>
        </div>
      </div>

      {user.firstTokenMs !== undefined && (
        <div className="mt-4 flex items-center gap-2">
          <span className="panel-label shrink-0">TTFT trace</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-stone-800">
            <div className={`h-full rounded-full ${metricTone(user.firstTokenMs, baselineTtft ?? user.firstTokenMs)}`} style={{ width: `${Math.min(100, 20 + (user.firstTokenMs / Math.max(baselineTtft ?? user.firstTokenMs, 1)) * 28)}%` }} />
          </div>
        </div>
      )}

      <div className="mono mt-4 min-h-20 rounded-xl border border-stone-700/60 bg-stone-950/45 p-3 text-[11px] leading-5 text-stone-400">
        {user.error ? <span className="text-red-200">{user.error}</span> : user.output || <span className="text-stone-600">Awaiting stream output…</span>}
      </div>
    </article>
  );
}

export default function Home() {
  const [config, setConfig] = useState<TestConfig>(initialConfig);
  const [users, setUsers] = useState<VirtualUser[]>([]);
  const [events, setEvents] = useState<EventItem[]>([
    { id: 1, timestamp: "ready", tone: "neutral", message: "Configure an OpenAI-compatible endpoint, then launch a bounded run." },
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const abortControllers = useRef(new Map<number, AbortController>());
  const eventId = useRef(2);
  const runId = useRef(0);

  const metrics = useMemo(() => {
    const completed = users.filter((user) => user.status === "completed");
    const errorCount = users.filter((user) => user.status === "error").length;
    const cancelledCount = users.filter((user) => user.status === "cancelled").length;
    const active = users.filter((user) => user.status === "waiting" || user.status === "streaming" || user.status === "queued").length;
    const ttfts = completed.flatMap((user) => user.firstTokenMs === undefined ? [] : [user.firstTokenMs]);
    const elapsed = completed.flatMap((user) => user.elapsedMs === undefined ? [] : [user.elapsedMs]);
    const completionTokens = completed.flatMap((user) => user.completionTokens === undefined ? [] : [user.completionTokens]);

    return {
      active,
      completed: completed.length,
      failed: errorCount + cancelledCount,
      p50Ttft: percentile(ttfts, 0.5),
      p95Ttft: percentile(ttfts, 0.95),
      p50Elapsed: percentile(elapsed, 0.5),
      p95Elapsed: percentile(elapsed, 0.95),
      totalCompletionTokens: completionTokens.reduce((sum, value) => sum + value, 0),
      reportingUsers: completionTokens.length,
    };
  }, [users]);

  const addEvent = (tone: EventItem["tone"], message: string) => {
    setEvents((current) => [
      { id: eventId.current++, timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), tone, message },
      ...current,
    ].slice(0, 24));
  };

  const updateUser = (id: number, patch: Partial<VirtualUser>) => {
    setUsers((current) => current.map((user) => user.id === id ? { ...user, ...patch } : user));
  };

  const runUser = async (id: number, currentRunId: number) => {
    const controller = new AbortController();
    abortControllers.current.set(id, controller);
    const start = performance.now();
    const timeout = window.setTimeout(() => controller.abort("Request timed out"), config.timeoutMs);
    const uniquePrompt = config.uniqueSuffix
      ? `${config.prompt.trim()}\n\nVirtual user ${id}: produce an independent answer.`
      : config.prompt.trim();

    updateUser(id, { status: "waiting", startedAt: start });
    addEvent("neutral", `VU-${String(id).padStart(2, "0")} dispatched to the model server.`);

    try {
      const response = await fetch(completionUrl(config.endpoint), {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {}),
        },
        body: JSON.stringify({
          model: config.model.trim(),
          stream: true,
          max_tokens: config.maxTokens,
          messages: [
            ...(config.systemPrompt.trim() ? [{ role: "system", content: config.systemPrompt.trim() }] : []),
            { role: "user", content: uniquePrompt },
          ],
        }),
      });

      const responseStartMs = performance.now() - start;
      if (!response.ok) {
        const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 180);
        throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`);
      }
      if (!response.body) throw new Error("The endpoint returned no response stream.");

      updateUser(id, { responseStartMs });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let output = "";
      let firstTokenMs: number | undefined;
      let promptTokens: number | undefined;
      let completionTokens: number | undefined;

      const consumeLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") return;
        try {
          const message = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const token = message.choices?.[0]?.delta?.content;
          if (typeof token === "string" && token.length > 0) {
            if (firstTokenMs === undefined) {
              firstTokenMs = performance.now() - start;
              updateUser(id, { status: "streaming", firstTokenMs });
              addEvent("good", `VU-${String(id).padStart(2, "0")} received its first token in ${formatMs(firstTokenMs)}.`);
            }
            output = `${output}${token}`.slice(0, 3_000);
            updateUser(id, { output });
          }
          if (message.usage) {
            promptTokens = message.usage.prompt_tokens;
            completionTokens = message.usage.completion_tokens;
            updateUser(id, { promptTokens, completionTokens });
          }
        } catch {
          // A non-JSON SSE line is ignored so one malformed event does not end the whole test.
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        lines.forEach(consumeLine);
        if (done) break;
      }
      if (buffer) consumeLine(buffer);

      const elapsedMs = performance.now() - start;
      if (currentRunId === runId.current) {
        updateUser(id, { status: "completed", elapsedMs, firstTokenMs, promptTokens, completionTokens, output });
        addEvent("good", `VU-${String(id).padStart(2, "0")} completed in ${formatMs(elapsedMs)}.`);
      }
    } catch (reason) {
      const elapsedMs = performance.now() - start;
      const cancelled = controller.signal.aborted;
      const message = cancelled
        ? "Cancelled by operator or request timeout."
        : reason instanceof Error
          ? reason.message
          : "Unknown request error.";
      updateUser(id, { status: cancelled ? "cancelled" : "error", elapsedMs, error: message });
      addEvent(cancelled ? "warn" : "bad", `VU-${String(id).padStart(2, "0")} ${cancelled ? "stopped" : "failed"}: ${message}`);
    } finally {
      window.clearTimeout(timeout);
      abortControllers.current.delete(id);
    }
  };

  const startRun = async () => {
    if (isRunning) return;
    if (!config.endpoint.trim() || !config.model.trim() || !config.prompt.trim()) {
      addEvent("bad", "Endpoint, model, and prompt are required before a test can start.");
      return;
    }

    const nextRunId = runId.current + 1;
    runId.current = nextRunId;
    const scenarios = Array.from({ length: config.virtualUsers }, (_, index) => ({ id: index + 1, status: "queued" as UserStatus, output: "" }));
    setUsers(scenarios);
    setIsRunning(true);
    addEvent("neutral", `Starting ${config.virtualUsers} virtual users with a ${config.rampMs} ms launch ramp.`);

    await Promise.allSettled(scenarios.map(async (user, index) => {
      if (index > 0) await wait(index * config.rampMs);
      if (nextRunId !== runId.current) return;
      await runUser(user.id, nextRunId);
    }));

    if (nextRunId === runId.current) {
      setIsRunning(false);
      addEvent("neutral", "Run settled. Review p50/p95 metrics before changing the next test variable.");
    }
  };

  const stopRun = () => {
    if (!isRunning) return;
    runId.current += 1;
    abortControllers.current.forEach((controller) => controller.abort("Stopped by operator"));
    setUsers((current) => current.map((user) => (
      user.status === "queued" || user.status === "waiting" || user.status === "streaming"
        ? { ...user, status: "cancelled", error: "Cancelled by operator." }
        : user
    )));
    setIsRunning(false);
    addEvent("warn", "Stop signal sent to every active virtual user.");
  };

  const resetRun = () => {
    if (isRunning) return;
    setUsers([]);
    addEvent("neutral", "Run evidence cleared. Configuration remains unchanged.");
  };

  const copyEndpoint = async () => {
    try {
      await navigator.clipboard.writeText(completionUrl(config.endpoint));
      addEvent("neutral", "Completion URL copied to the clipboard.");
    } catch {
      addEvent("warn", "Browser clipboard access was unavailable.");
    }
  };

  return (
    <main
      className="min-h-screen bg-[#171717] text-stone-100"
      style={{ backgroundImage: "linear-gradient(rgba(23,23,23,0.88), rgba(23,23,23,0.97)), url('/manus-storage/phase0-instrument-grain_c5a8e851.png')", backgroundSize: "cover", backgroundAttachment: "fixed" }}
    >
      <header className="border-b border-stone-800/90 bg-stone-950/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1720px] items-center justify-between gap-5 px-4 py-4 sm:px-6 lg:px-8">
          <HeaderMark />
          <div className="hidden items-center gap-7 lg:flex">
            <div className="text-right">
              <p className="panel-label">Target mode</p>
              <p className="mono mt-1 text-xs text-stone-300">OpenAI-compatible stream</p>
            </div>
            <div className="h-8 w-px bg-stone-800" />
            <div className="text-right">
              <p className="panel-label">Safety posture</p>
              <p className="mono mt-1 flex items-center justify-end gap-1.5 text-xs text-teal-200"><Check className="h-3.5 w-3.5" /> bounded browser run</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1720px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[320px_minmax(0,1fr)_320px] lg:gap-5 lg:px-8 lg:py-6">
        <aside className="faceplate h-fit rounded-2xl border border-orange-200/10 lg:sticky lg:top-5">
          <div className="border-b border-stone-700/70 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="panel-label">01 / TEST PLAN</p>
                <h1 className="mt-1 text-lg font-semibold tracking-[-0.04em]">Configure the instrument</h1>
              </div>
              <Settings2 className="h-5 w-5 text-orange-300" />
            </div>
          </div>

          <div className="space-y-5 p-5">
            <label className="block">
              <span className="panel-label">Endpoint base URL</span>
              <div className="mt-2 flex gap-2">
                <Input className="mono h-10 border-stone-700 bg-stone-950/60 text-xs text-stone-100 placeholder:text-stone-600" value={config.endpoint} onChange={(event) => setConfig((current) => ({ ...current, endpoint: event.target.value }))} placeholder="http://127.0.0.1:8080/v1" disabled={isRunning} />
                <Button variant="outline" size="icon" className="h-10 shrink-0 border-stone-700 bg-stone-900/60 text-stone-300 hover:bg-stone-800 hover:text-stone-100" onClick={copyEndpoint} disabled={isRunning} aria-label="Copy completion URL"><Copy className="h-4 w-4" /></Button>
              </div>
              <span className="mono mt-1.5 block text-[10px] leading-4 text-stone-500">The dashboard adds `/chat/completions` automatically.</span>
            </label>

            <label className="block">
              <span className="panel-label">API key <span className="normal-case tracking-normal text-stone-600">optional for local test</span></span>
              <div className="relative mt-2">
                <KeyRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-500" />
                <Input className="mono h-10 border-stone-700 bg-stone-950/60 pl-9 pr-10 text-xs text-stone-100 placeholder:text-stone-600" value={config.apiKey} onChange={(event) => setConfig((current) => ({ ...current, apiKey: event.target.value }))} type={showKey ? "text" : "password"} placeholder="sk-…" autoComplete="off" disabled={isRunning} />
                <button type="button" className="absolute right-3 top-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-stone-500 transition-colors hover:text-stone-200" onClick={() => setShowKey((current) => !current)} disabled={isRunning}>{showKey ? "hide" : "show"}</button>
              </div>
              <span className="mono mt-1.5 block text-[10px] leading-4 text-stone-500">Held only in this browser session. Never paste a production master key.</span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block col-span-2">
                <span className="panel-label">Model name</span>
                <Input className="mono mt-2 h-10 border-stone-700 bg-stone-950/60 text-xs text-stone-100 placeholder:text-stone-600" value={config.model} onChange={(event) => setConfig((current) => ({ ...current, model: event.target.value }))} placeholder="qwen2.5:3b" disabled={isRunning} />
              </label>
              <label className="block">
                <span className="panel-label">Users</span>
                <Input className="mono mt-2 h-10 border-stone-700 bg-stone-950/60 text-xs text-stone-100" type="number" min={1} max={12} value={config.virtualUsers} onChange={(event) => setConfig((current) => ({ ...current, virtualUsers: clamp(Number(event.target.value) || 1, 1, 12) }))} disabled={isRunning} />
              </label>
              <label className="block">
                <span className="panel-label">Ramp</span>
                <div className="relative mt-2">
                  <Input className="mono h-10 border-stone-700 bg-stone-950/60 pr-8 text-xs text-stone-100" type="number" min={0} max={10_000} step={100} value={config.rampMs} onChange={(event) => setConfig((current) => ({ ...current, rampMs: clamp(Number(event.target.value) || 0, 0, 10_000) }))} disabled={isRunning} />
                  <span className="mono pointer-events-none absolute right-2.5 top-3 text-[10px] text-stone-500">ms</span>
                </div>
              </label>
              <label className="block">
                <span className="panel-label">Max output</span>
                <div className="relative mt-2">
                  <Input className="mono h-10 border-stone-700 bg-stone-950/60 pr-9 text-xs text-stone-100" type="number" min={8} max={2_048} value={config.maxTokens} onChange={(event) => setConfig((current) => ({ ...current, maxTokens: clamp(Number(event.target.value) || 8, 8, 2_048) }))} disabled={isRunning} />
                  <span className="mono pointer-events-none absolute right-2.5 top-3 text-[10px] text-stone-500">tok</span>
                </div>
              </label>
              <label className="block">
                <span className="panel-label">Timeout</span>
                <div className="relative mt-2">
                  <Input className="mono h-10 border-stone-700 bg-stone-950/60 pr-8 text-xs text-stone-100" type="number" min={5_000} max={600_000} step={5_000} value={config.timeoutMs} onChange={(event) => setConfig((current) => ({ ...current, timeoutMs: clamp(Number(event.target.value) || 5_000, 5_000, 600_000) }))} disabled={isRunning} />
                  <span className="mono pointer-events-none absolute right-2.5 top-3 text-[10px] text-stone-500">ms</span>
                </div>
              </label>
            </div>

            <label className="block">
              <span className="panel-label">System instruction</span>
              <Textarea className="mono mt-2 min-h-20 resize-y border-stone-700 bg-stone-950/60 text-xs leading-5 text-stone-100 placeholder:text-stone-600" value={config.systemPrompt} onChange={(event) => setConfig((current) => ({ ...current, systemPrompt: event.target.value }))} disabled={isRunning} />
            </label>

            <label className="block">
              <span className="panel-label">User prompt</span>
              <Textarea className="mono mt-2 min-h-32 resize-y border-stone-700 bg-stone-950/60 text-xs leading-5 text-stone-100 placeholder:text-stone-600" value={config.prompt} onChange={(event) => setConfig((current) => ({ ...current, prompt: event.target.value }))} disabled={isRunning} />
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-700/70 bg-stone-950/40 p-3 transition-colors hover:border-stone-600">
              <input className="mt-0.5 h-4 w-4 accent-orange-400" type="checkbox" checked={config.uniqueSuffix} onChange={(event) => setConfig((current) => ({ ...current, uniqueSuffix: event.target.checked }))} disabled={isRunning} />
              <span>
                <span className="mono block text-[11px] font-medium text-stone-200">Make users independent</span>
                <span className="mono mt-1 block text-[10px] leading-4 text-stone-500">Adds a user-specific suffix. Turn off only for shared-prefix cache tests.</span>
              </span>
            </label>

            <div className="grid grid-cols-2 gap-2 pt-1">
              {isRunning ? (
                <Button className="col-span-2 h-11 bg-red-500 text-white shadow-[0_10px_24px_rgba(239,68,68,0.18)] hover:bg-red-400" onClick={stopRun}><CircleStop className="mr-2 h-4 w-4" /> Stop active run</Button>
              ) : (
                <Button className="col-span-2 h-11 bg-orange-400 text-stone-950 shadow-[0_10px_24px_rgba(240,93,35,0.22)] hover:bg-orange-300" onClick={startRun}><Play className="mr-2 h-4 w-4 fill-current" /> Launch {config.virtualUsers} users</Button>
              )}
              <Button variant="outline" className="h-10 border-stone-700 bg-stone-900/40 text-stone-300 hover:bg-stone-800 hover:text-stone-50" onClick={resetRun} disabled={isRunning || users.length === 0}><RotateCcw className="mr-2 h-4 w-4" /> Clear evidence</Button>
              <Button variant="outline" className="h-10 border-stone-700 bg-stone-900/40 text-stone-300 hover:bg-stone-800 hover:text-stone-50" onClick={() => setConfig(initialConfig)} disabled={isRunning}><TimerReset className="mr-2 h-4 w-4" /> Reset plan</Button>
            </div>
          </div>
        </aside>

        <section className="min-w-0 space-y-4 lg:space-y-5">
          <div className="instrument-panel relative overflow-hidden rounded-2xl border border-stone-700/70">
            <div className="absolute inset-0 opacity-35" style={{ backgroundImage: "url('/manus-storage/phase0-capacity-lines_28efcafd.png')", backgroundSize: "cover", backgroundPosition: "center" }} />
            <div className="relative p-5 sm:p-6">
              <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
                <div className="max-w-md">
                  <p className="panel-label text-orange-300/80">Live observation field</p>
                  <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.05em] text-stone-50 sm:text-2xl">Live capacity profile</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-400">Read the lane bus first. The summary below is evidence from independent streaming requests, not a theoretical speed claim.</p>
                </div>
                <div className="flex items-center gap-3 self-start rounded-xl border border-stone-700/80 bg-stone-950/55 px-3 py-2 xl:self-auto">
                  <div className={`h-2.5 w-2.5 rounded-full ${isRunning ? "bg-orange-400 animate-pulse" : "bg-stone-600"}`} />
                  <div>
                    <p className="panel-label">Run state</p>
                    <p className="mono mt-0.5 text-xs font-medium text-stone-200">{isRunning ? "IN PROGRESS" : users.length ? "SETTLED" : "READY"}</p>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-4 border-t border-stone-700/70 pt-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
                <CapacityMeter users={users} planned={config.virtualUsers} />
                <div className="grid grid-cols-2 gap-x-4 gap-y-5 rounded-2xl border border-stone-700/80 bg-stone-950/40 p-4">
                  <MetricReadout label="Active demand" value={`${metrics.active} / ${config.virtualUsers}`} hint="queued + waiting + streaming" accent={metrics.active > 0} />
                  <MetricReadout label="p50 TTFT" value={formatMs(metrics.p50Ttft)} hint="first streamed token" />
                  <MetricReadout label="p95 TTFT" value={formatMs(metrics.p95Ttft)} hint="tail interactive latency" />
                  <MetricReadout label="p95 elapsed" value={formatMs(metrics.p95Elapsed)} hint="successful requests" />
                </div>
              </div>
            </div>
          </div>

          <div className="instrument-panel overflow-hidden rounded-2xl border border-stone-700/70">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-700/70 p-5">
              <div className="flex items-center gap-3">
                <RadioTower className="h-5 w-5 text-orange-300" />
                <div>
                  <p className="panel-label">02 / VIRTUAL USER CHANNELS</p>
                  <h2 className="mt-1 text-base font-semibold tracking-[-0.04em]">Each card is one independent streaming request</h2>
                </div>
              </div>
              <div className="mono flex items-center gap-3 text-[10px] uppercase tracking-[0.1em] text-stone-500">
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-teal-300" /> healthy</span>
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> waiting</span>
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-red-400" /> failed</span>
              </div>
            </div>

            <div className="min-h-[380px] p-4 sm:p-5">
              {users.length === 0 ? (
                <div className="grid min-h-[340px] place-items-center rounded-2xl border border-dashed border-stone-700 bg-stone-950/30 p-8 text-center">
                  <div className="max-w-md">
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-orange-300/20 bg-orange-400/10"><UsersRound className="h-5 w-5 text-orange-300" /></div>
                    <h3 className="mt-4 text-lg font-semibold tracking-[-0.04em]">No request channels yet</h3>
                    <p className="mt-2 text-sm leading-6 text-stone-500">Start with one virtual user to capture a baseline. Then run the exact same test at two users before you change the prompt, context, or output cap.</p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {users.map((user) => <ChannelCard key={user.id} user={user} baselineTtft={metrics.p50Ttft} />)}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:gap-5">
            <div className="instrument-panel rounded-2xl border border-stone-700/70 p-5">
              <div className="flex items-center gap-3">
                <Gauge className="h-5 w-5 text-teal-300" />
                <div>
                  <p className="panel-label">Result summary</p>
                  <h2 className="mt-1 text-base font-semibold tracking-[-0.04em]">Do not treat one number as capacity</h2>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4">
                <div><dt className="panel-label">Completed</dt><dd className="mono mt-1 text-xl font-semibold text-teal-200">{metrics.completed}</dd></div>
                <div><dt className="panel-label">Failed / stopped</dt><dd className={`mono mt-1 text-xl font-semibold ${metrics.failed ? "text-red-200" : "text-stone-200"}`}>{metrics.failed}</dd></div>
                <div><dt className="panel-label">p50 elapsed</dt><dd className="mono mt-1 text-sm text-stone-200">{formatMs(metrics.p50Elapsed)}</dd></div>
                <div><dt className="panel-label">Server-reported output</dt><dd className="mono mt-1 text-sm text-stone-200">{metrics.reportingUsers ? `${metrics.totalCompletionTokens} tok` : "not reported"}</dd></div>
              </dl>
            </div>

            <div className="instrument-panel rounded-2xl border border-stone-700/70 p-5">
              <div className="flex items-center gap-3">
                <ShieldAlert className="h-5 w-5 text-amber-300" />
                <div>
                  <p className="panel-label">Phase 0 discipline</p>
                  <h2 className="mt-1 text-base font-semibold tracking-[-0.04em]">One changed variable per run</h2>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-stone-400">Record the baseline first. Then change only one of users, ramp, server slots, context size, or maximum output. This is how you find a reliable operating limit instead of guessing.</p>
              <a className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-orange-300 transition-colors hover:text-orange-200" href="https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md" target="_blank" rel="noreferrer">Review server slot controls <ArrowUpRight className="h-4 w-4" /></a>
            </div>
          </div>
        </section>

        <aside className="instrument-panel relative min-h-[300px] overflow-hidden rounded-2xl border border-stone-700/70 lg:sticky lg:top-5 lg:max-h-[calc(100vh-40px)]">
          <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "url('/manus-storage/phase0-run-tape-pattern_56869dd9.png')", backgroundSize: "cover", backgroundPosition: "center" }} />
          <div className="relative flex h-full flex-col">
            <div className="border-b border-stone-700/70 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="panel-label">03 / RUN TAPE</p>
                  <h2 className="mt-1 text-base font-semibold tracking-[-0.04em]">Evidence, not decoration</h2>
                </div>
                <Activity className="h-5 w-5 text-orange-300" />
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-0 overflow-y-auto p-4">
              {events.map((event, index) => {
                const tone = event.tone === "good" ? "bg-teal-300" : event.tone === "warn" ? "bg-amber-300" : event.tone === "bad" ? "bg-red-400" : "bg-stone-500";
                return (
                  <div className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-3 pb-5 last:pb-0" key={event.id}>
                    {index !== events.length - 1 && <span className="absolute left-[3px] top-3 h-[calc(100%-6px)] w-px bg-stone-700/80" />}
                    <span className={`relative z-10 mt-1.5 h-2 w-2 rounded-full ${tone}`} />
                    <div>
                      <p className="mono text-[10px] text-stone-500">{event.timestamp}</p>
                      <p className="mt-1 text-xs leading-5 text-stone-300">{event.message}</p>
                    </div>
                  </div>
                );
              })}
              {events.length < 4 && (
                <div className="mt-1 border-t border-dashed border-stone-700/70 pt-4">
                  <p className="panel-label">Reserved evidence slots</p>
                  {["dispatch marker", "first-token marker", "terminal marker"].map((label, index) => (
                    <div className="mono mt-3 flex items-center gap-2 text-[10px] text-stone-600" key={label}>
                      <span className="h-1.5 w-1.5 rounded-full border border-stone-600" />
                      <span>0{index + 1}</span>
                      <span className="h-px flex-1 bg-stone-800" />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-stone-700/70 p-4">
              <div className="mb-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-stone-700/70 bg-stone-950/45 p-2"><p className="panel-label">Active</p><p className="mono mt-1 text-sm text-orange-300">{metrics.active}</p></div>
                <div className="rounded-lg border border-stone-700/70 bg-stone-950/45 p-2"><p className="panel-label">Done</p><p className="mono mt-1 text-sm text-teal-200">{metrics.completed}</p></div>
                <div className="rounded-lg border border-stone-700/70 bg-stone-950/45 p-2"><p className="panel-label">Faults</p><p className="mono mt-1 text-sm text-red-200">{metrics.failed}</p></div>
              </div>
              <div className="flex items-start gap-2 rounded-xl border border-stone-700/70 bg-stone-950/45 p-3">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-orange-300" />
                <p className="mono text-[10px] leading-4 text-stone-500">This tool is a browser-side Phase 0 instrument. Keep the key ephemeral, test synthetic prompts, and do not call a public production endpoint until a protected gateway exists.</p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
