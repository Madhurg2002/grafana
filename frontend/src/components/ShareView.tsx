import { useEffect, useState } from "react";
import { Radio, Link2Off, Lock } from "lucide-react";
import { motion } from "framer-motion";
import {
  fetchShareAccessToken,
  fetchShareView,
  type ShareViewPayload,
} from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { DashboardView } from "./DashboardView";
import { HealthBadge } from "./HealthBadge";
import { StatusCard } from "./StatusCard";
import { GaugeCard } from "./GaugeCard";
import { SparkLineCard } from "./SparkLineCard";
import { Server } from "lucide-react";
import type { MetricSeries } from "../hooks/types";

type SharePage = NonNullable<ShareViewPayload["pages"]>[number];
type ShareWidget = SharePage["widgets"][number];

/** Renders one composed widget from the snapshot payload. */
function SharedWidget({ widget }: { widget: ShareWidget }): JSX.Element {
  if (widget.kind === "sparkline") {
    const series: MetricSeries[] = widget.series.map((s) => ({
      label: s.label,
      points: s.points,
    }));
    return (
      <SparkLineCard
        title={widget.title}
        unit={widget.unit ?? "value"}
        series={series}
        stroke="#34d399"
      />
    );
  }
  if (widget.kind === "gauge") {
    const percent = Math.max(0, Math.min(100, widget.value ?? 0));
    return <GaugeCard title={widget.title} percent={percent} level={percent >= 90 ? "rose" : percent >= 75 ? "amber" : "emerald"} />;
  }
  // stat widgets render as a status number card.
  return (
    <StatusCard
      title={widget.title}
      value={widget.value === null ? "—" : Number(widget.value.toFixed(2)).toString()}
      unit={widget.unit ?? undefined}
      level="emerald"
      icon={Server}
    />
  );
}

