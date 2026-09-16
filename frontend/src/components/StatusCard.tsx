import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

export type StatusLevel = "emerald" | "amber" | "rose";

const LEVEL_STYLES: Record<StatusLevel, { text: string; shadow: string; border: string }> = {
  emerald: { text: "text-emerald-300", shadow: "shadow-glow-emerald", border: "border-emerald-500/30" },
  amber: { text: "text-amber-300", shadow: "shadow-glow-amber", border: "border-amber-500/30" },
  rose: { text: "text-rose-300", shadow: "shadow-glow-rose", border: "border-rose-500/30" },
};

export interface StatusCardProps {
  title: string;
  value: string;
  unit?: string;
  level: StatusLevel;
  icon: LucideIcon;
  subtitle?: string;
}

export function StatusCard({
  title,
  value,
  unit,
  level,
  icon: Icon,
  subtitle,
}: StatusCardProps): JSX.Element {
  const style = LEVEL_STYLES[level];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`glass-card p-5 ${style.border} ${style.shadow}`}
      data-testid="status-card"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-zinc-400">{title}</span>
        <Icon className={`h-4 w-4 ${style.text}`} aria-hidden />
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className={`text-3xl font-semibold tabular-nums ${style.text}`}>{value}</span>
        {unit !== undefined && (
          <span className="text-sm text-zinc-400">{unit}</span>
        )}
      </div>
      {subtitle !== undefined && (
        <p className="mt-2 text-xs text-zinc-500">{subtitle}</p>
      )}
    </motion.div>
  );
}
