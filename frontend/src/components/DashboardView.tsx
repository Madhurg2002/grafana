import {
  Cpu,
  MemoryStick,
  Radio,
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
  const { token } = useAuth();
  const [activeLabel, setActiveLabel] = useState<string>("default");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
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
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 pt-3 sm:px-6">
          <ConnectionSwitcher tenantId={tenantId} onActiveChanged={setActiveLabel} />
          <div className="flex items-center gap-2">
            <HealthBadge status={status} />
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
        </div>
      ) : !embedded && token !== null ? (
        <div className="mx-auto mt-4 flex max-w-6xl items-center justify-end px-4 sm:px-6">
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

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

        {hostsUp.data !== null && hostsUp.data.result.length > 0 ? (
          <section className="mt-6" data-testid="hosts-table">
            <h2 className="mb-2 text-sm font-semibold text-zinc-300">
              Scrape targets
              <span className="ml-2 text-xs font-normal text-zinc-500">
                every endpoint your Prometheus watches — up means it responded
                to the last scrape
              </span>
            </h2>
            {/* Formula transparency: the exact query behind this table. */}
            <p
              className="mb-2 truncate font-mono text-[10px] text-zinc-600"
              title={`Query powering this table: ${DEFAULT_QUERIES.hostsUp}`}
            >
              <span className="text-zinc-500">query:</span> {DEFAULT_QUERIES.hostsUp}
            </p>
            <div className="overflow-hidden rounded-xl border border-zinc-800/80">
              <table className="w-full text-left text-xs">
              <thead className="bg-zinc-900/70 text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Instance</th>
                  <th className="px-4 py-2 font-medium">Job</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {hostsUp.data.result.slice(0, 100).map((entry) => {
                  const item = entry as {
                    metric?: Record<string, string>;
                    value?: { value: number };
                  };
                  const up = item.value?.value ?? 0;
                  return (
                    <tr
                      key={`${item.metric?.job ?? "?"}/${item.metric?.instance ?? "?"}`}
                      className="border-t border-zinc-800/60"
                    >
                      <td className="max-w-64 truncate px-4 py-2 font-mono text-zinc-200">
                        <span
                          title={item.metric?.instance ?? "unknown"}
                          className="block truncate"
                        >
                          {item.metric?.instance ?? "unknown"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-zinc-400">
                        <span title={item.metric?.job ?? "unknown"} className="block truncate">
                          {item.metric?.job ?? "unknown"}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={up === 1 ? "text-emerald-300" : "text-rose-300"}
                          title={
                            up === 1
                              ? "Last scrape succeeded"
                              : "Last scrape failed or timed out"
                          }
                        >
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
        ) : null}

        {token !== null ? <CustomPanels tenantId={tenantId} /> : null}

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
