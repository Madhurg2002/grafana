import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import {
  activateConnection,
  connectWithLabel,
  deleteConnection,
  listConnections,
  updateConnection,
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
  const [editing, setEditing] = useState<ConnectionSummary | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editToken, setEditToken] = useState("");
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

  function startEdit(c: ConnectionSummary): void {
    setEditing(c);
    setEditLabel(c.label);
    setEditUrl(""); // blank = keep the current upstream
    setEditToken(""); // blank = keep the current token
    setError(null);
  }

  function resetEdit(): void {
    setEditing(null);
    setEditLabel("");
    setEditUrl("");
    setEditToken("");
  }

  async function handleSaveEdit(): Promise<void> {
    if (editing === null) return;
    setBusy(true);
    setError(null);
    try {
      const urlChanged = editUrl.trim().length > 0;
      const tokenChanged = editToken.length > 0;
      const tokenCleared = editToken.trim() === "-";
      await updateConnection(tenantId, editing.id, {
        ...(editLabel.trim() !== editing.label ? { label: editLabel.trim() } : {}),
        ...(urlChanged ? { prometheusUrl: editUrl.trim() } : {}),
        ...(tokenChanged || tokenCleared ? { authToken: tokenCleared ? "" : editToken } : {}),
      });
      resetEdit();
      await refresh();
      onActiveChanged(editLabel.trim() || editing.label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update connection");
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
        className="btn btn-ghost px-2.5 py-1.5"
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
              active.status === "connected" ? "bg-[#5eead4]" : "bg-[#fb7185]"
            }`}
            aria-hidden
          />
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 text-[#5f6779]" aria-hidden />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Connections"
          data-testid="connection-switcher-modal"
          onClick={() => {
            setOpen(false);
            setAdding(false);
            resetEdit();
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setAdding(false);
              resetEdit();
              setError(null);
            }
          }}
        >
        <div
          className="glass-card flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden bg-[#080a0e] shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-white/[0.075] px-5 py-4">
            <p className="text-[15px] font-semibold tracking-tight text-white">Connections</p>
            <p className="mt-1 text-xs leading-relaxed text-[#8d95a8]">
              Every upstream you've connected. Click one to make it the active
              source for all dashboards, pages, and share links.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {connections.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/[0.12] px-4 py-6 text-center text-xs text-[#8d95a8]">
              No stored connections yet — add your first upstream below.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {connections.map((c) => (
                <li
                  key={c.id}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 transition ${
                    c.isActive
                      ? "border-[#5eead4]/30 bg-[#5eead4]/[0.06]"
                      : "border-white/[0.075] hover:border-white/20 hover:bg-white/[0.04]"
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
                      <Check className="h-4 w-4 shrink-0 text-[#5eead4]" aria-hidden />
                    ) : (
                      <span className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[#e6e9f0]" title={c.label}>
                        {c.label}
                      </span>
                      <span
                        className="mt-0.5 block truncate text-[11px] text-[#8d95a8]"
                        title={`${c.upstreamType === "grafana" ? "Grafana" : "Prometheus"} · ${c.upstreamHost ?? "unknown host"}`}
                      >
                        {c.upstreamType === "grafana" ? "Grafana" : "Prometheus"} · {c.upstreamHost ?? "?"}
                      </span>
                    </span>
                    {c.isActive ? (
                      <span className="chip chip-signal ml-auto shrink-0 px-2 py-0.5 text-[9px] uppercase tracking-[0.1em]">
                        Active
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    aria-label={`Edit connection ${c.label}`}
                    title="Edit this connection — rename it, change the URL, or rotate the token"
                    className="shrink-0 rounded-lg p-1.5 text-[#5f6779] transition hover:bg-white/[0.06] hover:text-white"
                    disabled={busy}
                    onClick={() => {
                      startEdit(c);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete connection ${c.label}`}
                    title="Remove this connection — dashboards fall back to any other stored upstream"
                    className="shrink-0 rounded-lg p-1.5 text-[#5f6779] transition hover:bg-[#fb7185]/10 hover:text-[#fb7185]"
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

          {editing !== null ? (
            <div className="flex flex-col gap-2.5 border-t border-white/[0.075] px-3 pb-3 pt-3">
              <p className="eyebrow text-[#c3cad8]">
                Edit “{editing.label}”
              </p>
              <div>
                <input
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  placeholder="Label"
                  maxLength={64}
                  className="field text-xs"
                />
                <p className="mt-0.5 text-[10px] leading-relaxed text-[#5f6779]">
                  A short name shown in this dropdown.
                </p>
              </div>
              <div>
                <input
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  type="text"
                  inputMode="url"
                  placeholder="New URL — leave blank to keep current"
                  className="field text-xs"
                />
                <p className="mt-0.5 text-[10px] leading-relaxed text-[#5f6779]">
                  Currently {editing.upstreamHost ?? "?"}. Changing it is probed
                  before saving — the old upstream stays if the new one is unreachable.
                </p>
              </div>
              <div>
                <input
                  value={editToken}
                  onChange={(e) => setEditToken(e.target.value)}
                  type="password"
                  placeholder="New token — blank keeps, “-” clears"
                  autoComplete="off"
                  className="field text-xs"
                />
                <p className="mt-0.5 text-[10px] leading-relaxed text-[#5f6779]">
                  {editing.hasToken
                    ? "A token is stored (encrypted). Leave blank to keep it, type - to remove it."
                    : "No token stored. Leave blank, or paste a bearer token."}
                </p>
              </div>
              {error !== null ? (
                <p className="text-[11px] text-[#fda4af]" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  title="Save changes to this connection"
                  className="btn btn-primary flex-1"
                  disabled={busy || editLabel.trim().length === 0}
                  onClick={() => {
                    void handleSaveEdit();
                  }}
                >
                  {busy ? "Saving…" : "Save changes"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    resetEdit();
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : adding ? (
            <div className="flex flex-col gap-2.5 border-t border-white/[0.075] px-3 pb-3 pt-3">
              <div>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Label (e.g. prod, staging)"
                  className="field text-xs"
                />
                <p className="mt-0.5 text-[10px] leading-relaxed text-[#5f6779]">
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
                  className="field text-xs"
                />
                <p className="mt-0.5 text-[10px] leading-relaxed text-[#5f6779]">
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
                  className="field text-xs"
                />
                <p className="mt-0.5 text-[10px] leading-relaxed text-[#5f6779]">
                  Only if your upstream needs a bearer token. Stored AES-256-GCM encrypted, never displayed again.
                </p>
              </div>
              {error !== null ? (
                <p className="text-[11px] text-[#fda4af]" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  title="Verify the endpoint, save it encrypted, and make it the active source"
                  className="btn btn-primary flex-1"
                  disabled={busy || url.trim().length === 0}
                  onClick={() => {
                    void handleAdd();
                  }}
                >
                  {busy ? "Connecting…" : "Save & switch"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
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
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/[0.14] px-3 py-2.5 text-xs font-medium text-[#c3cad8] transition hover:border-[#5eead4]/40 hover:text-[#7df0dc]"
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
