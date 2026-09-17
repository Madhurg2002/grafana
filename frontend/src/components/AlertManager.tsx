import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, Plus, Trash2 } from "lucide-react";
import { PromqlHelper } from "./PromqlHelper";
import {
  createAlert,
  deleteAlert,
  listAlerts,
  setAlertEnabled,
  type Alert,
  type AlertComparator,
} from "../lib/api";

interface Props {
  tenantId: string;
}

const COMPARATORS: Array<{ value: AlertComparator; label: string }> = [
  { value: ">", label: "> above" },
  { value: "<", label: "< below" },
  { value: ">=", label: "≥ at/above" },
  { value: "<=", label: "≤ at/below" },
];

const FOR_OPTIONS = [
  { seconds: 0, label: "immediately" },
  { seconds: 60, label: "for 1m" },
  { seconds: 300, label: "for 5m" },
  { seconds: 900, label: "for 15m" },
];

const stateStyle: Record<Alert["state"], string> = {
  firing: "bg-rose-500/15 text-rose-300",
  pending: "bg-amber-500/15 text-amber-300",
  resolved: "bg-emerald-500/15 text-emerald-300",
};

/**
 * Threshold-alert manager: create a PromQL expression + comparator +
 * threshold (+ "hold for" + optional webhook), see live firing state,
 * pause/resume, delete. The evaluator runs server-side every 30s.
 */
