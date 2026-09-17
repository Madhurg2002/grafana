import { useEffect, useState } from "react";
import { Radio, Link2Off, Lock } from "lucide-react";
import { motion } from "framer-motion";
import {
  fetchShareAccessToken,
  fetchShareView,
  type ShareViewPayload,
} from "../lib/api";
import { HealthBadge } from "./HealthBadge";
import { StatusCard } from "./StatusCard";
import { GaugeCard } from "./GaugeCard";
import { SparkLineCard } from "./SparkLineCard";
import { Server } from "lucide-react";
import type { MetricSeries } from "../hooks/types";

/**
 * Public read-only dashboard rendered from a share link.
 * Fetches the snapshot from /api/share/:id/view — no auth required.
 */
export function ShareView({ id }: { id: string }): JSX.Element {
  const [data, setData] = useState<ShareViewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        // Email-restricted links: exchange the signed-in session for a
        // short-lived view token, re-minting when it expires (1h TTL) so a
        // long-lived tab never degrades into a false "restricted" screen.
        let token = accessToken;
        if (token !== null) {
          const payload = await fetchShareView(id, token);
          if (!cancelled) {
            setData(payload);
            setRestricted(false);
          }
          return;
        }
        try {
          const access = await fetchShareAccessToken(id);
          if (!cancelled) {
            setAccessToken(access.token);
          }
          token = access.token;
        } catch {
          // Signed out or not allow-listed — the view fetch decides below.
        }
        const payload = await fetchShareView(id, token ?? undefined);
        if (!cancelled) {
          setData(payload);
          setRestricted(false);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to load share view";
          if (/restricted|allow-list|403/i.test(message)) {
            // The token may simply have expired — clear it so the next
            // refresh re-mints from the session instead of staying stuck.
            setAccessToken(null);
            setRestricted(true);
          } else {
            setError(message);
          }
        }
      }
    }
    void load();
    // Refresh the snapshot every 30s while the tab is open.
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // accessToken intentionally omitted: refresh it only on remount (1h TTL).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error !== null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
        <Link2Off className="h-8 w-8 text-rose-400" aria-hidden />
        <h1 className="text-lg font-semibold">Share link unavailable</h1>
        <p className="max-w-sm text-sm text-zinc-400">{error}</p>
      </div>
    );
  }

  if (restricted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
        <Lock className="h-8 w-8 text-amber-300" aria-hidden />
        <h1 className="text-lg font-semibold">This dashboard is restricted</h1>
        <p className="max-w-sm text-sm text-zinc-400">
          Only allow-listed email addresses can open this share. Sign in with an
          invited address and reload this page.
        </p>
        <a
          href="/login"
          className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
        >
          Sign in
        </a>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">
        Loading shared dashboard…
      </div>
    );
  }

  function levelFor(percent: number): "emerald" | "amber" | "rose" {
    if (percent >= 90) return "rose";
    if (percent >= 75) return "amber";
    return "emerald";
  }

  const cpu = data.metrics.cpuPercent ?? 0;
  const ram = data.metrics.ramPercent ?? 0;
  const rxSeries: MetricSeries[] = data.metrics.networkRxSeries ?? [];
  const txSeries: MetricSeries[] = data.metrics.networkTxSeries ?? [];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-300" aria-hidden />
            <span className="text-sm font-semibold tracking-tight">Passthrough</span>
            <span className="hidden text-xs text-zinc-500 sm:inline">
              shared view{data.label !== null ? ` · ${data.label}` : ""}
            </span>
          </div>
          <HealthBadge status="live" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatusCard
            title="Hosts Up"
            value={String(data.metrics.hostsUp)}
            unit={`/ ${data.metrics.hostsTotal}`}
            level={data.metrics.hostsUp > 0 ? "emerald" : "rose"}
            icon={Server}
            subtitle="Snapshot refreshed every 30s"
          />
          <GaugeCard title="CPU Utilization" percent={cpu} level={levelFor(cpu)} />
          <GaugeCard title="RAM Utilization" percent={ram} level={levelFor(ram)} />
        </section>

        {rxSeries.length > 0 || txSeries.length > 0 ? (
          <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SparkLineCard
              title="Network RX"
              unit="bytes/s"
              series={rxSeries}
              stroke="#34d399"
            />
            <SparkLineCard
              title="Network TX"
              unit="bytes/s"
              series={txSeries}
              stroke="#60a5fa"
            />
          </section>
        ) : null}

        {data.metrics.hosts.length > 0 ? (
          <section className="mt-4 overflow-hidden rounded-xl border border-zinc-800/80">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-900/70 text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Instance</th>
                  <th className="px-4 py-2 font-medium">Job</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.metrics.hosts.map((host) => (
                  <tr key={`${host.job}/${host.instance}`} className="border-t border-zinc-800/60">
                    <td className="px-4 py-2 font-mono text-zinc-200">{host.instance}</td>
                    <td className="px-4 py-2 text-zinc-400">{host.job}</td>
                    <td className="px-4 py-2">
                      <span className={host.up === 1 ? "text-emerald-300" : "text-rose-300"}>
                        {host.up === 1 ? "up" : "down"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-6 text-center text-[11px] text-zinc-600"
        >
          Read-only shared snapshot · generated {new Date(data.generatedAt).toLocaleString()}
        </motion.p>
      </main>
    </div>
  );
}
