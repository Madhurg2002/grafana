import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutDashboard, Plus, Trash2 } from "lucide-react";
import { GaugeCard } from "./GaugeCard";
import { SparkLineCard } from "./SparkLineCard";
import { StatusCard } from "./StatusCard";
import { PromqlHelper } from "./PromqlHelper";
import { useInstantMetric, useRangeMetric } from "../hooks/useDashboard";
import {
  createPanel,
  deletePanel,
  listPanels,
  type DashboardPanel,
  type PanelKind,
} from "../lib/api";

const PALETTE = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#38bdf8"];

interface Props {
  tenantId: string;
}

/** One live panel: polls its own PromQL instant/range query. */
function LivePanel({ panel, index }: { panel: DashboardPanel; index: number }): JSX.Element {
  const stroke = PALETTE[index % PALETTE.length];
  // Gauge + stat read a scalar instant; sparkline wants a range window.
  const instant = useInstantMetric(panel.tenant_id, panel.promql);
  const range = useRangeMetric(panel.tenant_id, panel.promql);

  if (panel.kind === "sparkline") {
    return (
      <SparkLineCard
        title={panel.title}
        unit={panel.unit ?? ""}
        series={range.series}
        stroke={stroke}
      />
    );
  }
  if (panel.kind === "gauge") {
    const value = firstScalar(instant.data) ?? 0;
    return <GaugeCard title={panel.title} percent={clamp(value)} level={levelFor(value)} />;
  }
  const stat = firstScalar(instant.data);
  return (
    <StatusCard
      title={panel.title}
      value={stat === null ? "—" : formatValue(stat)}
      unit={panel.unit ?? ""}
      level="emerald"
      icon={LayoutDashboard}
      subtitle={panel.promql.length > 40 ? `${panel.promql.slice(0, 40)}…` : panel.promql}
    />
  );
}

function firstScalar(data: { result: unknown[] } | null): number | null {
  if (data === null || data.result.length === 0) {
    return null;
  }
  const first = data.result[0] as { value?: { value: number } };
  return first.value?.value ?? null;
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function levelFor(percent: number): "emerald" | "amber" | "rose" {
  if (percent >= 90) return "rose";
  if (percent >= 75) return "amber";
  return "emerald";
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * "Views" à la Grafana: the user defines titled PromQL panels that persist
 * server-side and render here alongside (below) the built-in dashboard cards.
 */
export function CustomPanels({ tenantId }: Props): JSX.Element | null {
  const promqlRef = useRef<HTMLTextAreaElement | null>(null);
  const [panels, setPanels] = useState<DashboardPanel[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [promql, setPromql] = useState("");
  const [kind, setKind] = useState<PanelKind>("sparkline");
  const [unit, setUnit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const payload = (await listPanels(tenantId)) as { panels?: DashboardPanel[] };
      setPanels(payload.panels ?? []);
    } catch {
      // Signed-out users have no persisted panels — section simply hides.
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await createPanel(tenantId, {
        title: title.trim(),
        promql: promql.trim(),
        kind,
        ...(unit.trim().length > 0 ? { unit: unit.trim() } : {}),
      });
      setTitle("");
      setPromql("");
      setUnit("");
      setKind("sparkline");
      setAdding(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create panel");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: number): Promise<void> {
    setBusy(true);
    try {
      await deletePanel(tenantId, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete panel");
    } finally {
      setBusy(false);
    }
  }

  if (panels.length === 0 && !adding) {
    return (
      <section className="mx-auto mt-8 max-w-6xl px-4 sm:px-6">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
            <LayoutDashboard className="h-4 w-4 text-emerald-300" aria-hidden />
            Custom views
          </h2>
          <button
            type="button"
            data-testid="add-panel-button"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-emerald-500/40 hover:text-emerald-300"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New panel
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          Build your own Grafana-style views: name a panel, give it any PromQL
          (safety-normalized server-side), and it renders live below.
        </p>
        {error !== null ? (
          <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="mx-auto mt-8 max-w-6xl px-4 sm:px-6" data-testid="custom-panels">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
          <LayoutDashboard className="h-4 w-4 text-emerald-300" aria-hidden />
          Custom views
        </h2>
        {adding ? null : (
          <button
            type="button"
            data-testid="add-panel-button"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-emerald-500/40 hover:text-emerald-300"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New panel
          </button>
        )}
      </div>

      {adding ? (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Panel title"
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as PanelKind)}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500/50"
              aria-label="Panel type"
            >
              <option value="sparkline">Sparkline (range)</option>
              <option value="gauge">Gauge (0–100%)</option>
              <option value="stat">Stat (single value)</option>
            </select>
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="Unit (optional, e.g. bytes/s)"
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
            />
          </div>
          <div className="relative">
            <textarea
              ref={promqlRef}
              value={promql}
              onChange={(e) => setPromql(e.target.value)}
              placeholder='PromQL — e.g. rate(node_network_receive_bytes_total{device=~"eth.*|ens.*|eno.*|bond.*"}[5m])'
              rows={2}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
            />
            <div className="mt-1">
              <PromqlHelper tenantId={tenantId} value={promql} onChange={setPromql} />
            </div>
          </div>
          {error !== null ? (
            <p className="text-[11px] text-rose-400" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
              disabled={busy || title.trim().length === 0 || promql.trim().length === 0}
              onClick={() => {
                void handleCreate();
              }}
            >
              {busy ? "Saving…" : "Save panel"}
            </button>
            <button
              type="button"
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

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {panels.map((panel, index) => (
          <div key={panel.id} className="group relative">
            <LivePanel panel={panel} index={index} />
            <button
              type="button"
              aria-label={`Delete panel ${panel.title}`}
              className="absolute right-2 top-2 rounded p-1 text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-400"
              disabled={busy}
              onClick={() => {
                void handleDelete(panel.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
