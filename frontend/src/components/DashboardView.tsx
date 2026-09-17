import {
  Cpu,
  MemoryStick,
  Radio,
  RefreshCw,
  Server,
  Share2,
} from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";
import { HealthBadge } from "./HealthBadge";
import { StatusCard } from "./StatusCard";
import { GaugeCard } from "./GaugeCard";
import { SparkLineCard } from "./SparkLineCard";
import { ConnectionSwitcher } from "./ConnectionSwitcher";
import { CustomPanels } from "./CustomPanels";
import { ShareDialog } from "./ShareDialog";
import type { DashboardPage } from "../lib/api";
import { DEFAULT_QUERIES, useInstantMetric, useRangeMetric } from "../hooks/useDashboard";
import { useSSE } from "../hooks/useSSE";
import { useAuth } from "../hooks/useAuth";

function latestScalar(
  data: { result: unknown[] } | null
): number | null {
  if (data === null || data.result.length === 0) {
    return null;
  }
  const first = data.result[0] as { value?: { value: number } };
  return first.value?.value ?? null;
}

/** Manual refresh broadcast — every live widget re-fetches at once. */
function triggerRefresh(): void {
  window.dispatchEvent(new CustomEvent("passthrough:refresh"));
}

export function DashboardView({
  tenantId,
  embedded = false,
}: {
  tenantId: string;
  /** When true, the parent chrome already brands the page — render a slim toolbar instead of a full header. */
  embedded?: boolean;
}): JSX.Element {
  // Internal tenant IDs never render in the UI (callers pass embedded mode).
  void tenantId.length;
  const { status } = useSSE(tenantId);
  const { token, tenantToken } = useAuth();
  const hasWorkspaceAccess = token !== null || tenantToken !== null;
  const [activeLabel, setActiveLabel] = useState<string>("default");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  // The built-in essentials strip is optional per page — the pages workspace
  // reports the active page; pages that opt out render only their own widgets.
  const [activePage, setActivePage] = useState<DashboardPage | null>(null);
  const showBuiltins = !hasWorkspaceAccess || activePage === null ? true : activePage.show_builtins !== false;
  // The built-in strip follows a 1h window; pages override their own.
  const cpu = useInstantMetric(tenantId, DEFAULT_QUERIES.cpu);
  const ram = useInstantMetric(tenantId, DEFAULT_QUERIES.ram);
  const hostsUp = useInstantMetric(tenantId, DEFAULT_QUERIES.hostsUp);
  const netRx = useRangeMetric(tenantId, DEFAULT_QUERIES.networkRx);
  const netTx = useRangeMetric(tenantId, DEFAULT_QUERIES.networkTx);

  const cpuPercent = latestScalar(cpu.data) ?? 0;
  const ramPercent = latestScalar(ram.data) ?? 0;
  const upCount = hostsUp.data?.result.filter((entry) => {
    const item = entry as { value?: { value: number } };
    return (item.value?.value ?? 0) === 1;
  }).length ?? 0;

  function levelFor(percent: number): "emerald" | "amber" | "rose" {
    if (percent >= 90) return "rose";
    if (percent >= 75) return "amber";
    return "emerald";
  }

  return (
    <div className={embedded ? "" : "min-h-screen"}>
      {/* In embedded mode the app header above is THE header — this renders a
          slim toolbar only. Internal tenant IDs are never displayed. */}
      {embedded ? null : (
      <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2 sm:px-6">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-300" aria-hidden />
            <span className="text-sm font-semibold tracking-tight">Passthrough</span>
            <span
              className="hidden max-w-72 truncate text-xs text-zinc-500 sm:inline"
              title={`connection: ${activeLabel}`}
            >
              {activeLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {token !== null ? (
              <ConnectionSwitcher
                tenantId={tenantId}
                onActiveChanged={setActiveLabel}
              />
            ) : null}
            <HealthBadge status={status} />
          </div>
        </div>
      </header>
      )}

      {/* In embedded mode the switcher/health/share controls live in a slim
          toolbar row directly under the single app header. */}
      {embedded && token !== null ? (
        <div className="mx-auto flex w-full max-w-none items-center justify-between gap-2 px-4 pt-3 sm:px-8">
          <ConnectionSwitcher tenantId={tenantId} onActiveChanged={setActiveLabel} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Refresh every widget now"
              aria-label="Refresh now"
              onClick={triggerRefresh}
              className="rounded-lg border border-zinc-800 p-1.5 text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </button>
            <HealthBadge status={status} />
            <button
              type="button"
              data-testid="share-button"
              title="Create a share link — anyone with the link, specific emails, or your whole org"
              onClick={() => setShareDialogOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <Share2 className="h-3.5 w-3.5" aria-hidden />
              Share
            </button>
          </div>
        </div>
      ) : !embedded && token !== null ? (
        <div className="mx-auto mt-4 flex w-full max-w-none items-center justify-end gap-2 px-4 sm:px-8">
          <button
            type="button"
            title="Refresh every widget now"
            aria-label="Refresh now"
            onClick={triggerRefresh}
            className="rounded-lg border border-zinc-800 p-1.5 text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            data-testid="share-button"
            onClick={() => setShareDialogOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <Share2 className="h-3.5 w-3.5" aria-hidden />
            Share
          </button>
        </div>
      ) : null}
      {shareDialogOpen ? (
        <ShareDialog tenantId={tenantId} onClose={() => setShareDialogOpen(false)} />
      ) : null}

      {/* Built-in node-exporter essentials (base layer) — per-page optional. */}
      <main className="mx-auto w-full max-w-none px-4 py-5 sm:px-8">
        {showBuiltins ? (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-6">
          <StatusCard
            title="Hosts Up"
            value={String(upCount)}
            unit={`/ ${hostsUp.data?.result.length ?? 0}`}
            level={upCount > 0 ? "emerald" : "rose"}
            icon={Server}
            subtitle="Live via single-poll SSE"
          />
          <GaugeCard
            title="CPU Utilization"
            percent={cpuPercent}
            level={levelFor(cpuPercent)}
            query={DEFAULT_QUERIES.cpu}
          />
          <GaugeCard
            title="RAM Utilization"
            percent={ramPercent}
            level={levelFor(ramPercent)}
            query={DEFAULT_QUERIES.ram}
          />
        </section>
        ) : null}

        {showBuiltins ? (
        <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SparkLineCard
            title="Network RX"
            unit="bytes/s"
            series={netRx.series}
            stroke="#34d399"
            query={DEFAULT_QUERIES.networkRx}
          />
          <SparkLineCard
            title="Network TX"
            unit="bytes/s"
            series={netTx.series}
            stroke="#60a5fa"
            query={DEFAULT_QUERIES.networkTx}
          />
        </section>
        ) : null}

        {hasWorkspaceAccess ? (
          <CustomPanels tenantId={tenantId} wide onActivePageChange={setActivePage} />
        ) : null}

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-6 text-center text-[11px] text-zinc-600"
        >
          <Cpu className="mr-1 inline h-3 w-3" aria-hidden />
          <MemoryStick className="mr-1 inline h-3 w-3" aria-hidden />
          Queries normalized &amp; cached server-side (300s TTL) — physical NICs only.
        </motion.p>
      </main>
    </div>
  );
}
