import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, LayoutDashboard, Plus, Table2, Trash2 } from "lucide-react";
import { GaugeCard } from "./GaugeCard";
import { SparkLineCard } from "./SparkLineCard";
import { StatusCard } from "./StatusCard";
import { PromqlHelper } from "./PromqlHelper";
import { MetricBrowser } from "./MetricBrowser";
import {
  createPage,
  createPanel,
  deletePage,
  deletePanel,
  listPages,
  listPanels,
  reorderPanel,
  type DashboardPage,
  type DashboardPanel,
  type PanelKind,
} from "../lib/api";
import { useInstantMetric, useRangeMetric } from "../hooks/useDashboard";

const PALETTE = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#38bdf8"];

interface Props {
  tenantId: string;
}

/** Per-user grid density, persisted in localStorage (not per view). */
const DENSITY_KEY = "pt_grid_density";
type Density = "auto" | "1" | "2" | "3";
const DENSITY_OPTIONS: Array<{ key: Density; label: string; title: string }> = [
  { key: "auto", label: "Auto", title: "Adapts to your screen width" },
  { key: "1", label: "1", title: "One column" },
  { key: "2", label: "2", title: "Two columns" },
  { key: "3", label: "3", title: "Three columns (large screens)" },
];

function loadDensity(): Density {
  try {
    const raw = localStorage.getItem(DENSITY_KEY);
    if (raw === "1" || raw === "2" || raw === "3" || raw === "auto") {
      return raw;
    }
  } catch {
    // Storage unavailable — default.
  }
  return "auto";
}

