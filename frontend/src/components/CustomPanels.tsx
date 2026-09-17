import { useCallback, useEffect, useRef, useState } from "react";
import {
  GripVertical,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Star,
  Table2,
  Trash2,
  Pencil,
} from "lucide-react";
import { GaugeCard } from "./GaugeCard";
import { SparkLineCard } from "./SparkLineCard";
import { StatusCard } from "./StatusCard";
import { PromqlHelper } from "./PromqlHelper";
import { MetricBrowser } from "./MetricBrowser";
import {
  createPage,
  createWidget,
  deletePage,
  deleteWidget,
  listPages,
  listWidgets,
  makePageHome,
  reorderWidgets,
  updatePageSettings,
  updateWidget,
  type DashboardPage,
  type PageWidget,
  type WidgetKind,
} from "../lib/api";
import { useInstantMetric, useRangeMetric } from "../hooks/useDashboard";

const PALETTE = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#38bdf8"];

interface Props {
  tenantId: string;
  /** True when the page should use the wide (Grafana-style) layout. */
  wide?: boolean;
}

const WINDOW_OPTIONS = [
  { minutes: 15, label: "15m" },
  { minutes: 60, label: "1h" },
  { minutes: 6 * 60, label: "6h" },
  { minutes: 24 * 60, label: "24h" },
  { minutes: 7 * 24 * 60, label: "7d" },
];

const REFRESH_OPTIONS = [
  { seconds: 5, label: "5s" },
  { seconds: 15, label: "15s" },
  { seconds: 30, label: "30s" },
  { seconds: 60, label: "1m" },
  { seconds: 300, label: "5m" },
];

/** Maps a widget's grid span to responsive Tailwind classes. */
function spanClass(span: number): string {
  if (span >= 3) return "col-span-1 2xl:col-span-3 xl:col-span-2";
  if (span === 2) return "col-span-1 2xl:col-span-2";
  return "col-span-1";
}

/** Live widget: polls its own instant/range query. */
function LiveWidget({ widget, index }: { widget: PageWidget; index: number }): JSX.Element {
  const stroke = PALETTE[index % PALETTE.length];
  const instant = useInstantMetric(widget.tenant_id, widget.promql);
  const range = useRangeMetric(widget.tenant_id, widget.promql);

  if (widget.kind === "sparkline") {
    return (
      <SparkLineCard
        title={widget.title}
        unit={widget.unit ?? ""}
        series={range.series}
        stroke={stroke}
        query={widget.promql}
      />
    );
  }
  if (widget.kind === "gauge") {
    const value = firstScalar(instant.data) ?? 0;
    return (
      <GaugeCard
        title={widget.title}
        percent={clamp(value)}
        level={levelFor(value)}
        query={widget.promql}
      />
    );
  }
  if (widget.kind === "hosts_table") {
    return <HostsTable tenantId={widget.tenant_id} />;
  }
  const stat = firstScalar(instant.data);
  return (
    <StatusCard
      title={widget.title}
      value={stat === null ? "—" : formatValue(stat)}
      unit={widget.unit ?? ""}
      level="emerald"
      icon={LayoutDashboard}
      subtitle={widget.promql.length > 40 ? `${widget.promql.slice(0, 40)}…` : widget.promql}
    />
  );
}

