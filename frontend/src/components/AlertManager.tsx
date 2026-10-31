import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, Plus, Trash2 } from "lucide-react";
import { PromqlHelper } from "./PromqlHelper";
import {
  acknowledgeAlert,
  clearAlertAcknowledgement,
  createAlert,
  deleteAlert,
  fetchAlertEvents,
  listAlerts,
  setAlertEnabled,
  type Alert,
  type AlertComparator,
  type AlertEventEntry,
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
  firing: "bg-[#fb7185]/[0.15] text-[#fda4af]",
  pending: "bg-[#fbbf24]/[0.15] text-[#fcd34d]",
  resolved: "bg-[#5eead4]/[0.15] text-[#7df0dc]",
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
  // Transition history — one alert expanded at a time, loaded on demand.
  const [historyAlertId, setHistoryAlertId] = useState<number | null>(null);
  const [history, setHistory] = useState<AlertEventEntry[] | null>(null);
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

  /** Ack state as the UI shows it: null = not acknowledged (or expired). */
  function ackLabel(alert: Alert): string | null {
    if (alert.acknowledged_at === null) {
      return null;
    }
    if (alert.acknowledged_until === null) {
      return alert.acknowledged_by !== null ? `Acked by ${alert.acknowledged_by}` : "Acked";
    }
    const until = new Date(alert.acknowledged_until);
    if (until.getTime() <= Date.now()) {
      return null;
    }
    const time = until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `Acked until ${time}`;
  }

  async function handleAck(alert: Alert): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await acknowledgeAlert(tenantId, alert.id, 60);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to acknowledge");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnack(alert: Alert): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await clearAlertAcknowledgement(tenantId, alert.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to release the acknowledgement");
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory(alert: Alert): Promise<void> {
    if (historyAlertId === alert.id) {
      setHistoryAlertId(null);
      setHistory(null);
      return;
    }
    setHistoryAlertId(alert.id);
    setHistory(null);
    try {
      const { events } = await fetchAlertEvents(tenantId, alert.id);
      setHistory(events);
    } catch {
      setHistory([]);
    }
  }

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

  const inputClass = "field text-xs";

  return (
    <div className="mt-6" data-testid="alert-manager">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-tight text-white">
          <BellRing className="h-4 w-4 text-[#5eead4]" aria-hidden />
          Alerts
          <span className="text-[11px] font-normal text-[#8d95a8]">
            evaluated every 30s — firing alerts POST their webhook and show here
          </span>
        </h2>
        {!adding ? (
          <button
            type="button"
            data-testid="add-alert-button"
            title="Create a threshold alert — notify a webhook when a query breaches"
            className="btn btn-ghost"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New alert
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="mt-2.5 flex flex-col gap-2.5 rounded-xl border border-white/[0.075] bg-black/30 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Alert name — e.g. “Host down”"
                title="Shown in the alert list and webhook payloads"
                className={inputClass}
              />
              <p className="text-[10px] leading-relaxed text-[#5f6779]">Short, unique per workspace.</p>
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
              <p className="text-[10px] leading-relaxed text-[#5f6779]">Breach condition.</p>
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
              <p className="text-[10px] leading-relaxed text-[#5f6779]">Number (same unit as the query).</p>
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
              <p className="text-[10px] leading-relaxed text-[#5f6779]">Anti-flap hold time.</p>
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
              className="field font-mono text-xs"
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
            <p className="text-[10px] leading-relaxed text-[#5f6779]">
              Slack/Discord/any HTTPS endpoint. Email alerts land with the prod email cycle.
            </p>
          </div>
          {error !== null ? (
            <p className="rounded-lg border border-[#fb7185]/40 bg-[#fb7185]/10 px-3 py-2 text-xs text-[#fda4af]" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              title="Save the alert — the evaluator checks it every 30 seconds"
              className="btn btn-primary px-3 py-1.5"
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
              className="btn btn-ghost px-3 py-1.5"
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
        <p className="mt-2.5 rounded-xl border border-dashed border-white/[0.12] px-4 py-5 text-center text-xs text-[#8d95a8]">
          No alerts yet — e.g. “CPU above 90% for 5m” or “scrape target down”.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.075] bg-white/[0.02] px-3 py-2.5 transition hover:border-white/[0.14]"
              data-testid={`alert-row-${alert.id}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-[#e6e9f0]">{alert.title}</span>
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
                    <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[#8d95a8]">
                      paused
                    </span>
                  ) : null}
                  {ackLabel(alert) !== null ? (
                    <span
                      className="chip chip-signal px-1.5 py-0.5 text-[9px] uppercase tracking-wide"
                      title={
                        alert.acknowledged_by !== null
                          ? `Acknowledged by ${alert.acknowledged_by} — notifications are silenced, evaluation continues`
                          : "Acknowledged — notifications are silenced, evaluation continues"
                      }
                    >
                      {ackLabel(alert)}
                    </span>
                  ) : null}
                </div>
                <p
                  className="mt-0.5 truncate font-mono text-[10px] text-[#5f6779]"
                  title={`${alert.promql} — ${alert.comparator} ${alert.threshold}`}
                >
                  {alert.promql} {alert.comparator} {alert.threshold}
                  {alert.for_seconds > 0 ? ` for ${Math.round(alert.for_seconds / 60)}m` : ""}
                  {alert.last_value !== null ? ` · last ${Number(alert.last_value.toFixed(3))}` : ""}
                  {alert.webhook_url !== null ? " · webhook" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {ackLabel(alert) === null ? (
                  <button
                    type="button"
                    data-testid={`ack-alert-${alert.id}`}
                    title="Acknowledge for 1 hour — silence webhook notifications while the metric is still evaluated and history keeps recording"
                    disabled={busy}
                    className="btn btn-ghost px-2 py-1 text-[11px]"
                    onClick={() => {
                      void handleAck(alert);
                    }}
                  >
                    Ack 1h
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid={`unack-alert-${alert.id}`}
                    title="Release the acknowledgement — the next transition notifies again"
                    disabled={busy}
                    className="btn btn-ghost px-2 py-1 text-[11px] text-[#7df0dc]"
                    onClick={() => {
                      void handleUnack(alert);
                    }}
                  >
                    Unack
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`history-alert-${alert.id}`}
                  title="Show what this alert did over time — every firing and resolved transition"
                  className="btn btn-ghost px-2 py-1 text-[11px]"
                  onClick={() => {
                    void toggleHistory(alert);
                  }}
                >
                  {historyAlertId === alert.id ? "Hide history" : "History"}
                </button>
                <button
                  type="button"
                  title={alert.enabled ? "Pause evaluation (keeps the config)" : "Resume evaluation"}
                  className="btn btn-ghost px-2 py-1 text-[11px]"
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
                  className="rounded-md border border-white/[0.09] p-1 text-[#5f6779] transition hover:border-[#fb7185]/40 hover:bg-[#fb7185]/10 hover:text-[#fb7185]"
                  onClick={() => {
                    void deleteAlert(tenantId, alert.id).then(() => refresh());
                  }}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              </div>
              {historyAlertId === alert.id ? (
                <div
                  className="mt-2 w-full rounded-lg border border-white/[0.075] bg-black/30 px-3 py-2"
                  data-testid={`alert-history-${alert.id}`}
                >
                  <p className="eyebrow mb-1.5">Recent transitions</p>
                  {history === null ? (
                    <p className="text-[11px] text-[#8d95a8]">Loading history…</p>
                  ) : history.length === 0 ? (
                    <p className="text-[11px] text-[#8d95a8]">
                      No transitions recorded yet — this alert has not changed state since
                      history began.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {history.map((event) => (
                        <li
                          key={event.id}
                          className="flex flex-wrap items-center gap-2 text-[11px] text-[#c3cad8]"
                        >
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
                              event.state === "firing"
                                ? "bg-[#fb7185]/15 text-[#fda4af]"
                                : "bg-[#5eead4]/15 text-[#7df0dc]"
                            }`}
                          >
                            {event.state}
                          </span>
                          <span className="font-mono text-[10px] text-[#8d95a8]">
                            {event.value !== null ? Number(event.value.toFixed(3)) : "no data"}{" "}
                            {event.comparator} {event.threshold}
                          </span>
                          {event.acknowledged ? (
                            <span className="text-[10px] text-[#5f6779]">silenced (acked)</span>
                          ) : null}
                          <time
                            dateTime={event.created_at}
                            className="ml-auto font-mono text-[10px] text-[#5f6779]"
                          >
                            {new Date(event.created_at).toLocaleString()}
                          </time>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
