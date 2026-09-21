import {
  Area,
  AreaChart,
  XAxis,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import { motion } from "framer-motion";
import { Download } from "lucide-react";
import type { MetricSeries } from "../hooks/types";
import { csvFilename, downloadCsv } from "../lib/csv";

export interface SparkLineCardProps {
  title: string;
  unit?: string;
  series: MetricSeries[];
  stroke: string;
  /** The PromQL behind this card — surfaced as a hover formula tooltip. */
  query?: string;
  /** Pinned pixel height (user-resized). Defaults to the classic 112px chart. */
  heightPx?: number;
}

/** Flattens series rows into timestamp×label CSV rows and downloads them. */
function exportSeriesCsv(
  title: string,
  series: MetricSeries[],
  unit?: string
): void {
  const labels = series.map((s, i) => (s.label === "series" ? `series_${i}` : s.label));
  const timestamps = Array.from(
    new Set(series.flatMap((s) => s.points.map((p) => p.timestamp)))
  ).sort((a, b) => a - b);
  const byTs = new Map<number, Record<string, string | number>>();
  for (const ts of timestamps) {
    byTs.set(ts, {
      timestamp: new Date(ts).toISOString(),
      ...(unit !== undefined && unit.length > 0 ? { unit } : {}),
    });
  }
  series.forEach((s, i) => {
    for (const point of s.points) {
      const row = byTs.get(point.timestamp);
      if (row !== undefined) {
        row[labels[i] ?? `series_${i}`] = point.value;
      }
    }
  });
  downloadCsv(csvFilename(title), Array.from(byTs.values()));
}

function formatBytes(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} GB/s`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB/s`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB/s`;
  return `${value.toFixed(0)} B/s`;
}

export function formatMetricValue(value: number, unit?: string): string {
  if (unit === "bytes/s") {
    return formatBytes(value);
  }
  const rounded = Number.isInteger(value) ? value.toString() : value.toFixed(2);
  return unit !== undefined && unit.length > 0 ? `${rounded} ${unit}` : rounded;
}

export function formatChartTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SparkLineCard({
  title,
  unit,
  series,
  stroke,
  query,
  heightPx,
}: SparkLineCardProps): JSX.Element {
  const chartData = Array.from(
    series.reduce((rows, current, index) => {
      const key = `series_${index}`;
      for (const point of current.points) {
        const row = rows.get(point.timestamp) ?? { timestamp: point.timestamp };
        row[key] = point.value;
        rows.set(point.timestamp, row);
      }
      return rows;
    }, new Map<number, { timestamp: number; [key: string]: number }>()).values()
  ).sort((a, b) => a.timestamp - b.timestamp);
  const latest = series.reduce((latestValue, current) => {
    const point = current.points[current.points.length - 1];
    return point !== undefined ? Math.max(latestValue, point.value) : latestValue;
  }, 0);
  const lineColors = [stroke, "#60a5fa", "#fbbf24", "#f472b6", "#a78bfa", "#38bdf8"];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="glass-card p-5"
      data-testid="sparkline-card"
    >
      <div className="flex items-center justify-between">
        <span
          className="truncate text-xs uppercase tracking-wider text-zinc-400"
          title={query !== undefined ? `${title} — ${query}` : title}
        >
          {title}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium tabular-nums text-zinc-200">
            {formatMetricValue(latest, unit)}
          </span>
          {series.length > 0 ? (
            <button
              type="button"
              data-testid="sparkline-csv"
              title="Download this series as CSV"
              aria-label={`Download ${title} as CSV`}
              className="rounded p-1 text-zinc-600 transition hover:bg-zinc-800/60 hover:text-zinc-300"
              onClick={() => exportSeriesCsv(title, series, unit)}
            >
              <Download className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
        </span>
      </div>
      <div
        className="mt-3"
        style={heightPx !== undefined ? { height: `${heightPx}px` } : { height: 112 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`grad-${title.replace(/\s+/g, "-")}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={["dataMin", "dataMax"]}
              hide
            />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip
              cursor={{ stroke: "#3f3f46", strokeWidth: 1 }}
              contentStyle={{
                background: "rgba(24,24,27,0.9)",
                border: "1px solid #3f3f46",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(label: number) => formatChartTime(label)}
              formatter={(value: number, name: string) => [
                formatMetricValue(value, unit),
                name,
              ]}
            />
            {series.map((current, index) => (
              <Area
                key={`${current.label}-${index}`}
                type="monotone"
                dataKey={`series_${index}`}
                name={current.label}
                stroke={lineColors[index % lineColors.length]}
                strokeWidth={2}
                fill={index === 0 ? `url(#grad-${title.replace(/\s+/g, "-")})` : "none"}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
