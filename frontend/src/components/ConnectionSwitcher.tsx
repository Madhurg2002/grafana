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
        <span className="max-w-40 truncate">
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
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-zinc-800 bg-zinc-950 p-3 shadow-2xl">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Connections
          </p>
          {connections.length === 0 ? (
            <p className="mb-2 text-xs text-zinc-500">No stored connections yet.</p>
          ) : (
            <ul className="mb-2 flex flex-col gap-1">
              {connections.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-900"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    disabled={busy}
                    onClick={() => {
                      void handleActivate(c.id, c.label);
                      setOpen(false);
                    }}
                  >
                    {c.isActive ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-zinc-200">{c.label}</span>
                      <span className="block truncate text-[10px] text-zinc-500">
                        {c.upstreamType === "grafana" ? "Grafana" : "Prometheus"} · {c.upstreamHost ?? "?"}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete connection ${c.label}`}
                    className="shrink-0 rounded p-1 text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-400"
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

          {adding ? (
            <div className="flex flex-col gap-2 border-t border-zinc-800 pt-2">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (e.g. prod, staging)"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://prometheus or grafana URL"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
              />
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                type="password"
                placeholder="Auth token (optional, encrypted)"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
              />
              {error !== null ? (
                <p className="text-[11px] text-rose-400" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
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
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-2 py-1.5 text-xs text-zinc-400 transition hover:border-emerald-500/40 hover:text-emerald-300"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add connection
            </button>
          )}
        </div>
      ) : null}

    </div>
  );
}