export function AlertManager({ tenantId }: Props): JSX.Element | null {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [promql, setPromql] = useState("");
  const [comparator, setComparator] = useState<AlertComparator>(">");
  const [threshold, setThreshold] = useState("");
  const [forSeconds, setForSeconds] = useState(0);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promqlInputRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestRef = useRef<(() => void) | null>(null);
  const suggestKeyDownRef = useRef<((e: React.KeyboardEvent<HTMLTextAreaElement>) => void) | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const payload = await listAlerts(tenantId);
      setAlerts(payload.alerts ?? []);
    } catch {
      // Signed out / unreachable — keep the last known list.
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function handleCreate(): Promise<void> {
    const parsedThreshold = Number(threshold);
    if (title.trim().length === 0 || promql.trim().length === 0 || Number.isNaN(parsedThreshold)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createAlert(tenantId, {
        title: title.trim(),
        promql: promql.trim(),
        comparator,
        threshold: parsedThreshold,
        forSeconds: forSeconds > 0 ? forSeconds : undefined,
        webhookUrl: webhookUrl.trim().length > 0 ? webhookUrl.trim() : undefined,
      });
      setTitle("");
      setPromql("");
      setThreshold("");
      setWebhookUrl("");
      setForSeconds(0);
      setAdding(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create alert");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50";

  return (
    <div className="mt-6" data-testid="alert-manager">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <BellRing className="h-4 w-4 text-emerald-300" aria-hidden />
          Alerts
          <span className="text-xs font-normal text-zinc-500">
            evaluated every 30s — firing alerts POST their webhook and show here
          </span>
        </h2>
        {!adding ? (
          <button
            type="button"
            data-testid="add-alert-button"
            title="Create a threshold alert — notify a webhook when a query breaches"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-emerald-500/40 hover:text-emerald-300"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New alert
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="mt-2 flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Alert name — e.g. “Host down”"
                title="Shown in the alert list and webhook payloads"
                className={inputClass}
              />
              <p className="text-[10px] text-zinc-600">Short, unique per workspace.</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <select
                value={comparator}
                onChange={(e) => setComparator(e.target.value as AlertComparator)}
                title="Fire when the query result is above/below the threshold"
                aria-label="Comparator"
                className={inputClass}
              >
                {COMPARATORS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-zinc-600">Breach condition.</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <input
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="Threshold — e.g. 90"
                title="The value the query result is compared against"
                inputMode="decimal"
                className={inputClass}
              />
              <p className="text-[10px] text-zinc-600">Number (same unit as the query).</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <select
                value={forSeconds}
                onChange={(e) => setForSeconds(Number(e.target.value))}
                title="The breach must hold this long before the alert fires"
                aria-label="Hold duration"
                className={inputClass}
              >
                {FOR_OPTIONS.map((o) => (
                  <option key={o.seconds} value={o.seconds}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-zinc-600">Anti-flap hold time.</p>
            </div>
          </div>
          <div>
            <textarea
              ref={promqlInputRef}
              value={promql}
              onChange={(e) => setPromql(e.target.value)}
              onKeyUp={() => suggestRef.current?.()}
              onClick={() => suggestRef.current?.()}
              onKeyDown={(e) => suggestKeyDownRef.current?.(e)}
              placeholder='PromQL — e.g. 100 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100'
              title="Any single-value PromQL expression — the backend normalizer still applies"
              rows={2}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
            />
            <div className="mt-1 flex items-center gap-3">
              <PromqlHelper
                tenantId={tenantId}
                value={promql}
                onChange={setPromql}
                inputRef={promqlInputRef}
                registerTrigger={(fn) => {
                  suggestRef.current = fn;
                }}
                registerKeyDown={(fn) => {
                  suggestKeyDownRef.current = fn;
                }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-0.5 sm:w-1/2">
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="Webhook URL (optional) — e.g. https://hooks.slack.com/…"
              title="POSTs a JSON notification when the alert fires/resolves — leave empty for UI-only"
              inputMode="url"
              className={inputClass}
            />
            <p className="text-[10px] text-zinc-600">
              Slack/Discord/any HTTPS endpoint. Email alerts land with the prod email cycle.
            </p>
          </div>
          {error !== null ? (
            <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              title="Save the alert — the evaluator checks it every 30 seconds"
              className="rounded-lg bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
              disabled={
                busy ||
                title.trim().length === 0 ||
                promql.trim().length === 0 ||
                threshold.trim().length === 0 ||
                Number.isNaN(Number(threshold))
              }
              onClick={() => {
                void handleCreate();
              }}
            >
              {busy ? "Saving…" : "Create alert"}
            </button>
            <button
              type="button"
              title="Discard this alert"
              className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {alerts.length === 0 && !adding ? (
        <p className="mt-2 rounded-xl border border-dashed border-zinc-800 px-4 py-4 text-center text-xs text-zinc-500">
          No alerts yet — e.g. “CPU above 90% for 5m” or “scrape target down”.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/80 px-3 py-2"
              data-testid={`alert-row-${alert.id}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-zinc-200">{alert.title}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${stateStyle[alert.state]}`}
                    title={
                      alert.state === "firing"
                        ? `Firing since ${alert.firing_time ?? "—"}`
                        : alert.state === "pending"
                          ? "Breach observed — waiting for the hold time"
                          : "Within threshold"
                    }
                  >
                    {alert.state}
                  </span>
                  {!alert.enabled ? (
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-zinc-400">
                      paused
                    </span>
                  ) : null}
                </div>
                <p
                  className="mt-0.5 truncate font-mono text-[10px] text-zinc-500"
                  title={`${alert.promql} — ${alert.comparator} ${alert.threshold}`}
                >
                  {alert.promql} {alert.comparator} {alert.threshold}
                  {alert.for_seconds > 0 ? ` for ${Math.round(alert.for_seconds / 60)}m` : ""}
                  {alert.last_value !== null ? ` · last ${Number(alert.last_value.toFixed(3))}` : ""}
                  {alert.webhook_url !== null ? " · webhook" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  title={alert.enabled ? "Pause evaluation (keeps the config)" : "Resume evaluation"}
                  className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
                  onClick={() => {
                    void setAlertEnabled(tenantId, alert.id, !alert.enabled).then(() => refresh());
                  }}
                >
                  {alert.enabled ? "Pause" : "Resume"}
                </button>
                <button
                  type="button"
                  title="Delete this alert"
                  aria-label={`Delete alert ${alert.title}`}
                  className="rounded-md border border-zinc-800 p-1 text-zinc-500 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300"
                  onClick={() => {
                    void deleteAlert(tenantId, alert.id).then(() => refresh());
                  }}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