/** The scrape-target table as a widget (query transparency included). */
function HostsTable({ tenantId }: { tenantId: string }): JSX.Element {
  const hostsUp = useInstantMetric(tenantId, "up");
  return (
    <section className="glass-card p-4" data-testid="hosts-widget">
      <h2 className="mb-2 text-sm font-semibold text-zinc-300">
        Scrape targets
        <span className="ml-2 text-xs font-normal text-zinc-500">
          every endpoint your Prometheus watches — up means it responded to the last scrape
        </span>
      </h2>
      <p
        className="mb-2 truncate font-mono text-[10px] text-zinc-600"
        title="Query powering this table: up"
      >
        <span className="text-zinc-500">query:</span> up
      </p>
      <div className="max-h-64 overflow-auto rounded-lg border border-zinc-800/80">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-zinc-900/95 text-zinc-400">
            <tr>
              <th className="px-4 py-2 font-medium">Instance</th>
              <th className="px-4 py-2 font-medium">Job</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(hostsUp.data?.result ?? []).slice(0, 200).map((entry, i) => {
              const item = entry as {
                metric?: Record<string, string>;
                value?: { value: number };
              };
              const up = item.value?.value ?? 0;
              return (
                <tr
                  key={`${item.metric?.job ?? "?"}/${item.metric?.instance ?? "?"}/${i}`}
                  className="border-t border-zinc-800/60"
                >
                  <td className="max-w-64 truncate px-4 py-2 font-mono text-zinc-200">
                    <span title={item.metric?.instance ?? "unknown"} className="block truncate">
                      {item.metric?.instance ?? "unknown"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-zinc-400">{item.metric?.job ?? "unknown"}</td>
                  <td className="px-4 py-2">
                    <span className={up === 1 ? "text-emerald-300" : "text-rose-300"}>
                      {up === 1 ? "up" : "down"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
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
 * Pages workspace: each page is its OWN full dashboard — the user picks which
 * page is home, edits its name/refresh/window defaults, and composes it from
 * widgets (stat / gauge / sparkline / hosts table) with per-widget grid span
 * and drag-to-reorder. Everything persists server-side.
 */
export function CustomPanels({ tenantId, wide = false }: Props): JSX.Element | null {
  const [pages, setPages] = useState<DashboardPage[]>([]);
  const [activePageId, setActivePageId] = useState<number | null>(null);
  const [newPageName, setNewPageName] = useState("");
  const [addingPage, setAddingPage] = useState(false);
  const [widgets, setWidgets] = useState<PageWidget[]>([]);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingWidget, setEditingWidget] = useState<PageWidget | null>(null);
  const [title, setTitle] = useState("");
  const [promql, setPromql] = useState("");
  const [kind, setKind] = useState<WidgetKind>("sparkline");
  const [unit, setUnit] = useState("");
  const [span, setSpan] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingPage, setRenamingPage] = useState(false);
  const [pageNameDraft, setPageNameDraft] = useState("");
  const refreshTimerRef = useRef<number | null>(null);

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
    if (activePage === null) {
      setWidgets([]);
      return;
    }
    try {
      const payload = await listWidgets(tenantId, activePage.id);
      setWidgets([...(payload.widgets ?? [])].sort((a, b) => a.position - b.position));
    } catch {
      // Unreachable upstream / signed out — keep the last known widgets.
    }
  }, [tenantId, activePage?.id, activePage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Page-level refresh cadence: re-fetch widget queries on the page's timer.
  useEffect(() => {
    if (refreshTimerRef.current !== null) {
      window.clearInterval(refreshTimerRef.current);
    }
    const seconds = activePage?.refresh_seconds ?? 15;
    refreshTimerRef.current = window.setInterval(() => {
      window.dispatchEvent(new CustomEvent("passthrough:refresh"));
    }, Math.max(seconds, 5) * 1000);
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [activePage?.refresh_seconds, activePage]);

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

  async function handleMakeHome(page: DashboardPage): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await makePageHome(tenantId, page.id);
      const payload = await listPages(tenantId);
      setPages([...payload.pages].sort((a, b) => a.position - b.position));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set home page");
    } finally {
      setBusy(false);
    }
  }

  async function handleRenamePage(): Promise<void> {
    if (activePage === null) return;
    const name = pageNameDraft.trim();
    if (name.length === 0) return;
    setBusy(true);
    try {
      const { renamePage } = await import("../lib/api");
      await renamePage(tenantId, activePage.id, name);
      const payload = await listPages(tenantId);
      setPages([...payload.pages].sort((a, b) => a.position - b.position));
      setRenamingPage(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename page");
    } finally {
      setBusy(false);
    }
  }

  async function handlePageSetting(patch: { refreshSeconds?: number; windowMinutes?: number }): Promise<void> {
    if (activePage === null) return;
    setBusy(true);
    setError(null);
    try {
      await updatePageSettings(tenantId, activePage.id, patch);
      const payload = await listPages(tenantId);
      setPages([...payload.pages].sort((a, b) => a.position - b.position));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update page settings");
    } finally {
      setBusy(false);
    }
  }

  function resetForm(): void {
    setTitle("");
    setPromql("");
    setUnit("");
    setKind("sparkline");
    setSpan(1);
    setEditingWidget(null);
  }

  async function handleCreate(): Promise<void> {
    if (activePage === null) return;
    setBusy(true);
    setError(null);
    try {
      await createWidget(tenantId, activePage.id, {
        kind,
        title: title.trim(),
        promql: kind === "hosts_table" ? undefined : promql.trim(),
        unit: unit.trim().length > 0 ? unit.trim() : undefined,
        span,
      });
      resetForm();
      setAdding(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create widget");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit(): Promise<void> {
    if (editingWidget === null) return;
    setBusy(true);
    setError(null);
    try {
      await updateWidget(tenantId, editingWidget.id, {
        title: title.trim(),
        ...(editingWidget.kind !== "hosts_table" ? { promql: promql.trim() } : {}),
        unit: unit.trim().length > 0 ? unit.trim() : null,
        span,
      });
      resetForm();
      setAdding(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update widget");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: number): Promise<void> {
    setBusy(true);
    try {
      await deleteWidget(tenantId, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete widget");
    } finally {
      setBusy(false);
    }
  }

  async function handleReorder(from: number, to: number): Promise<void> {
    if (from === to || activePage === null) {
      return;
    }
    const next = [...widgets];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) {
      return;
    }
    next.splice(to, 0, moved);
    setWidgets(next);
    try {
      await reorderWidgets(
        tenantId,
        activePage.id,
        next.map((w, position) => ({ id: w.id, position }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save order");
      await refresh();
    }
  }

  function startEdit(widget: PageWidget): void {
    setEditingWidget(widget);
    setTitle(widget.title);
    setPromql(widget.promql);
    setUnit(widget.unit ?? "");
    setKind(widget.kind);
    setSpan(widget.span);
    setAdding(true);
  }

  const containerClass = wide
    ? "mx-auto w-full max-w-[1800px] px-4 sm:px-8"
    : "mx-auto w-full max-w-6xl px-4 sm:px-6";

  return (
    <section className={`${containerClass} mt-6`} data-testid="custom-panels">
      {/* Page tabs — each page is an independently editable dashboard. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <LayoutDashboard className="mr-1 h-4 w-4 text-emerald-300" aria-hidden />
          {pages.map((page) => (
            <span key={page.id} className="group/page relative inline-flex items-center">
              <button
                type="button"
                data-testid={`page-tab-${page.name.toLowerCase()}`}
                title={
                  page.is_home === true
                    ? `${page.name} — home page`
                    : `Page: ${page.name}`
                }
                onClick={() => setActivePageId(page.id)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  page.id === activePage?.id
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                {page.is_home === true ? (
                  <Star className="h-3 w-3 fill-emerald-300 text-emerald-300" aria-hidden />
                ) : null}
                {page.name}
              </button>
              {pages.length > 1 ? (
                <span className="absolute -right-1.5 -top-1.5 hidden group-hover/page:flex">
                  {page.is_home !== true ? (
                    <button
                      type="button"
                      aria-label={`Make ${page.name} the home page`}
                      title="Make this the home page (what opens first)"
                      className="rounded-full bg-zinc-800 p-0.5 text-zinc-400 hover:bg-amber-500/20 hover:text-amber-300"
                      onClick={() => {
                        void handleMakeHome(page);
                      }}
                    >
                      <Star className="h-2.5 w-2.5" aria-hidden />
                    </button>
                  ) : null}
                  {page.is_home !== true ? (
                    <button
                      type="button"
                      aria-label={`Delete page ${page.name}`}
                      title="Delete this page (its widgets go with it)"
                      className="ml-0.5 rounded-full bg-zinc-800 p-0.5 text-zinc-400 hover:bg-rose-500/20 hover:text-rose-300"
                      onClick={() => {
                        void handleDeletePage(page);
                      }}
                    >
                      <Trash2 className="h-2.5 w-2.5" aria-hidden />
                    </button>
                  ) : null}
                </span>
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
              title="New page — a whole separate dashboard you can compose freely"
              className="flex items-center gap-1 rounded-lg border border-zinc-800 px-2 py-1 text-xs text-zinc-500 transition hover:border-emerald-500/40 hover:text-emerald-300"
              onClick={() => setAddingPage(true)}
            >
              <Plus className="h-3 w-3" aria-hidden />
              Page
            </button>
          )}
        </div>

        {/* Page controls: rename, refresh cadence, window, add widget. */}
        {activePage !== null ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="page-controls">
            {renamingPage ? (
              <span className="inline-flex items-center gap-1">
                <input
                  autoFocus
                  value={pageNameDraft}
                  onChange={(e) => setPageNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleRenamePage();
                    if (e.key === "Escape") setRenamingPage(false);
                  }}
                  maxLength={64}
                  className="w-28 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-emerald-500/50"
                />
                <button
                  type="button"
                  aria-label="Save page name"
                  className="text-emerald-300 hover:text-emerald-200"
                  onClick={() => {
                    void handleRenamePage();
                  }}
                >
                  ✓
                </button>
                <button
                  type="button"
                  aria-label="Cancel rename"
                  className="text-zinc-500 hover:text-zinc-300"
                  onClick={() => setRenamingPage(false)}
                >
                  ×
                </button>
              </span>
            ) : (
              <button
                type="button"
                title="Rename this page"
                aria-label="Rename page"
                className="rounded-lg border border-zinc-800 p-1.5 text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-200"
                onClick={() => {
                  setPageNameDraft(activePage.name);
                  setRenamingPage(true);
                }}
              >
                <Pencil className="h-3 w-3" aria-hidden />
              </button>
            )}
            <label className="flex items-center gap-1 text-[11px] text-zinc-500">
              <RefreshCw className="h-3 w-3" aria-hidden />
              <select
                aria-label="Refresh every"
                value={activePage.refresh_seconds ?? 15}
                disabled={busy}
                onChange={(e) => {
                  void handlePageSetting({ refreshSeconds: Number(e.target.value) });
                }}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-300 outline-none focus:border-emerald-500/50"
              >
                {REFRESH_OPTIONS.map((option) => (
                  <option key={option.seconds} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-zinc-500">
              <Maximize2 className="h-3 w-3" aria-hidden />
              <select
                aria-label="Time window"
                value={activePage.window_minutes ?? 60}
                disabled={busy}
                onChange={(e) => {
                  void handlePageSetting({ windowMinutes: Number(e.target.value) });
                }}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-300 outline-none focus:border-emerald-500/50"
              >
                {WINDOW_OPTIONS.map((option) => (
                  <option key={option.minutes} value={option.minutes}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {!adding ? (
              <button
                type="button"
                data-testid="add-panel-button"
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-emerald-500/40 hover:text-emerald-300"
                onClick={() => {
                  resetForm();
                  setAdding(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add widget
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {widgets.length === 0 && !adding && activePage !== null ? (
        <p className="mt-3 text-xs text-zinc-600">
          This page is empty — add widgets (stats, gauges, sparklines, or the
          scrape-target table), stretch them across the grid, and reorder them.
          Everything you build here is what a share link shows.
        </p>
      ) : null}
      {error !== null ? (
        <p
          className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {adding && activePage !== null ? (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="grid grid-cols-1 gap-x-2 gap-y-2 sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Widget title"
                title="Shown as the card heading — e.g. “Disk IO”"
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
              />
              <p className="text-[10px] text-zinc-600">Any short name; shown as the card heading.</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as WidgetKind)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500/50"
                aria-label="Widget type"
                title="How the data is drawn: over time, as a dial, a single number, or the target table"
              >
                <option value="sparkline">Sparkline (range)</option>
                <option value="gauge">Gauge (0–100%)</option>
                <option value="stat">Stat (single value)</option>
                <option value="hosts_table">Scrape-target table</option>
              </select>
              <p className="text-[10px] text-zinc-600">Line over time · dial · number · table.</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <select
                value={span}
                onChange={(e) => setSpan(Number(e.target.value))}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500/50"
                aria-label="Grid width"
                title="How many grid columns this widget stretches across"
              >
                <option value={1}>Width: 1 column</option>
                <option value={2}>Width: 2 columns</option>
                <option value={3}>Width: full row</option>
              </select>
              <p className="text-[10px] text-zinc-600">Card size — stretch wide on big screens.</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="Unit (optional, e.g. bytes/s)"
                title="Appended to numbers, e.g. %, req/s, bytes"
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
              />
              <p className="text-[10px] text-zinc-600">Suffix on numbers — %, req/s, bytes…</p>
            </div>
          </div>
          {kind !== "hosts_table" ? (
            <div className="relative">
              <textarea
                value={promql}
                onChange={(e) => setPromql(e.target.value)}
                placeholder='PromQL — e.g. rate(node_network_receive_bytes_total{device=~"eth.*|ens.*|eno.*|bond.*"}[5m])'
                title="PromQL query — instant for stat/gauge, range for sparkline. The backend normalizer enforces device filters, MemAvailable, and [5m]+ rate windows."
                rows={2}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
              />
              <p className="mt-0.5 text-[10px] text-zinc-600">
                One PromQL expression. Sparklines render a time range; stat/gauge
                take the latest value. Unsafe queries are auto-corrected by the
                backend normalizer.
              </p>
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
          ) : (
            <p className="text-[11px] text-zinc-600">
              The scrape-target table lists everything your Prometheus watches —
              no query needed.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
              disabled={
                busy ||
                title.trim().length === 0 ||
                (kind !== "hosts_table" && promql.trim().length === 0)
              }
              onClick={() => {
                if (editingWidget !== null) {
                  void handleSaveEdit();
                } else {
                  void handleCreate();
                }
              }}
            >
              {busy ? "Saving…" : editingWidget !== null ? "Save changes" : `Add to ${activePage.name}`}
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600"
              onClick={() => {
                setAdding(false);
                resetForm();
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div
        className={`mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3`}
        data-testid="panel-grid"
      >
        {widgets.map((widget, index) => (
          <div
            key={widget.id}
            className={`group relative transition-opacity ${
              spanClass(widget.span)
            } ${dragIndex === index ? "opacity-40" : ""}`}
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
              className="absolute -left-1 top-2 z-10 cursor-grab rounded p-0.5 text-zinc-700 opacity-0 transition group-hover:opacity-100 active:cursor-grabbing"
              aria-hidden
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
            <LiveWidget widget={widget} index={index} />
            <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
              <button
                type="button"
                aria-label={`Widen ${widget.title}`}
                title={widget.span >= 3 ? "Already full width" : "Stretch wider"}
                className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                disabled={widget.span >= 3}
                onClick={() => {
                  void updateWidget(tenantId, widget.id, { span: Math.min(widget.span + 1, 3) }).then(
                    () => refresh()
                  );
                }}
              >
                <Maximize2 className="h-3 w-3" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Shrink ${widget.title}`}
                title={widget.span <= 1 ? "Already narrow" : "Make narrower"}
                className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                disabled={widget.span <= 1}
                onClick={() => {
                  void updateWidget(tenantId, widget.id, { span: Math.max(widget.span - 1, 1) }).then(
                    () => refresh()
                  );
                }}
              >
                <Minimize2 className="h-3 w-3" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Edit ${widget.title}`}
                title="Edit this widget"
                className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
                onClick={() => startEdit(widget)}
              >
                <Pencil className="h-3 w-3" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Delete widget ${widget.title}`}
                title="Remove this widget"
                className="rounded p-1 text-zinc-600 hover:bg-rose-500/10 hover:text-rose-400"
                disabled={busy}
                onClick={() => {
                  void handleDelete(widget.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
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
}
