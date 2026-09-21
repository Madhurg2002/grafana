import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";
import { motion } from "framer-motion";
import { Download } from "lucide-react";
import { LEVEL_STYLES, type StatusLevel } from "./StatusCard";

const LEVEL_COLORS: Record<StatusLevel, string> = {
  emerald: "#34d399",
  amber: "#fbbf24",
  rose: "#fb7185",
};

export interface GaugeCardProps {
  title: string;
  percent: number;
  level: StatusLevel;
  /** The PromQL behind this gauge — surfaced as a hover formula tooltip. */
  query?: string;
  /** Fires when the user downloads this gauge's current value as CSV. */
  onExportCsv?: (title: string, percent: number) => void;
  /** Pinned pixel height for the dial box (user-resized). Overrides the 2:1 aspect. */
  heightPx?: number;
}

function levelFor(percent: number): StatusLevel {
  if (percent >= 90) return "rose";
  if (percent >= 75) return "amber";
  return "emerald";
}

export function GaugeCard({ title, percent, level, query, onExportCsv, heightPx }: GaugeCardProps): JSX.Element {
  const resolved = level ?? levelFor(percent);
  const clamped = Math.max(0, Math.min(100, percent));
  const data = [{ name: title, value: clamped, fill: LEVEL_COLORS[resolved] }];
  const chrome = LEVEL_STYLES[resolved];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className={`glass-card p-4 ${chrome.border} ${chrome.shadow}`}
      data-testid="gauge-card"
    >
      <div className="flex items-center justify-between">
        <span
          className="block truncate text-xs uppercase tracking-wider text-zinc-400"
          title={query !== undefined ? `${title} — ${query}` : title}
        >
          {title}
        </span>
        {onExportCsv !== undefined ? (
          <button
            type="button"
            data-testid="gauge-csv"
            title="Download this gauge's current value as CSV"
            aria-label={`Download ${title} as CSV`}
            className="rounded p-1 text-zinc-600 transition hover:bg-zinc-800/60 hover:text-zinc-300"
            onClick={() => onExportCsv(title, clamped)}
          >
            <Download className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
      </div>
      {/* 2:1 box = a semicircle's natural bounding box. Recharts caps the
          radius at min(w,h)/2 and resolves % radii against it, so in a wide
          short box the dial would shrink and hug the bottom (the "tiny gauge
          in a big card" bug). With aspect 2:1 and 200% outer radius the arc
          fills the full box on every card width; max-w keeps dials equal
          across grid sizes. */}
      <div
        className={`relative mx-auto mt-2 w-full ${heightPx !== undefined ? "" : "aspect-[2/1] max-w-[15rem]"}`}
        style={
          heightPx !== undefined
            ? { height: `${heightPx}px`, maxWidth: `${Math.round(heightPx * 2)}px` }
            : undefined
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={data}
            innerRadius="144%"
            outerRadius="200%"
            cy="100%"
            startAngle={180}
            endAngle={0}
            barSize={14}
          >
            <PolarAngleAxis
              type="number"
              domain={[0, 100]}
              angleAxisId={0}
              tick={false}
            />
            <RadialBar background={{ fill: "#27272a" }} dataKey="value" cornerRadius={8} />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center pb-0.5">
        <span
          className="text-xl font-semibold tabular-nums"
          style={{ color: LEVEL_COLORS[resolved] }}
        >
          {clamped.toFixed(1)}%
        </span>
      </div>
    </motion.div>
  );
}