/** Maps the density preference to responsive Tailwind classes. */
function gridClass(density: Density): string {
  if (density === "1") return "grid-cols-1";
  if (density === "2") return "grid-cols-1 md:grid-cols-2";
  if (density === "3") return "grid-cols-1 md:grid-cols-2 2xl:grid-cols-3";
  return "grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3";
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
        query={panel.promql}
      />
    );
  }
  if (panel.kind === "gauge") {
    const value = firstScalar(instant.data) ?? 0;
    return (
      <GaugeCard
        title={panel.title}
        percent={clamp(value)}
        level={levelFor(value)}
        query={panel.promql}
      />
    );
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
 * "Views" à la Grafana: titled PromQL panels organized into PAGES (Home +
 * user-created pages). Each page is an ordered group; panels persist
 * server-side and render live. Grid density is a per-user preference.
 */
export function CustomPanels({ tenantId }: Props): JSX.Element | null {
  const promqlRef = useRef<HTMLTextAreaElement | null>(null);
  const [pages, setPages] = useState<DashboardPage[]>([]);
  const [activePageId, setActivePageId] = useState<number | null>(null);
  const [newPageName, setNewPageName] = useState("");
  const [addingPage, setAddingPage] = useState(false);
  const [panels, setPanels] = useState<DashboardPanel[]>([]);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [density, setDensity] = useState<Density>(loadDensity);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [promql, setPromql] = useState("");
  const [kind, setKind] = useState<PanelKind>("sparkline");
  const [unit, setUnit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0] ?? null;

  // Pages load first (auto-provisioning "Home" server-side on first read).
  useEffect(() => {
    let cancelled = false;
    async function loadPages(): Promise<void> {
      try {
        const payload = await listPages(tenantId);
        if (!cancelled) {
          setPages([...payload.pages].sort((a, b) => a.position - b.position));
          setActivePageId((current) => current ?? payload.pages[0]?.id ?? null);
        }
      } catch {
        // Signed-out users have no persisted pages — section hides.
      }
    }
    void loadPages();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const payload = (await listPanels(tenantId, activePage?.id)) as {
        panels?: DashboardPanel[];
      };
      setPanels([...(payload.panels ?? [])].sort((a, b) => a.position - b.position));
    } catch {
      // Signed-out users have no persisted panels — section simply hides.
    }
  }, [tenantId, activePage?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function saveDensity(next: Density): void {
    setDensity(next);
    try {
      localStorage.setItem(DENSITY_KEY, next);
    } catch {
      // Storage unavailable — preference lives for the session.
    }
  }

  async function handleAddPage(): Promise<void> {
    const name = newPageName.trim();
    if (name.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { page } = await createPage(tenantId, name);
      setPages((prev) => [...prev, page]);
      setActivePageId(page.id);
      setNewPageName("");
      setAddingPage(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create page");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePage(page: DashboardPage): Promise<void> {
    if (pages.length <= 1) {
      setError("The last page cannot be deleted");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deletePage(tenantId, page.id);
      const remaining = pages.filter((p) => p.id !== page.id);
      setPages(remaining);
      if (activePageId === page.id) {
        setActivePageId(remaining[0]?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete page");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await createPanel(tenantId, {
        title: title.trim(),
        promql: promql.trim(),
        kind,
        ...(unit.trim().length > 0 ? { unit: unit.trim() } : {}),
        ...(activePage !== null ? { pageId: activePage.id } : {}),
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

  /** Reorder locally, then persist the new positions server-side. */
  async function handleReorder(from: number, to: number): Promise<void> {
    if (from === to) {
      return;
    }
    const next = [...panels];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) {
      return;
    }
    next.splice(to, 0, moved);
    setPanels(next);
    try {
      await Promise.all(
        next.map((panel, position) => reorderPanel(tenantId, panel.id, position))
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save order");
      await refresh();
    }
  }

  const section = (
    <section className="mx-auto mt-8 max-w-6xl px-4 sm:px-6" data-testid="custom-panels">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <LayoutDashboard className="mr-1 h-4 w-4 text-emerald-300" aria-hidden />
          {pages.map((page) => (
            <span key={page.id} className="group/page relative inline-flex items-center">
              <button
                type="button"
                data-testid={`page-tab-${page.name.toLowerCase()}`}
                title={page.name === "Home" ? "Home — your default view" : `Page: ${page.name}`}
                onClick={() => setActivePageId(page.id)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  page.id === activePage?.id
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                {page.name}
              </button>
              {page.name !== "Home" && pages.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Delete page ${page.name}`}
                  title="Delete this page (its panels go with it)"
                  className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-zinc-800 p-0.5 text-zinc-400 group-hover/page:block hover:bg-rose-500/20 hover:text-rose-300"
                  onClick={() => {
                    void handleDeletePage(page);
                  }}
                >
                  <Trash2 className="h-2.5 w-2.5" aria-hidden />
                </button>
              ) : null}
            </span>
          ))}
          {addingPage ? (
            <span className="inline-flex items-center gap-1">
              <input
                autoFocus
                value={newPageName}
                onChange={(e) => setNewPageName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAddPage();
                  if (e.key === "Escape") setAddingPage(false);
                }}
                placeholder="Page name"
                maxLength={64}
                className="w-28 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
              />
              <button
                type="button"
                aria-label="Create page"
                className="rounded-lg bg-emerald-500/90 px-2 py-1 text-xs font-semibold text-zinc-950 disabled:opacity-50"
                disabled={busy || newPageName.trim().length === 0}
                onClick={() => {
                  void handleAddPage();
                }}
              >
                +
              </button>
              <button
                type="button"
                aria-label="Cancel page creation"
                className="text-zinc-500 hover:text-zinc-300"
                onClick={() => setAddingPage(false)}
              >
                ×
              </button>
            </span>
          ) : (
            <button
              type="button"
              data-testid="add-page-button"
              title="New page — group panels into prespecified views"
              className="flex items-center gap-1 rounded-lg border border-zinc-800 px-2 py-1 text-xs text-zinc-500 transition hover:border-emerald-500/40 hover:text-emerald-300"
              onClick={() => setAddingPage(true)}
            >
              <Plus className="h-3 w-3" aria-hidden />
              Page
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Per-user grid density — stored per user in localStorage. */}
          <div
            className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5"
            role="group"
            aria-label="Grid density"
            data-testid="density-control"
          >
            {DENSITY_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                title={option.title}
                onClick={() => saveDensity(option.key)}
                className={`rounded px-1.5 py-0.5 text-[11px] transition ${
                  density === option.key
                    ? "bg-zinc-800 text-emerald-300"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
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
      </div>

      {panels.length === 0 && !adding ? (
        <p className="mt-2 text-xs text-zinc-600">
          Build your own Grafana-style views: name a panel, give it any PromQL
          (safety-normalized server-side), and it renders live below. Add pages
          to group related panels.
        </p>
      ) : null}
      {error !== null ? (
        <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300" role="alert">
          {error}
        </p>
      ) : null}

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
            <div className="mt-1 flex items-center gap-3">
              <PromqlHelper tenantId={tenantId} value={promql} onChange={setPromql} />
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-zinc-500 transition hover:text-emerald-300"
                onClick={() => setBrowserOpen(true)}
              >
                <Table2 className="h-3 w-3" aria-hidden />
                Browse metrics
              </button>
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
              {busy ? "Saving…" : `Save to ${activePage?.name ?? "Home"}`}
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

      <div className={`mt-3 grid gap-4 ${gridClass(density)}`} data-testid="panel-grid">
        {panels.map((panel, index) => (
          <div
            key={panel.id}
            className={`group relative transition-opacity ${
              dragIndex === index ? "opacity-40" : ""
            }`}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) {
                void handleReorder(dragIndex, index);
              }
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
          >
            <span
              className="absolute -left-1 top-2 cursor-grab rounded p-0.5 text-zinc-700 opacity-0 transition group-hover:opacity-100 active:cursor-grabbing"
              aria-hidden
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
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

      {browserOpen ? (
        <MetricBrowser
          tenantId={tenantId}
          onInsert={(promql) => {
            setPromql(promql);
            setBrowserOpen(false);
            setAdding(true);
          }}
          onClose={() => setBrowserOpen(false)}
        />
      ) : null}
    </section>
  );

  // Nothing to show for signed-out users (no pages and no panels).
  if (pages.length === 0 && panels.length === 0 && !adding) {
    return null;
  }
  return section;
}
