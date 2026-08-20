/**
 * Instrument Panel style: a private owner cockpit with asymmetrical status cards,
 * a hard data ledger, and an explicit escape back to the independent load lab.
 * This page never persists secrets and receives only safe key metadata.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Copy,
  Cpu,
  Gauge,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UsersRound,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

type ConsoleTab = "overview" | "customers" | "activity";

type Overview = {
  generated_at: string;
  health: { gateway: string; backend: string; model: string };
  capacity: {
    global_active: number;
    global_limit: number;
    per_key_concurrent_limit: number;
    default_rpm_limit: number;
    default_daily_request_limit: number;
    default_max_output: number;
    absolute_max_output: number;
  };
  usage: {
    usage_day: string;
    events: {
      total_events: number | null;
      successful_events: number | null;
      throttled_events: number | null;
      failed_events: number | null;
    };
    keys: {
      total_keys: number | null;
      active_keys: number | null;
      revoked_keys: number | null;
    };
    today: { requests_today: number; reported_output_tokens_today: number };
  };
};

type KeyRow = {
  prefix: string;
  tenant_id: string;
  label: string;
  status: "active" | "revoked";
  expires_at: string | null;
  active_limit: number;
  rpm_limit: number;
  daily_request_limit: number;
  max_output: number;
  created_at: string;
  revoked_at: string | null;
  requests_today: number;
  reported_output_tokens_today: number;
  last_seen_at: string | null;
};

type EventRow = {
  started_at: string;
  model_alias: string;
  queued_ms: number;
  response_start_ms: number | null;
  ttft_ms: number | null;
  elapsed_ms: number;
  requested_output: number;
  reported_output: number | null;
  finish_reason: string | null;
  status_code: number;
  outcome: string;
  error_code: string | null;
  prefix: string | null;
  tenant_id: string | null;
  label: string | null;
};

type CreatedKey = {
  api_key: string;
  prefix: string;
  expires_at: string;
  warning: string;
};

const number = (value: number | null | undefined) =>
  new Intl.NumberFormat().format(value ?? 0);
const when = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "—";
const duration = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : value < 1000
      ? `${Math.round(value)} ms`
      : `${(value / 1000).toFixed(2)} s`;

async function ownerRequest<T>(
  path: string,
  token: string,
  options: RequestInit = {}
) {
  const response = await fetch(`/admin/api${path}`, {
    ...options,
    headers: {
      "x-owner-console-token": token,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      payload?.error?.message ||
        `Owner console request failed with HTTP ${response.status}.`
    );
  return payload as T;
}

function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-stone-700/70 bg-stone-950/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${className}`}
    >
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  tone = "stone",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "stone" | "teal" | "orange" | "red";
}) {
  const color =
    tone === "teal"
      ? "text-teal-200"
      : tone === "orange"
        ? "text-orange-300"
        : tone === "red"
          ? "text-red-300"
          : "text-stone-100";
  return (
    <div className="min-w-0 border-l border-stone-700/70 pl-4 first:border-l-0 first:pl-0">
      <p className="panel-label">{label}</p>
      <p
        className={`mono mt-1 truncate text-xl font-semibold tracking-[-0.05em] ${color}`}
      >
        {value}
      </p>
      <p className="mono mt-1 text-[10px] leading-4 text-stone-500">{hint}</p>
    </div>
  );
}

export default function AdminConsole() {
  const [tokenDraft, setTokenDraft] = useState("");
  const [ownerToken, setOwnerToken] = useState("");
  const [tab, setTab] = useState<ConsoleTab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshAt, setRefreshAt] = useState<string | null>(null);
  const [tenant, setTenant] = useState("");
  const [label, setLabel] = useState("");
  const [expiryDays, setExpiryDays] = useState("30");
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);

  const load = async (token = ownerToken) => {
    if (!token) return;
    setLoading(true);
    try {
      const [nextOverview, nextKeys, nextEvents] = await Promise.all([
        ownerRequest<Overview>("/overview", token),
        ownerRequest<{ keys: KeyRow[] }>("/keys", token),
        ownerRequest<{ events: EventRow[] }>("/events?limit=60", token),
      ]);
      setOverview(nextOverview);
      setKeys(nextKeys.keys);
      setEvents(nextEvents.events);
      setRefreshAt(new Date().toLocaleTimeString());
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not load owner data."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ownerToken) return;
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [ownerToken]);

  const protectedEvents = useMemo(
    () => events.filter(event => event.status_code === 429).length,
    [events]
  );
  const activeKeys = useMemo(
    () => keys.filter(key => key.status === "active"),
    [keys]
  );

  const unlock = async () => {
    const candidate = tokenDraft.trim();
    if (!candidate)
      return setError(
        "Enter the private owner-console token stored on the Mac mini."
      );
    setOwnerToken(candidate);
    setTokenDraft("");
  };

  const createKey = async () => {
    try {
      const result = await ownerRequest<CreatedKey>("/keys", ownerToken, {
        method: "POST",
        body: JSON.stringify({
          tenant_id: tenant.trim(),
          label: label.trim(),
          expires_days: Number(expiryDays) || 30,
        }),
      });
      setCreatedKey(result);
      setTenant("");
      setLabel("");
      setExpiryDays("30");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not create the key."
      );
    }
  };

  const revokeKey = async (key: KeyRow) => {
    if (
      !window.confirm(
        `Revoke ${key.prefix} for ${key.tenant_id}? It cannot make new requests after revocation.`
      )
    )
      return;
    try {
      await ownerRequest("/keys/revoke", ownerToken, {
        method: "POST",
        body: JSON.stringify({ prefix: key.prefix }),
      });
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not revoke the key."
      );
    }
  };

  const copyCreatedKey = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey.api_key);
  };

  if (!ownerToken) {
    return (
      <main
        className="grid min-h-screen place-items-center bg-[#171717] px-5 text-stone-100"
        style={{
          backgroundImage:
            "radial-gradient(circle at 18% 10%, rgba(240,93,35,0.12), transparent 34%), linear-gradient(rgba(23,23,23,0.92), rgba(23,23,23,0.99))",
        }}
      >
        <Panel className="w-full max-w-md overflow-hidden">
          <div className="border-b border-stone-700/70 bg-stone-900/55 p-7">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl border border-orange-300/30 bg-orange-300/10">
                <LockKeyhole className="h-5 w-5 text-orange-300" />
              </div>
              <div>
                <p className="panel-label text-orange-200">Private surface</p>
                <h1 className="mt-1 text-xl font-semibold tracking-[-0.05em]">
                  Owner Console
                </h1>
              </div>
            </div>
            <p className="mono mt-5 text-xs leading-5 text-stone-400">
              This console is for the Mac mini owner only. It is designed for
              `127.0.0.1:3000` through your private SSH tunnel and has no
              Cloudflare public route.
            </p>
          </div>
          <div className="space-y-4 p-7">
            <label className="block">
              <span className="panel-label">Owner-console token</span>
              <Input
                value={tokenDraft}
                onChange={event => setTokenDraft(event.target.value)}
                onKeyDown={event => event.key === "Enter" && void unlock()}
                type="password"
                autoComplete="current-password"
                className="mono mt-2 h-11 border-stone-700 bg-stone-950 text-sm text-stone-100"
                placeholder="Paste from the Mac mini environment file"
              />
            </label>
            {error && (
              <p className="mono rounded-lg border border-red-400/25 bg-red-400/10 p-3 text-xs leading-5 text-red-200">
                {error}
              </p>
            )}
            <Button
              onClick={() => void unlock()}
              className="h-11 w-full bg-orange-400 text-stone-950 hover:bg-orange-300"
            >
              <LockKeyhole className="mr-2 h-4 w-4" /> Unlock private console
            </Button>
            <Link
              href="/"
              className="mono flex items-center justify-center gap-2 text-[11px] text-stone-500 transition-colors hover:text-stone-200"
            >
              Return to private load lab{" "}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Panel>
      </main>
    );
  }

  const nav: Array<{ id: ConsoleTab; label: string; icon: React.ReactNode }> = [
    { id: "overview", label: "Overview", icon: <Gauge className="h-4 w-4" /> },
    {
      id: "customers",
      label: "Customers & keys",
      icon: <UsersRound className="h-4 w-4" />,
    },
    {
      id: "activity",
      label: "Request activity",
      icon: <Activity className="h-4 w-4" />,
    },
  ];

  return (
    <main
      className="min-h-screen bg-[#171717] text-stone-100"
      style={{
        backgroundImage:
          "linear-gradient(rgba(23,23,23,0.92), rgba(23,23,23,0.98))",
      }}
    >
      <header className="sticky top-0 z-20 border-b border-stone-800 bg-stone-950/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1720px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-orange-300/30 bg-orange-300/10">
              <ShieldAlert className="h-5 w-5 text-orange-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold tracking-[-0.04em]">OWNER</p>
                <span className="h-3.5 w-px bg-orange-400/70" />
                <p className="text-sm font-bold tracking-[-0.04em] text-orange-300">
                  CONSOLE
                </p>
              </div>
              <p className="mono mt-0.5 text-[10px] uppercase tracking-[0.15em] text-stone-500">
                Private gateway operations
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden mono text-[10px] text-stone-500 sm:block">
              refresh {refreshAt ?? "—"}
            </span>
            <Button
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
              className="h-9 border-stone-700 bg-stone-900/50 text-stone-300 hover:bg-stone-800"
            >
              <RefreshCw
                className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />{" "}
              Refresh
            </Button>
            <Link
              href="/"
              className="mono rounded-md border border-stone-700 bg-stone-900/50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-stone-300 transition-colors hover:bg-stone-800"
            >
              Load lab
            </Link>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1720px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:px-8">
        <aside className="faceplate h-fit rounded-2xl border border-orange-200/10 p-3 lg:sticky lg:top-24">
          <p className="panel-label px-3 py-3">Control surfaces</p>
          <nav className="space-y-1">
            {nav.map(item => (
              <button
                type="button"
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`mono flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-[11px] font-medium transition-colors ${tab === item.id ? "bg-orange-300/12 text-orange-100" : "text-stone-400 hover:bg-stone-800 hover:text-stone-200"}`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
          <div className="mx-3 mt-5 border-t border-stone-700/70 pt-4">
            <p className="mono text-[10px] leading-4 text-stone-500">
              The public API hostname does not route to this console. No
              customer can see these records.
            </p>
          </div>
        </aside>
        <section className="min-w-0">
          {error && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-400/25 bg-red-400/10 p-4">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <p className="mono text-xs leading-5 text-red-200">{error}</p>
            </div>
          )}
          {tab === "overview" && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="panel-label text-orange-200">
                    01 / OPERATING PICTURE
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-[-0.05em]">
                    Gateway capacity and customer usage
                  </h1>
                  <p className="mono mt-2 max-w-2xl text-xs leading-5 text-stone-500">
                    Live data comes from the local SQLite request ledger. Prompt
                    text, answers, raw API keys, hashes, and the gateway admin
                    token are intentionally absent.
                  </p>
                </div>
                <span
                  className={`mono rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] ${overview?.health.backend === "reachable" ? "border-teal-300/30 bg-teal-300/10 text-teal-100" : "border-red-300/30 bg-red-300/10 text-red-100"}`}
                >
                  {overview?.health.backend === "reachable"
                    ? "backend reachable"
                    : "awaiting health"}
                </span>
              </div>
              <Panel className="p-5">
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
                  <Metric
                    label="Active now"
                    value={`${overview?.capacity.global_active ?? "—"} / ${overview?.capacity.global_limit ?? "—"}`}
                    hint="live gateway reservations"
                    tone="orange"
                  />
                  <Metric
                    label="Requests today"
                    value={number(overview?.usage.today.requests_today)}
                    hint={`UTC usage day ${overview?.usage.usage_day ?? "—"}`}
                    tone="teal"
                  />
                  <Metric
                    label="Active keys"
                    value={number(overview?.usage.keys.active_keys)}
                    hint={`${number(overview?.usage.keys.total_keys)} total records`}
                  />
                  <Metric
                    label="Protected events"
                    value={number(overview?.usage.events.throttled_events)}
                    hint="persisted 429 responses"
                    tone="orange"
                  />
                  <Metric
                    label="Server failures"
                    value={number(overview?.usage.events.failed_events)}
                    hint="persisted 5xx responses"
                    tone={
                      (overview?.usage.events.failed_events ?? 0) > 0
                        ? "red"
                        : "stone"
                    }
                  />
                </div>
              </Panel>
              <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                <Panel className="p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="panel-label">Capacity policy</p>
                      <h2 className="mt-1 text-base font-semibold tracking-[-0.04em]">
                        Measured protection boundary
                      </h2>
                    </div>
                    <Gauge className="h-5 w-5 text-orange-300" />
                  </div>
                  <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
                    <div>
                      <dt className="panel-label">Model alias</dt>
                      <dd className="mono mt-1 text-xs text-stone-200">
                        {overview?.health.model ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="panel-label">Per-key active</dt>
                      <dd className="mono mt-1 text-xs text-stone-200">
                        {overview?.capacity.per_key_concurrent_limit ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="panel-label">Default RPM</dt>
                      <dd className="mono mt-1 text-xs text-stone-200">
                        {overview?.capacity.default_rpm_limit ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="panel-label">Default daily</dt>
                      <dd className="mono mt-1 text-xs text-stone-200">
                        {overview?.capacity.default_daily_request_limit ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="panel-label">Customer output cap</dt>
                      <dd className="mono mt-1 text-xs text-stone-200">
                        {number(overview?.capacity.default_max_output)} tok
                      </dd>
                    </div>
                    <div>
                      <dt className="panel-label">Owner ceiling</dt>
                      <dd className="mono mt-1 text-xs text-stone-200">
                        {number(overview?.capacity.absolute_max_output)} tok
                      </dd>
                    </div>
                  </dl>
                </Panel>
                <Panel className="overflow-hidden">
                  <div className="border-b border-stone-700/70 p-5">
                    <p className="panel-label">Recent protection signal</p>
                    <h2 className="mt-1 text-base font-semibold tracking-[-0.04em]">
                      Newest gateway outcomes
                    </h2>
                  </div>
                  <div className="divide-y divide-stone-800/80">
                    {events.slice(0, 5).map((event, index) => (
                      <div
                        className="flex items-center gap-3 px-5 py-3"
                        key={`${event.started_at}-${index}`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${event.status_code >= 500 ? "bg-red-400" : event.status_code === 429 ? "bg-orange-300" : "bg-teal-300"}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="mono truncate text-[11px] text-stone-200">
                            {event.prefix ?? "unauthenticated"} ·{" "}
                            {event.outcome}
                          </p>
                          <p className="mono mt-1 text-[9px] text-stone-500">
                            {when(event.started_at)} · {event.status_code} ·{" "}
                            {duration(event.elapsed_ms)}
                          </p>
                        </div>
                      </div>
                    ))}
                    {events.length === 0 && (
                      <p className="mono p-5 text-xs text-stone-500">
                        No persisted request events yet.
                      </p>
                    )}
                  </div>
                </Panel>
              </div>
            </div>
          )}
          {tab === "customers" && (
            <div className="space-y-5">
              <div>
                <p className="panel-label text-orange-200">
                  02 / CUSTOMER CONTROL
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-[-0.05em]">
                  Keys, allowances, and current usage
                </h1>
                <p className="mono mt-2 text-xs leading-5 text-stone-500">
                  Only non-secret prefixes are displayed. Creating a key reveals
                  its raw value once; revocation takes effect for new requests
                  immediately.
                </p>
              </div>
              <div className="grid gap-5 xl:grid-cols-[0.72fr_1.28fr]">
                <Panel className="h-fit p-5">
                  <div className="flex items-center gap-2">
                    <Plus className="h-4 w-4 text-orange-300" />
                    <h2 className="text-base font-semibold tracking-[-0.04em]">
                      Create customer key
                    </h2>
                  </div>
                  <div className="mt-5 space-y-3">
                    <label className="block">
                      <span className="panel-label">Tenant ID</span>
                      <Input
                        value={tenant}
                        onChange={event => setTenant(event.target.value)}
                        className="mono mt-1.5 h-10 border-stone-700 bg-stone-950 text-xs"
                        placeholder="invite-01"
                      />
                    </label>
                    <label className="block">
                      <span className="panel-label">Label</span>
                      <Input
                        value={label}
                        onChange={event => setLabel(event.target.value)}
                        className="mono mt-1.5 h-10 border-stone-700 bg-stone-950 text-xs"
                        placeholder="Customer or project name"
                      />
                    </label>
                    <label className="block">
                      <span className="panel-label">Expiry days</span>
                      <Input
                        value={expiryDays}
                        onChange={event => setExpiryDays(event.target.value)}
                        type="number"
                        min="1"
                        max="3650"
                        className="mono mt-1.5 h-10 border-stone-700 bg-stone-950 text-xs"
                      />
                    </label>
                    <Button
                      onClick={() => void createKey()}
                      disabled={!tenant.trim() || !label.trim()}
                      className="mt-2 h-10 w-full bg-orange-400 text-stone-950 hover:bg-orange-300"
                    >
                      <KeyRound className="mr-2 h-4 w-4" /> Create key
                    </Button>
                  </div>
                  {createdKey && (
                    <div className="mt-5 rounded-xl border border-teal-300/25 bg-teal-300/[0.06] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="panel-label text-teal-100">
                            Shown once
                          </p>
                          <p className="mono mt-2 break-all text-[11px] leading-5 text-teal-50">
                            {createdKey.api_key}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => void copyCreatedKey()}
                          className="shrink-0 border-teal-300/30 text-teal-100"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="mono mt-3 text-[10px] leading-4 text-teal-100/70">
                        {createdKey.warning}
                      </p>
                    </div>
                  )}
                </Panel>
                <Panel className="overflow-hidden">
                  <div className="flex items-center justify-between border-b border-stone-700/70 p-5">
                    <div>
                      <p className="panel-label">Key ledger</p>
                      <h2 className="mt-1 text-base font-semibold tracking-[-0.04em]">
                        {activeKeys.length} active customer keys
                      </h2>
                    </div>
                    <UsersRound className="h-5 w-5 text-orange-300" />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[930px] text-left">
                      <thead className="border-b border-stone-800 bg-stone-900/30">
                        <tr className="panel-label">
                          <th className="px-5 py-3 font-medium">Customer</th>
                          <th className="px-3 py-3 font-medium">Status</th>
                          <th className="px-3 py-3 font-medium">Today</th>
                          <th className="px-3 py-3 font-medium">Limits</th>
                          <th className="px-3 py-3 font-medium">Last seen</th>
                          <th className="px-5 py-3 text-right font-medium">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-800/80">
                        {keys.map(key => (
                          <tr key={key.prefix} className="mono text-[11px]">
                            <td className="px-5 py-4">
                              <p className="text-stone-200">{key.tenant_id}</p>
                              <p className="mt-1 text-[9px] text-stone-500">
                                {key.prefix} · {key.label}
                              </p>
                            </td>
                            <td className="px-3 py-4">
                              <span
                                className={`rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.1em] ${key.status === "active" ? "border-teal-300/25 bg-teal-300/10 text-teal-100" : "border-stone-600 bg-stone-800 text-stone-400"}`}
                              >
                                {key.status}
                              </span>
                            </td>
                            <td className="px-3 py-4 text-stone-300">
                              <p>
                                {number(key.requests_today)} /{" "}
                                {number(key.daily_request_limit)} req
                              </p>
                              <p className="mt-1 text-[9px] text-stone-500">
                                {number(key.reported_output_tokens_today)}{" "}
                                reported tok
                              </p>
                            </td>
                            <td className="px-3 py-4 text-stone-300">
                              <p>
                                {key.rpm_limit} rpm · {key.active_limit} active
                              </p>
                              <p className="mt-1 text-[9px] text-stone-500">
                                {number(key.max_output)} tok cap · expires{" "}
                                {when(key.expires_at)}
                              </p>
                            </td>
                            <td className="px-3 py-4 text-stone-400">
                              {when(key.last_seen_at)}
                            </td>
                            <td className="px-5 py-4 text-right">
                              {key.status === "active" ? (
                                <Button
                                  variant="outline"
                                  onClick={() => void revokeKey(key)}
                                  className="h-8 border-red-300/20 bg-red-300/[0.04] px-2 text-[10px] text-red-200 hover:bg-red-300/10"
                                >
                                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />{" "}
                                  Revoke
                                </Button>
                              ) : (
                                <span className="text-stone-600">
                                  {when(key.revoked_at)}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {keys.length === 0 && (
                          <tr>
                            <td
                              colSpan={6}
                              className="mono px-5 py-8 text-center text-xs text-stone-500"
                            >
                              No key metadata exists yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>
            </div>
          )}
          {tab === "activity" && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="panel-label text-orange-200">
                    03 / REQUEST LEDGER
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-[-0.05em]">
                    Recent requests and enforcement results
                  </h1>
                  <p className="mono mt-2 text-xs leading-5 text-stone-500">
                    This ledger stores operational metadata only. It has no
                    prompt body, response content, raw key, or secret hash.
                  </p>
                </div>
                <div className="mono rounded-lg border border-stone-700 bg-stone-900/50 px-3 py-2 text-[10px] text-stone-400">
                  {protectedEvents} recent 429 events
                </div>
              </div>
              <Panel className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] text-left">
                    <thead className="border-b border-stone-800 bg-stone-900/30">
                      <tr className="panel-label">
                        <th className="px-5 py-3 font-medium">When / key</th>
                        <th className="px-3 py-3 font-medium">Result</th>
                        <th className="px-3 py-3 font-medium">Timing</th>
                        <th className="px-3 py-3 font-medium">Output</th>
                        <th className="px-5 py-3 font-medium">Policy detail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-800/80">
                      {events.map((event, index) => (
                        <tr
                          key={`${event.started_at}-${index}`}
                          className="mono text-[11px]"
                        >
                          <td className="px-5 py-4">
                            <p className="text-stone-200">
                              {event.prefix ?? "no accepted key"}
                            </p>
                            <p className="mt-1 text-[9px] text-stone-500">
                              {when(event.started_at)} ·{" "}
                              {event.tenant_id ?? "—"}
                            </p>
                          </td>
                          <td className="px-3 py-4">
                            <span
                              className={`rounded-full border px-2 py-1 text-[9px] ${event.status_code >= 500 ? "border-red-300/25 text-red-200" : event.status_code === 429 ? "border-orange-300/25 text-orange-200" : "border-teal-300/25 text-teal-100"}`}
                            >
                              {event.status_code} · {event.outcome}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-stone-300">
                            <p>TTFT {duration(event.ttft_ms)}</p>
                            <p className="mt-1 text-[9px] text-stone-500">
                              elapsed {duration(event.elapsed_ms)} · start{" "}
                              {duration(event.response_start_ms)}
                            </p>
                          </td>
                          <td className="px-3 py-4 text-stone-300">
                            <p>
                              {event.reported_output === null
                                ? "—"
                                : `${number(event.reported_output)} tok`}
                            </p>
                            <p className="mt-1 text-[9px] text-stone-500">
                              asked {number(event.requested_output)} ·{" "}
                              {event.finish_reason ?? "—"}
                            </p>
                          </td>
                          <td className="px-5 py-4 text-stone-400">
                            {event.error_code ?? "completed"}
                          </td>
                        </tr>
                      ))}
                      {events.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="mono px-5 py-10 text-center text-xs text-stone-500"
                          >
                            No persisted events yet. Send one test request
                            through the gateway to populate this ledger.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
