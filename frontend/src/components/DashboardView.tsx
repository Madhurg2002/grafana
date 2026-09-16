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
import { DEFAULT_QUERIES, useInstantMetric, useRangeMetric } from "../hooks/useDashboard";
import { useSSE } from "../hooks/useSSE";
import { useAuth } from "../hooks/useAuth";
import { createShareLink } from "../lib/api";

function latestScalar(
  data: { result: unknown[] } | null
): number | null {
  if (data === null || data.result.length === 0) {
    return null;
  }
  const first = data.result[0] as { value?: { value: number } };
  return first.value?.value ?? null;
}

export function DashboardView({ tenantId }: { tenantId: string }): JSX.Element {
  const { status } = useSSE(tenantId);
  const { token } = useAuth();
  const [activeLabel, setActiveLabel] = useState<string>("default");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
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
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-300" aria-hidden />
            <span className="text-sm font-semibold tracking-tight">Passthrough</span>
            <span className="hidden text-xs text-zinc-500 sm:inline">
              tenant: {tenantId} · {activeLabel}
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

      {token !== null ? (
        <div className="mx-auto mt-4 flex max-w-6xl items-center justify-end px-4 sm:px-6">
          <button
            type="button"
            data-testid="share-button"
            disabled={sharing}
            onClick={() => {
              void (async () => {
                setSharing(true);
                setShareError(null);
                try {
                  const link = await createShareLink(tenantId);
                  setShareUrl(`${window.location.origin}${link.url}`);
                  try {
                    await navigator.clipboard.writeText(`${window.location.origin}${link.url}`);
                  } catch {
                    // Clipboard unavailable — the URL is still shown below.
                  }
                } catch (err) {
                  setShareError(err instanceof Error ? err.message : "Failed to create share link");
                } finally {
                  setSharing(false);
                }
              })();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <Share2 className="h-3.5 w-3.5" aria-hidden />
            {sharing ? "Creating…" : "Share read-only view"}
          </button>
        </div>
      ) : null}
      {shareUrl !== null ? (
        <div className="mx-auto mt-2 flex max-w-6xl px-4 sm:px-6">
          <p className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200" role="status">
            Share link copied to clipboard: <span className="font-mono break-all">{shareUrl}</span>
          </p>
        </div>
      ) : null}
      {shareError !== null ? (
        <div className="mx-auto mt-2 flex max-w-6xl px-4 sm:px-6">
          <p className="w-full rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300" role="alert">
            {shareError}
          </p>
        </div>
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
          <GaugeCard title="CPU Utilization" percent={cpuPercent} level={levelFor(cpuPercent)} />
          <GaugeCard title="RAM Utilization" percent={ramPercent} level={levelFor(ramPercent)} />
        </section>

        <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SparkLineCard
            title="Network RX"
            unit="bytes/s"
            series={netRx.series}
            stroke="#34d399"
          />
          <SparkLineCard
            title="Network TX"
            unit="bytes/s"
            series={netTx.series}
            stroke="#60a5fa"
          />
        </section>

        {hostsUp.data !== null && hostsUp.data.result.length > 0 ? (
          <section className="mt-6 overflow-hidden rounded-xl border border-zinc-800/80" data-testid="hosts-table">
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
                      <td className="px-4 py-2 font-mono text-zinc-200">
                        {item.metric?.instance ?? "unknown"}
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
