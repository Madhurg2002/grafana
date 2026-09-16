import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";
import { motion } from "framer-motion";
import type { StatusLevel } from "./StatusCard";

const LEVEL_COLORS: Record<StatusLevel, string> = {
  emerald: "#34d399",
  amber: "#fbbf24",
  rose: "#fb7185",
};

export interface GaugeCardProps {
  title: string;
  percent: number;
  level: StatusLevel;
}

function levelFor(percent: number): StatusLevel {
  if (percent >= 90) return "rose";
  if (percent >= 75) return "amber";
  return "emerald";
}

export function GaugeCard({ title, percent, level }: GaugeCardProps): JSX.Element {
  const resolved = level ?? levelFor(percent);
  const clamped = Math.max(0, Math.min(100, percent));
  const data = [{ name: title, value: clamped, fill: LEVEL_COLORS[resolved] }];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="glass-card p-5"
      data-testid="gauge-card"
    >
      <span className="text-xs uppercase tracking-wider text-zinc-400">{title}</span>
      <div className="relative mt-2 h-36">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={data}
            innerRadius="72%"
            outerRadius="100%"
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
        <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-1">
          <span
            className="text-2xl font-semibold tabular-nums"
            style={{ color: LEVEL_COLORS[resolved] }}
          >
            {clamped.toFixed(1)}%
          </span>
        </div>
      </div>
    </motion.div>
  );
}
