import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Plus, Trash2 } from "lucide-react";
import {
  activateConnection,
  connectWithLabel,
  deleteConnection,
  listConnections,
  type ConnectionSummary,
} from "../lib/api";

interface Props {
  tenantId: string;
  /** Notifies the parent when the ACTIVE connection changes (dashboard must refetch). */
  onActiveChanged: (label: string) => void;
}

/**
 * Header dropdown listing every stored upstream URI for the tenant. Lets the
 * user add a new Prometheus/Grafana URI, switch the active one, or delete.
 */
export function ConnectionSwitcher({ tenantId, onActiveChanged }: Props): JSX.Element {
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const payload = (await listConnections(tenantId)) as { connections?: ConnectionSummary[] };
      setConnections(payload.connections ?? []);
    } catch {
      // Non-fatal — the switcher simply shows nothing until it can list.
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = connections.find((c) => c.isActive) ?? null;

  async function handleAdd(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await connectWithLabel(tenantId, url, {
        authToken: token.length > 0 ? token : undefined,
        label: label.length > 0 ? label : undefined,
      });
      setAdding(false);
      setUrl("");
      setToken("");
      setLabel("");
      await refresh();
      onActiveChanged(label.length > 0 ? label : "default");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate(id: number, switchLabel: string): Promise<void> {
    setBusy(true);
    try {
      await activateConnection(tenantId, id);
      await refresh();
      onActiveChanged(switchLabel);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: number): Promise<void> {
    setBusy(true);
    try {
      await deleteConnection(tenantId, id);
      await refresh();
      onActiveChanged(active?.label ?? "default");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" data-testid="connection-switcher">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-600"
        aria-expanded={open}
      >
        <span
          className="max-w-40 truncate"
          title={
            active === null
              ? "No connection"
              : `${active.label} — ${active.upstreamType} · ${active.upstreamHost ?? ""}`
          }
        >
          {active === null ? "No connection" : active.label}
        </span>
        {active !== null ? (
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              active.status === "connected" ? "bg-emerald-400" : "bg-rose-400"
            }`}
            aria-hidden
          />
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Connections"
          data-testid="connection-switcher-modal"
          onClick={() => {
            setOpen(false);
            setAdding(false);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setAdding(false);
              setError(null);
            }
          }}
        >
        <div
          className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-zinc-800 px-5 py-4">
            <p className="text-sm font-semibold text-zinc-100">Connections</p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              Every upstream you've connected. Click one to make it the active
              source for all dashboards, pages, and share links.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {connections.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
              No stored connections yet — add your first upstream below.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {connections.map((c) => (
                <li
                  key={c.id}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 transition ${
                    c.isActive
                      ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                      : "border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/60"
                  }`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    disabled={busy}
                    title={c.isActive ? "Active source — click to reconnect" : "Make this the active source"}
                    onClick={() => {
                      void handleActivate(c.id, c.label);
                      setOpen(false);
                    }}
                  >
                    {c.isActive ? (
                      <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                    ) : (
                      <span className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-100" title={c.label}>
                        {c.label}
                      </span>
                      <span
                        className="mt-0.5 block truncate text-[11px] text-zinc-500"
                        title={`${c.upstreamType === "grafana" ? "Grafana" : "Prometheus"} · ${c.upstreamHost ?? "unknown host"}`}
                      >
                        {c.upstreamType === "grafana" ? "Grafana" : "Prometheus"} · {c.upstreamHost ?? "?"}
                      </span>
                    </span>
                    {c.isActive ? (
                      <span className="ml-auto shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                        Active
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete connection ${c.label}`}
                    title="Remove this connection — dashboards fall back to any other stored upstream"
                    className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-400"
                    disabled={busy}
                    onClick={() => {
                      void handleDelete(c.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          </div>

          {adding ? (
            <div className="flex flex-col gap-2.5 border-t border-zinc-800 px-1 pt-3">
              <div>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Label (e.g. prod, staging)"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
                />
                <p className="mt-0.5 text-[10px] text-zinc-600">
                  A short name shown in this dropdown — optional.
                </p>
              </div>
              <div>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  type="text"
                  inputMode="url"
                  placeholder="10.0.0.5:9090 or https://prom.example.com"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
                />
                <p className="mt-0.5 text-[10px] text-zinc-600">
                  Prometheus or Grafana base URL — plain <span className="font-mono">ip:port</span> or a
                  full https URL. We detect the type and resolve Grafana to its Prometheus datasource.
                </p>
              </div>
              <div>
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  type="password"
                  placeholder="Auth token (optional, encrypted)"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
                />
                <p className="mt-0.5 text-[10px] text-zinc-600">
                  Only if your upstream needs a bearer token. Stored AES-256-GCM encrypted, never displayed again.
                </p>
              </div>
              {error !== null ? (
                <p className="text-[11px] text-rose-400" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  title="Verify the endpoint, save it encrypted, and make it the active source"
                  className="flex-1 rounded-lg bg-emerald-500/90 px-2 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
                  disabled={busy || url.trim().length === 0}
                  onClick={() => {
                    void handleAdd();
                  }}
                >
                  {busy ? "Connecting…" : "Save & switch"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-800 px-2 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600"
                  onClick={() => {
                    setAdding(false);
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              title="Store another Prometheus or Grafana endpoint — switch between them anytime"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-700 px-3 py-2.5 text-xs font-medium text-zinc-300 transition hover:border-emerald-500/40 hover:text-emerald-300"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add connection
            </button>
          )}
        </div>
        </div>
      ) : null}

    </div>
  );
}
