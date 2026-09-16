import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import { motion } from "framer-motion";
import type { MetricSeries } from "../hooks/types";

export interface SparkLineCardProps {
  title: string;
  unit?: string;
  series: MetricSeries[];
  stroke: string;
}

function formatBytes(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} GB/s`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB/s`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB/s`;
  return `${value.toFixed(0)} B/s`;
}

export function SparkLineCard({
  title,
  unit,
  series,
  stroke,
}: SparkLineCardProps): JSX.Element {
  const points = series.flatMap((s) =>
    s.points.map((p) => ({ timestamp: p.timestamp, value: p.value }))
  );
  const latest = points.length > 0 ? points[points.length - 1]?.value ?? 0 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="glass-card p-5"
      data-testid="sparkline-card"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-zinc-400">{title}</span>
        <span className="text-sm font-medium tabular-nums text-zinc-200">
          {unit === "bytes/s" ? formatBytes(latest) : latest.toFixed(2)}
        </span>
      </div>
      <div className="mt-3 h-28">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`grad-${title.replace(/\s+/g, "-")}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip
              cursor={{ stroke: "#3f3f46", strokeWidth: 1 }}
              contentStyle={{
                background: "rgba(24,24,27,0.9)",
                border: "1px solid #3f3f46",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(label: number) =>
                new Date(label).toLocaleTimeString()
              }
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={stroke}
              strokeWidth={2}
              fill={`url(#grad-${title.replace(/\s+/g, "-")})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