/** One composed page: its widgets laid out by span, hosts table inline. */
function SharedPage({ page, hostRows }: { page: SharePage; hostRows: ShareViewPayload["metrics"]["hosts"] }): JSX.Element {
  const spanClass = (span: number): string =>
    span >= 3 ? "md:col-span-2 lg:col-span-3" : span === 2 ? "md:col-span-2" : "";
  const hostTables = page.widgets.filter((w) => w.kind === "hosts_table");
  const charts = page.widgets.filter((w) => w.kind !== "hosts_table");
  return (
    <div>
      {charts.length > 0 ? (
        <section
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
          data-testid="share-page-grid"
        >
          {charts.map((widget) => (
            <div key={widget.id} className={spanClass(widget.span)}>
              <SharedWidget widget={widget} />
            </div>
          ))}
        </section>
      ) : null}
      {hostTables.length > 0 && hostRows.length > 0 ? (
        <section className="mt-4 overflow-hidden rounded-xl border border-white/[0.075] bg-white/[0.02]">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] text-[#8d95a8]">
              <tr>
                <th className="px-4 py-2 font-medium">Instance</th>
                <th className="px-4 py-2 font-medium">Job</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {hostRows.map((host) => (
                <tr key={`${host.job}/${host.instance}`} className="border-t border-white/[0.06] transition hover:bg-white/[0.02]">
                  <td className="px-4 py-2 font-mono text-[#c3cad8]">{host.instance}</td>
                  <td className="px-4 py-2 text-[#8d95a8]">{host.job}</td>
                  <td className="px-4 py-2">
                    <span className={host.up === 1 ? "font-medium text-[#34d399]" : "font-medium text-[#fb7185]"}>
                      {host.up === 1 ? "up" : "down"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Public read-only dashboard rendered from a share link.
 * Fetches the snapshot from /api/share/:id/view — no auth required.
 */
export function ShareView({ id }: { id: string }): JSX.Element {
  const { setTenantToken } = useAuth();
  const [data, setData] = useState<ShareViewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [editToken, setEditToken] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        let token = accessToken;
        // Public links should not make a protected token request. Try the
        // public snapshot first and only exchange a signed-in session when
        // the link explicitly reports that access is restricted.
        try {
          const payload = await fetchShareView(id, token ?? undefined);
          if (payload.canEdit === true && editToken === null) {
            const access = await fetchShareAccessToken(id);
            const nextEditToken = access.editToken ?? access.token;
            setTenantToken(nextEditToken);
            setEditToken(nextEditToken);
          }
          if (!cancelled) {
            setData(payload);
            setRestricted(false);
          }
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : "";
          if (!/restricted|allow-list|403/i.test(message)) {
            throw err;
          }
        }

        // Email-restricted links: exchange the signed-in session for a
        // short-lived view token, re-minting when it expires (1h TTL).
        const access = await fetchShareAccessToken(id);
        if (access.canEdit === true) {
          const nextEditToken = access.editToken ?? access.token;
          setTenantToken(nextEditToken);
          setEditToken(nextEditToken);
        }
        const viewToken = access.viewToken ?? access.token;
        if (!cancelled) {
          setAccessToken(viewToken);
        }
        token = viewToken;
        const payload = await fetchShareView(id, token);
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
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#fb7185]/30 bg-[#fb7185]/10">
          <Link2Off className="h-5 w-5 text-[#fb7185]" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold tracking-tight text-white">Share link unavailable</h1>
        <p className="max-w-sm text-sm text-[#8d95a8]">{error}</p>
      </div>
    );
  }

  if (restricted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#fbbf24]/30 bg-[#fbbf24]/10">
          <Lock className="h-5 w-5 text-[#fbbf24]" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold tracking-tight text-white">This dashboard is restricted</h1>
        <p className="max-w-sm text-sm text-[#8d95a8]">
          Only invited people can open this share. Sign in with an allow-listed
          email or an account in the owning organization, then reload.
        </p>
        <a
          href="/login"
          className="btn btn-primary px-4 py-2 text-sm"
        >
          Sign in
        </a>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[#8d95a8]">
        Loading shared dashboard…
      </div>
    );
  }

  if (data.canEdit === true && editToken !== null) {
    return <DashboardView tenantId={data.tenantId} embedded />;
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
  const pages = data.pages ?? [];
  // Keep the active tab valid when the snapshot refreshes; default to home.
  const activePage =
    pages.find((p) => p.id === activePageId) ?? pages.find((p) => p.isHome) ?? pages[0] ?? null;

  return (
    <div className="min-h-screen">
      <header className="chrome-bar sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-[#5eead4]/30 bg-[#5eead4]/10 text-[#5eead4]">
              <Radio className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="text-sm font-semibold tracking-tight">Passthrough</span>
            <span className="hidden text-xs text-[#8d95a8] sm:inline">
              shared view{data.label !== null ? ` · ${data.label}` : ""}
            </span>
          </div>
          <HealthBadge status="live" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {pages.length > 0 ? (
          <>
            {pages.length > 1 ? (
              <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Shared pages">
                {pages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    role="tab"
                    aria-selected={activePage?.id === page.id}
                    title={`Show the “${page.name}” page`}
                    className={`btn text-xs ${
                      activePage?.id === page.id
                        ? "border border-[#5eead4]/30 bg-[#5eead4]/10 text-[#7df0dc]"
                        : "border border-white/[0.09] text-[#8d95a8] hover:border-white/20 hover:text-white"
                    }`}
                    onClick={() => setActivePageId(page.id)}
                  >
                    {page.name}
                  </button>
                ))}
              </div>
            ) : null}
            {activePage !== null ? (
              <SharedPage page={activePage} hostRows={data.metrics.hosts} />
            ) : null}
          </>
        ) : (
          <>
            {/* Pre-pages fallback: the fixed built-in layout. */}
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
              <section className="mt-4 overflow-hidden rounded-xl border border-white/[0.075] bg-white/[0.02]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.03] text-[#8d95a8]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Instance</th>
                      <th className="px-4 py-2 font-medium">Job</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.metrics.hosts.map((host) => (
                      <tr key={`${host.job}/${host.instance}`} className="border-t border-white/[0.06] transition hover:bg-white/[0.02]">
                        <td className="px-4 py-2 font-mono text-[#c3cad8]">{host.instance}</td>
                        <td className="px-4 py-2 text-[#8d95a8]">{host.job}</td>
                        <td className="px-4 py-2">
                          <span className={host.up === 1 ? "font-medium text-[#34d399]" : "font-medium text-[#fb7185]"}>
                            {host.up === 1 ? "up" : "down"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
          </>
        )}

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-8 text-center text-[11px] text-[#5f6779]"
        >
          {data.canEdit === true ? "Editable shared dashboard" : "Read-only shared snapshot"} · generated{" "}
          {new Date(data.generatedAt).toLocaleString()}
        </motion.p>
      </main>
    </div>
  );
}
