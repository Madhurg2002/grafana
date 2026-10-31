import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import {
  Copy,
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
  X,
  Download,
  FileDown,
  FileUp,
} from "lucide-react";
import { GaugeCard } from "./GaugeCard";
import { SparkLineCard } from "./SparkLineCard";
import { StatusCard } from "./StatusCard";
import { PromqlHelper } from "./PromqlHelper";
import { MetricBrowser } from "./MetricBrowser";
import { AlertManager } from "./AlertManager";
import {
  createPage,
  createWidget,
  deletePage,
  deleteWidget,
  exportPageJson,
  importPageJson,
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
import { DEFAULT_QUERIES, useInstantMetric, useRangeMetric } from "../hooks/useDashboard";
import { csvFilename, downloadCsv } from "../lib/csv";

const PALETTE = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#38bdf8"];

interface WidgetWithHost extends PageWidget {
  onSelectHost?: (host: string | null) => void;
}

interface Props {
  tenantId: string;
  /** True when the page should use the wide (Grafana-style) layout. */
  wide?: boolean;
  /** Notifies the parent which page is active (for built-ins visibility). */
  onActivePageChange?: (page: DashboardPage | null) => void;
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

const WIDGET_DEFAULTS: Record<WidgetKind, { title: string; promql: string; unit: string; span: number }> = {
  sparkline: {
    title: "Network RX",
    promql: DEFAULT_QUERIES.networkRx,
    unit: "bytes/s",
    span: 2,
  },
  gauge: {
    title: "CPU Utilization",
    promql: DEFAULT_QUERIES.cpu,
    unit: "%",
    span: 1,
  },
  stat: {
    title: "Hosts Up",
    promql: DEFAULT_QUERIES.hostsUp,
    unit: "",
    span: 1,
  },
  hosts_table: {
    title: "Scrape Targets",
    promql: "",
    unit: "",
    span: 3,
  },
};

/**
 * Maps a widget's grid span to responsive classes. Spans run 1–12 so users
 * can size a widget however they want (the edit modal and a drag handle on
 * the card both set it). The grid: 4 columns from sm, 6 at 2xl+ in wide
 * mode (4 otherwise) — spans map proportionally and clamp per breakpoint.
 * Classes live in static literal arrays so Tailwind's scanner sees them
 * (dynamic template strings would never be generated into the CSS).
 */
const SPAN_WIDE_SM = [
  "sm:col-span-1",
  "sm:col-span-2",
  "sm:col-span-2",
  "sm:col-span-2",
  "sm:col-span-3",
  "sm:col-span-3",
  "sm:col-span-3",
  "sm:col-span-3",
  "sm:col-span-4",
  "sm:col-span-4",
  "sm:col-span-4",
  "sm:col-span-4",
] as const;
const SPAN_WIDE_XL = [
  "2xl:col-span-1",
  "2xl:col-span-1",
  "2xl:col-span-1",
  "2xl:col-span-2",
  "2xl:col-span-2",
  "2xl:col-span-3",
  "2xl:col-span-3",
  "2xl:col-span-4",
  "2xl:col-span-4",
  "2xl:col-span-5",
  "2xl:col-span-5",
  "2xl:col-span-6",
] as const;
const SPAN_NARROW_SM = [
  "sm:col-span-1",
  "sm:col-span-1",
  "sm:col-span-1",
  "sm:col-span-1",
  "sm:col-span-1",
  "sm:col-span-2",
  "sm:col-span-2",
  "sm:col-span-2",
  "sm:col-span-2",
  "sm:col-span-2",
  "sm:col-span-2",
  "sm:col-span-2",
] as const;
const SPAN_NARROW_XL = [
  "2xl:col-span-1",
  "2xl:col-span-1",
  "2xl:col-span-1",
  "2xl:col-span-1",
  "2xl:col-span-2",
  "2xl:col-span-2",
  "2xl:col-span-2",
  "2xl:col-span-2",
  "2xl:col-span-3",
  "2xl:col-span-3",
  "2xl:col-span-3",
  "2xl:col-span-4",
] as const;

function spanClass(spanRaw: number, wide = false): string {
  const span = Math.max(1, Math.min(12, Math.round(spanRaw)));
  return wide
    ? `col-span-1 ${SPAN_WIDE_SM[span - 1]} ${SPAN_WIDE_XL[span - 1]}`
    : `col-span-1 ${SPAN_NARROW_SM[span - 1]} ${SPAN_NARROW_XL[span - 1]}`;
}

/**
 * Live widget: polls its own instant/range query. When a host is selected
 * (hosts-table drill-down), the query is scoped with an instance selector.
 */
function LiveWidget({
  widget,
  index,
  selectedHost,
  windowMinutes,
}: {
  widget: WidgetWithHost;
  index: number;
  selectedHost: string | null;
  windowMinutes: number;
}): JSX.Element {
  const stroke = PALETTE[index % PALETTE.length];
  // Escapes a label value for safe inclusion inside PromQL double quotes.
  const promqlEscape = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  // Scope to the selected host unless the query already filters instance.
  const scoped = selectedHost === null ? null : promqlEscape(selectedHost);
  const query =
    scoped === null || widget.promql.includes("instance=") || widget.promql.length === 0
      ? widget.promql
      : /\{\s*\}/.test(widget.promql)
        ? widget.promql.replace(/\{\s*\}/, `{instance="${scoped}"}`)
        : widget.promql.includes("{")
          ? widget.promql.replace(/\{/, `{instance="${scoped}",`)
          : `${widget.promql}{instance="${scoped}"}`;
  const instant = useInstantMetric(widget.tenant_id, query, 60, widget.kind !== "sparkline" && widget.kind !== "hosts_table");
  const range = useRangeMetric(widget.tenant_id, query, windowMinutes, "5m", widget.kind === "sparkline");

  if (widget.kind === "sparkline") {
    return (
      <SparkLineCard
        title={widget.title}
        unit={widget.unit ?? ""}
        series={range.series}
        stroke={stroke}
        query={query}
        heightPx={widget.height_px}
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
        query={query}
        heightPx={widget.height_px}
        onExportCsv={(title, percent) => {
          downloadCsv(csvFilename(title), [{
            timestamp: new Date().toISOString(),
            value: Number(percent.toFixed(3)),
            unit: "%",
          }]);
        }}
      />
    );
  }
  if (widget.kind === "hosts_table") {
    return (
      <HostsTable
        tenantId={widget.tenant_id}
        selectedHost={selectedHost}
        onSelectHost={widget.onSelectHost ?? (() => undefined)}
      />
    );
  }
  const stat = firstScalar(instant.data);
  return (
    <div className="relative">
      <StatusCard
        title={widget.title}
        value={stat === null ? "—" : formatValue(stat)}
        unit={widget.unit ?? ""}
        level="emerald"
        icon={LayoutDashboard}
        subtitle={query.length > 40 ? `${query.slice(0, 40)}…` : query}
        heightPx={widget.height_px}
      />
      {stat !== null ? (
        <button
          type="button"
          data-testid="stat-csv"
          title="Download this value as CSV"
          aria-label={`Download ${widget.title} as CSV`}
          className="rounded-md p-1 text-[#5f6779] transition hover:bg-white/[0.06] hover:text-white"
          onClick={() => {
            downloadCsv(csvFilename(widget.title), [{
              timestamp: new Date().toISOString(),
              value: Number(stat.toFixed(4)),
              ...(widget.unit ? { unit: widget.unit } : {}),
            }]);
          }}
        >
          <Download className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** The scrape-target table as a widget (query transparency + drill-down). */
function HostsTable({
  tenantId,
  selectedHost,
  onSelectHost,
}: {
  tenantId: string;
  selectedHost: string | null;
  onSelectHost: (host: string | null) => void;
}): JSX.Element {
  const hostsUp = useInstantMetric(tenantId, "up");
  const [hostFilter, setHostFilter] = useState("");
  const [downOnly, setDownOnly] = useState(false);
  const needle = hostFilter.trim().toLowerCase();
  // One pass over the `up` vector: parse → filter → cap, so the table stays
  // responsive on a 500-target fleet and the empty state can explain itself.
  const visibleHosts = (hostsUp.data?.result ?? [])
    .map((entry) => {
      const item = entry as { metric?: Record<string, string>; value?: { value: number } };
      return {
        instance: item.metric?.instance ?? "unknown",
        job: item.metric?.job ?? "unknown",
        up: item.value?.value ?? 0,
      };
    })
    .filter((host) => (downOnly ? host.up !== 1 : true))
    .filter(
      (host) =>
        needle.length === 0 || `${host.instance} ${host.job}`.toLowerCase().includes(needle)
    )
    .slice(0, 200);
  const totalHosts = hostsUp.data?.result.length ?? 0;
  return (
    <section className="glass-card p-4" data-testid="hosts-widget">
      <h2 className="mb-2 flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-tight text-white">
        Scrape targets
        <span
          className="chip px-1.5 py-0.5 font-mono text-[10px] font-normal"
          title="This table is powered by the `up` metric — Prometheus's own health check for every scrape target. 1 = up, 0 = down."
        >
          metric: up
        </span>
        <span className="text-[11px] font-normal text-[#8d95a8]">
          {selectedHost === null
            ? "click a host to scope gauges/sparklines to it"
            : `scoped to ${selectedHost}`}
        </span>
        {selectedHost !== null ? (
          <button
            type="button"
            title="Clear the host filter — show all hosts again"
            className="rounded border border-white/[0.14] px-1.5 text-[10px] text-[#8d95a8] transition hover:text-white"
            onClick={() => onSelectHost(null)}
          >
            clear
          </button>
        ) : null}
      </h2>
      <p
        className="mb-2 truncate font-mono text-[10px] text-[#5f6779]"
        title="Query powering this table: up"
      >
        <span className="text-[#8d95a8]">query:</span> up
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={hostFilter}
          onChange={(e) => setHostFilter(e.target.value)}
          placeholder="Filter hosts (instance or job)…"
          aria-label="Filter hosts"
          title="Filter the target list — matches the instance or job label"
          className="field max-w-64 py-1 text-xs"
        />
        <label
          className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[#8d95a8]"
          title="Show only targets whose last scrape failed"
        >
          <input
            type="checkbox"
            checked={downOnly}
            onChange={(e) => setDownOnly(e.target.checked)}
            className="h-3 w-3 accent-[#5eead4]"
          />
          down only
        </label>
        <span className="text-[10px] text-[#5f6779]" data-testid="hosts-count">
          {visibleHosts.length} of {totalHosts}
        </span>
      </div>
      <div className="max-h-64 overflow-auto rounded-lg border border-white/[0.075] bg-black/20">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[#0b0e14]/95 text-[#8d95a8] backdrop-blur">
            <tr>
              <th className="px-4 py-2 font-medium">Instance</th>
              <th className="px-4 py-2 font-medium">Job</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleHosts.map((host, i) => {
              const up = host.up;
              const instance = host.instance;
              const isSel = selectedHost === instance;
              return (
                <tr
                  key={`${host.job}/${instance}/${i}`}
                  className={`cursor-pointer border-t border-white/[0.06] transition ${
                    isSel ? "bg-[#5eead4]/10" : "hover:bg-white/[0.04]"
                  }`}
                  title={
                    isSel
                      ? `Click to clear — gauges/sparklines currently scoped to ${instance}`
                      : `Click to scope gauges/sparklines to ${instance}`
                  }
                  onClick={() => onSelectHost(isSel ? null : instance)}
                >
                  <td className="max-w-64 truncate px-4 py-2 font-mono text-[#c3cad8]">
                    <span title={instance} className={`block truncate ${isSel ? "text-[#7df0dc]" : ""}`}>
                      {instance}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[#8d95a8]">{host.job}</td>
                  <td className="px-4 py-2">
                    <span className={up === 1 ? "font-medium text-[#34d399]" : "font-medium text-[#fb7185]"}>
                      {up === 1 ? "up" : "down"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {visibleHosts.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-center text-[11px] text-[#5f6779]">
                  {totalHosts === 0
                    ? "No scrape targets reported yet."
                    : "No targets match this filter."}
                </td>
              </tr>
            ) : null}
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
export function CustomPanels({ tenantId, wide = false, onActivePageChange }: Props): JSX.Element | null {
  const [pages, setPages] = useState<DashboardPage[]>([]);
  const [activePageId, setActivePageId] = useState<number | null>(null);
  const [newPageName, setNewPageName] = useState("");
  const [newPageWithBuiltins, setNewPageWithBuiltins] = useState(true);
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
  const [heightPx, setHeightPx] = useState(112);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingPage, setRenamingPage] = useState(false);
  const [pageNameDraft, setPageNameDraft] = useState("");
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const promqlInputRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestRef = useRef<(() => void) | null>(null);
  const suggestKeyDownRef = useRef<((e: React.KeyboardEvent<HTMLTextAreaElement>) => void) | null>(null);

  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0] ?? null;

  // Tell the parent which page is active so it can show/hide the built-in strip.
  useEffect(() => {
    onActivePageChange?.(activePage);
  }, [activePage, onActivePageChange]);

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
      const { page } = await createPage(tenantId, name, newPageWithBuiltins);
      setPages((prev) => [...prev, page]);
      setActivePageId(page.id);
      setNewPageName("");
      setNewPageWithBuiltins(true);
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

  async function handlePageSetting(patch: {
    refreshSeconds?: number;
    windowMinutes?: number;
    showBuiltins?: boolean;
  }): Promise<void> {
    if (activePage === null) return;
    setBusy(true);
    setError(null);
    const previousPage = activePage;
    setPages((current) =>
      current.map((page) =>
        page.id === previousPage.id
          ? {
              ...page,
              ...(patch.refreshSeconds !== undefined ? { refresh_seconds: patch.refreshSeconds } : {}),
              ...(patch.windowMinutes !== undefined ? { window_minutes: patch.windowMinutes } : {}),
              ...(patch.showBuiltins !== undefined ? { show_builtins: patch.showBuiltins } : {}),
            }
          : page
      )
    );
    try {
      await updatePageSettings(tenantId, activePage.id, patch);
    } catch (err) {
      setPages((current) => current.map((page) => page.id === previousPage.id ? previousPage : page));
      setError(err instanceof Error ? err.message : "Failed to update page settings");
    } finally {
      setBusy(false);
    }
  }

  function resetForm(): void {
    applyWidgetDefaults("sparkline");
    setEditingWidget(null);
  }

  /** Imports a dashboard JSON file as a NEW page and switches to it. */
  async function handleImportPage(file: File): Promise<void> {
    setError(null);
    try {
      const page = await importPageJson(tenantId, file);
      const payload = await listPages(tenantId);
      setPages(payload.pages);
      const imported = payload.pages.find((p) => p.id === page.id) ?? null;
      if (imported !== null) {
        setActivePageId(page.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  }

  function applyWidgetDefaults(nextKind: WidgetKind): void {
    const defaults = WIDGET_DEFAULTS[nextKind];
    setKind(nextKind);
    setTitle(defaults.title);
    setPromql(defaults.promql);
    setUnit(defaults.unit);
    setSpan(defaults.span);
    setHeightPx(112);
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
        heightPx,
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
      const { widget } = await updateWidget(tenantId, editingWidget.id, {
        kind,
        title: title.trim(),
        ...(kind !== "hosts_table" ? { promql: promql.trim() } : {}),
        unit: unit.trim().length > 0 ? unit.trim() : null,
        span,
        heightPx,
      });
      setWidgets((current) =>
        current.map((currentWidget) =>
          currentWidget.id === widget.id ? widget : currentWidget
        )
      );
      resetForm();
      setAdding(false);
      window.dispatchEvent(new CustomEvent("passthrough:refresh"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update widget");
    } finally {
      setBusy(false);
    }
  }

  /** Duplicates a widget onto the same page, appending it at the end. */
  async function handleClone(widget: PageWidget): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await createWidget(tenantId, widget.page_id, {
        kind: widget.kind,
        title: `${widget.title} (copy)`,
        promql: widget.kind === "hosts_table" ? undefined : widget.promql,
        unit: widget.unit ?? undefined,
        span: widget.span,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clone widget");
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

  /**
   * Drag-to-resize, both axes:
   *  - right edge / corner: span (1 column per grid gap-to-gap step);
   *  - bottom edge / corner: pinned pixel height (40px per grid-row feel).
   * Live-preview via setWidgets; persists span and/or height on release.
   */
  function startResize(event: ReactPointerEvent<HTMLSpanElement>, widget: PageWidget, axis: "x" | "y" | "both"): void {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const gridEl = handle.closest("[data-testid='panel-grid']");
    if (gridEl === null) {
      return;
    }
    const gridRect = gridEl.getBoundingClientRect();
    const style = window.getComputedStyle(gridEl);
    const gap = parseFloat(style.columnGap || style.gap || "16") || 16;
    const cols = wide ? 6 : 4;
    const colWidth = (gridRect.width - gap * (cols - 1)) / cols;
    const startX = event.clientX;
    const startY = event.clientY;
    const startSpan = widget.span;
    const startHeight = widget.height_px;
    let lastSpan = startSpan;
    let lastHeight = startHeight;
    handle.setPointerCapture(event.pointerId);

    function onMove(moveEvent: PointerEvent): void {
      if (axis !== "y") {
        const deltaCols = Math.round((moveEvent.clientX - startX) / (colWidth + gap));
        const nextSpan = Math.max(1, Math.min(12, startSpan + deltaCols));
        if (nextSpan !== lastSpan) {
          lastSpan = nextSpan;
          setWidgets((prev) =>
            prev.map((w) => (w.id === widget.id ? { ...w, span: nextSpan } : w))
          );
        }
      }
      if (axis !== "x") {
        // 20px per step keeps vertical drags comfortable without overshoot.
        const nextHeight = Math.max(60, Math.min(1200, startHeight + Math.round((moveEvent.clientY - startY) / 20) * 20));
        if (nextHeight !== lastHeight) {
          lastHeight = nextHeight;
          setWidgets((prev) =>
            prev.map((w) => (w.id === widget.id ? { ...w, height_px: nextHeight } : w))
          );
        }
      }
    }
    function onUp(): void {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      const patch: { span?: number; heightPx?: number } = {};
      if (lastSpan !== startSpan) patch.span = lastSpan;
      if (lastHeight !== startHeight) patch.heightPx = lastHeight;
      if (Object.keys(patch).length > 0) {
        void updateWidget(tenantId, widget.id, patch).then(() => refresh());
      }
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function startEdit(widget: PageWidget): void {
    setEditingWidget(widget);
    setTitle(widget.title);
    setPromql(widget.promql);
    setUnit(widget.unit ?? "");
    setKind(widget.kind);
    setSpan(widget.span);
    setHeightPx(widget.height_px);
    setAdding(true);
  }

  const containerClass = wide
    ? "mx-auto w-full max-w-none px-4 sm:px-8" // wide mode = use the whole screen (TV wall)
    : "mx-auto w-full max-w-6xl px-4 sm:px-6";

  return (
    <section className={`${containerClass} mt-6`} data-testid="custom-panels">
      {/* Page tabs — each page is an independently editable dashboard. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <LayoutDashboard className="mr-1 h-4 w-4 text-[#5eead4]" aria-hidden />
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
                    ? "bg-[#5eead4]/[0.12] text-[#7df0dc]"
                    : "text-[#8d95a8] hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                {page.is_home === true ? (
                  <Star className="h-3 w-3 fill-[#5eead4] text-[#5eead4]" aria-hidden />
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
                      className="rounded-full bg-[#151922] p-0.5 text-[#8d95a8] transition hover:bg-[#fbbf24]/20 hover:text-[#fbbf24]"
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
                      className="ml-0.5 rounded-full bg-[#151922] p-0.5 text-[#8d95a8] transition hover:bg-[#fb7185]/20 hover:text-[#fb7185]"
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
                title="Page name — letters, digits, spaces, - and _"
                maxLength={64}
                className="field w-28 py-1 text-xs"
              />
              <label
                className="flex cursor-pointer items-center gap-1 text-[10px] text-[#8d95a8]"
                title="Show the fixed built-in essentials (Hosts Up, CPU, RAM, Network) above this page's own widgets"
              >
                <input
                  type="checkbox"
                  checked={newPageWithBuiltins}
                  onChange={(e) => setNewPageWithBuiltins(e.target.checked)}
                  className="h-3 w-3 accent-[#5eead4]"
                />
                built-ins
              </label>
              <button
                type="button"
                aria-label="Create page"
                className="btn btn-primary px-2 py-1"
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
                className="text-[#5f6779] transition hover:text-white"
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
              className="btn btn-ghost gap-1 px-2 py-1"
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
                  className="field w-28 py-1 text-xs"
                />
                <button
                  type="button"
                  aria-label="Save page name"
                  className="text-[#7df0dc] transition hover:text-[#5eead4]"
                  onClick={() => {
                    void handleRenamePage();
                  }}
                >
                  ✓
                </button>
                <button
                  type="button"
                  aria-label="Cancel rename"
                  className="text-[#5f6779] transition hover:text-white"
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
                className="btn btn-ghost p-1.5"
                onClick={() => {
                  setPageNameDraft(activePage.name);
                  setRenamingPage(true);
                }}
              >
                <Pencil className="h-3 w-3" aria-hidden />
              </button>
            )}
            <div className="flex items-center gap-1 text-[11px] text-[#8d95a8]">
              <button
                type="button"
                aria-label="Refresh now"
                title="Refresh every widget now"
                className="rounded-md p-1 text-[#5f6779] transition hover:bg-white/[0.06] hover:text-white"
                onClick={() => window.dispatchEvent(new CustomEvent("passthrough:refresh"))}
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
              </button>
              <button
                type="button"
                data-testid="export-page"
                aria-label="Export page as JSON"
                title="Download this page (layout + widgets) as a JSON file you can import elsewhere"
                className="rounded-md p-1 text-[#5f6779] transition hover:bg-white/[0.06] hover:text-white"
                onClick={() => {
                  if (activePage === null) return;
                  void exportPageJson(activePage, widgets);
                }}
              >
                <FileDown className="h-3 w-3" aria-hidden />
              </button>
              <label
                title="Import a dashboard JSON file as a new page"
                className="cursor-pointer rounded-md p-1 text-[#5f6779] transition hover:bg-white/[0.06] hover:text-white"
              >
                <FileUp className="h-3 w-3" aria-hidden />
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  aria-label="Import page JSON"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = ""; // allow re-importing the same file
                    if (file !== undefined) {
                      void handleImportPage(file);
                    }
                  }}
                />
              </label>
              <select
                aria-label="Refresh every"
                value={activePage.refresh_seconds ?? 15}
                disabled={busy}
                onChange={(e) => {
                  void handlePageSetting({ refreshSeconds: Number(e.target.value) });
                }}
                className="rounded-lg border border-white/[0.09] bg-black/40 px-1.5 py-1 text-[11px] text-[#c3cad8] outline-none transition focus:border-[#5eead4]/50"
              >
                {REFRESH_OPTIONS.map((option) => (
                  <option key={option.seconds} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-1 text-[11px] text-[#8d95a8]">
              <Maximize2 className="h-3 w-3" aria-hidden />
              <select
                aria-label="Time window"
                value={activePage.window_minutes ?? 60}
                disabled={busy}
                onChange={(e) => {
                  void handlePageSetting({ windowMinutes: Number(e.target.value) });
                }}
                className="rounded-lg border border-white/[0.09] bg-black/40 px-1.5 py-1 text-[11px] text-[#c3cad8] outline-none transition focus:border-[#5eead4]/50"
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
                title="Add a stat, gauge, sparkline, or the scrape-target table to this page"
                className="btn btn-ghost"
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
        <p className="mt-3 text-xs leading-relaxed text-[#5f6779]">
          This page is empty — add widgets (stats, gauges, sparklines, or the
          scrape-target table), stretch them across the grid, and reorder them.
          Everything you build here is what a share link shows.
        </p>
      ) : null}
      {error !== null ? (
        <p
          className="mt-2 rounded-lg border border-[#fb7185]/40 bg-[#fb7185]/10 px-3 py-2 text-xs text-[#fda4af]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {adding && activePage !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={editingWidget !== null ? "Edit widget" : "Add widget"}
          data-testid="widget-form-modal"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setAdding(false);
              resetForm();
              setError(null);
            }
          }}
          onClick={() => {
            setAdding(false);
            resetForm();
            setError(null);
          }}
        >
        <div className="glass-card flex max-h-[88vh] w-full max-w-3xl flex-col overflow-y-auto bg-[#080a0e] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="grid grid-cols-1 gap-x-2 gap-y-2 sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Widget title"
                title="Shown as the card heading — e.g. “Disk IO”"
                className="field text-xs"
              />
              <p className="text-[10px] leading-relaxed text-[#5f6779]">Any short name; shown as the card heading.</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <select
                value={kind}
                onChange={(e) => {
                  const nextKind = e.target.value as WidgetKind;
                  if (editingWidget === null) {
                    applyWidgetDefaults(nextKind);
                  } else {
                    setKind(nextKind);
                  }
                }}
                className="field text-xs"
                aria-label="Widget type"
                title="How the data is drawn: over time, as a dial, a single number, or the target table"
              >
                <option value="sparkline">Sparkline (range)</option>
                <option value="gauge">Gauge (0–100%)</option>
                <option value="stat">Stat (single value)</option>
                <option value="hosts_table">Scrape-target table</option>
              </select>
              <p className="text-[10px] leading-relaxed text-[#5f6779]">Line over time · dial · number · table.</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <select
                value={span}
                onChange={(e) => setSpan(Number(e.target.value))}
                className="field text-xs"
                aria-label="Grid width"
                title="How many grid columns this widget stretches across"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n === 12 ? "Width: maximum" : `Width: ${n}`}
                  </option>
                ))}
              </select>
              <p className="text-[10px] leading-relaxed text-[#5f6779]">Width — or drag the card's right edge.</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <input
                type="number"
                min={60}
                max={1200}
                step={4}
                value={heightPx}
                onChange={(e) => setHeightPx(Math.max(60, Math.min(1200, Number(e.target.value) || 112)))}
                aria-label="Widget height in pixels"
                title="Pinned pixel height — stays fixed whatever the zoom level"
                className="field text-xs"
              />
              <p className="text-[10px] leading-relaxed text-[#5f6779]">Height in px — or drag the bottom edge.</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="Unit (optional, e.g. bytes/s)"
                title="Appended to numbers, e.g. %, req/s, bytes"
                className="field text-xs"
              />
              <p className="text-[10px] leading-relaxed text-[#5f6779]">Suffix on numbers — %, req/s, bytes…</p>
            </div>
          </div>
          {kind !== "hosts_table" ? (
            <div className="relative">
              <textarea
                ref={promqlInputRef}
                value={promql}
                onChange={(e) => setPromql(e.target.value)}
                onKeyUp={() => suggestRef.current?.()}
                onClick={() => suggestRef.current?.()}
                onKeyDown={(e) => suggestKeyDownRef.current?.(e)}
                placeholder='PromQL — e.g. rate(node_network_receive_bytes_total{device=~"eth.*|ens.*|eno.*|bond.*"}[5m])'
                title="PromQL query — instant for stat/gauge, range for sparkline. The backend normalizer enforces device filters, MemAvailable, and [5m]+ rate windows."
                rows={2}
                className="field font-mono text-xs"
              />
              <p className="mt-0.5 text-[10px] leading-relaxed text-[#5f6779]">
                One PromQL expression. ↑↓/Enter/Esc navigate suggestions like a
                code editor. Sparklines render a time range; stat/gauge take the
                latest value. Unsafe queries are auto-corrected by the normalizer.
              </p>
              <div className="mt-1 flex items-center gap-3">
                <PromqlHelper
                  tenantId={tenantId}
                  value={promql}
                  onChange={setPromql}
                  inputRef={promqlInputRef as RefObject<HTMLTextAreaElement | null>}
                  registerTrigger={(fn) => {
                    suggestRef.current = fn;
                  }}
                  registerKeyDown={(fn) => {
                    suggestKeyDownRef.current = fn;
                  }}
                />
                <button
                  type="button"
                  title="Open the metric browser — pick a metric and its live series to build a query"
                  className="btn btn-quiet gap-1 px-0 text-[11px]"
                  onClick={() => setBrowserOpen(true)}
                >
                  <Table2 className="h-3 w-3" aria-hidden />
                  Browse metrics
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-[#5f6779]">
              The scrape-target table lists everything your Prometheus watches —
              no query needed.
            </p>
          )}
          <div className="mt-1 flex items-center justify-between">
            <p className="text-[15px] font-semibold tracking-tight text-white">
              {editingWidget !== null ? `Edit “${editingWidget.title}”` : `Add widget to ${activePage.name}`}
            </p>
            <button
              type="button"
              aria-label="Close"
              title="Close without saving"
              className="rounded-md p-1 text-[#5f6779] transition hover:bg-white/[0.06] hover:text-white"
              onClick={() => {
                setAdding(false);
                resetForm();
                setError(null);
              }}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {error !== null ? (
            <p
              className="mt-3 rounded-lg border border-[#fb7185]/40 bg-[#fb7185]/10 px-3 py-2 text-xs text-[#fda4af]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5"
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
              className="btn btn-ghost px-3 py-1.5"
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
        </div>
      ) : null}

      <div
        className={`mt-3 grid grid-cols-1 gap-4 ${
          wide ? "sm:grid-cols-4 2xl:grid-cols-6" : "sm:grid-cols-2 2xl:grid-cols-4"
        }`}
        data-testid="panel-grid"
      >
        {widgets.map((widget, index) => (
          <div
            key={widget.id}
            className={`group relative transition-opacity ${
              spanClass(widget.span, wide)
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
              className="absolute -left-1 top-2 z-10 cursor-grab rounded p-0.5 text-[#3f4657] opacity-0 transition group-hover:opacity-100 active:cursor-grabbing"
              aria-hidden
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
            <span
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize width of ${widget.title}`}
              title="Drag to resize width — spans 1 to 12"
              data-testid={`resize-handle-x-${widget.id}`}
              className="absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-ew-resize touch-none items-center justify-center opacity-0 transition group-hover:opacity-100"
              onPointerDown={(e) => startResize(e, widget, "x")}
            >
              <span className="h-10 w-1 rounded-full bg-[#2a3040] transition group-hover:bg-[#5eead4]/70" />
            </span>
            <span
              role="separator"
              aria-label={`Resize height of ${widget.title}`}
              title="Drag to resize height — 60 to 1200px"
              data-testid={`resize-handle-y-${widget.id}`}
              className="absolute -bottom-1.5 left-0 z-10 flex h-3 w-full cursor-ns-resize touch-none items-center justify-center opacity-0 transition group-hover:opacity-100"
              onPointerDown={(e) => startResize(e, widget, "y")}
            >
              <span className="h-1 w-10 rounded-full bg-[#2a3040] transition group-hover:bg-[#5eead4]/70" />
            </span>
            <span
              role="separator"
              aria-label={`Resize ${widget.title} in both directions`}
              title="Drag to resize width and height"
              data-testid={`resize-handle-xy-${widget.id}`}
              className="absolute -bottom-1.5 -right-1.5 z-10 h-4 w-4 cursor-nwse-resize touch-none rounded-sm opacity-0 transition group-hover:opacity-100"
              onPointerDown={(e) => startResize(e, widget, "both")}
            >
              <span className="absolute bottom-0.5 right-0.5 h-2 w-2 border-b-2 border-r-2 border-[#3f4657] transition group-hover:border-[#5eead4]/70" />
            </span>
            <LiveWidget
              widget={{ ...widget, onSelectHost: setSelectedHost } as WidgetWithHost}
              index={index}
              selectedHost={selectedHost}
              windowMinutes={activePage.window_minutes ?? 60}
            />
            <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
              <button
                type="button"
                aria-label={`Widen ${widget.title}`}
                title={widget.span >= 12 ? "Already maximum width" : "Stretch wider"}
                className="rounded-md p-1 text-[#5f6779] transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30"
                disabled={widget.span >= 12}
                onClick={() => {
                  void updateWidget(tenantId, widget.id, { span: Math.min(widget.span + 1, 12) }).then(
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
                className="rounded-md p-1 text-[#5f6779] transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30"
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
                aria-label={`Clone ${widget.title}`}
                title="Duplicate this widget — the copy is added at the end of the page"
                className="rounded-md p-1 text-[#5f6779] transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30"
                disabled={busy}
                onClick={() => {
                  void handleClone(widget);
                }}
              >
                <Copy className="h-3 w-3" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Edit ${widget.title}`}
                title="Edit this widget"
                className="rounded-md p-1 text-[#5f6779] transition hover:bg-white/[0.08] hover:text-white"
                onClick={() => startEdit(widget)}
              >
                <Pencil className="h-3 w-3" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Delete widget ${widget.title}`}
                title="Remove this widget"
                className="rounded-md p-1 text-[#5f6779] transition hover:bg-[#fb7185]/10 hover:text-[#fb7185]"
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

      <AlertManager tenantId={tenantId} />
    </section>
  );
}
