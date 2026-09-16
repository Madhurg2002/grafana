import {
  Cpu,
  MemoryStick,
  Radio,
  Server,
} from "lucide-react";
import { motion } from "framer-motion";
import { HealthBadge } from "./HealthBadge";
import { StatusCard } from "./StatusCard";
import { GaugeCard } from "./GaugeCard";
import { SparkLineCard } from "./SparkLineCard";
import { DEFAULT_QUERIES, useInstantMetric, useRangeMetric } from "../hooks/useDashboard";
import { useSSE } from "../hooks/useSSE";

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
              tenant: {tenantId}
            </span>
          </div>
          <HealthBadge status={status} />
        </div>
      </header>

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
