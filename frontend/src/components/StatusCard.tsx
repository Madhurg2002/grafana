import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

export type StatusLevel = "emerald" | "amber" | "rose";

export const LEVEL_STYLES: Record<
  StatusLevel,
  { text: string; shadow: string; border: string }
> = {
  emerald: { text: "text-[#34d399]", shadow: "shadow-glow-emerald", border: "border-[#34d399]/25" },
  amber: { text: "text-[#fbbf24]", shadow: "shadow-glow-amber", border: "border-[#fbbf24]/25" },
  rose: { text: "text-[#fb7185]", shadow: "shadow-glow-rose", border: "border-[#fb7185]/25" },
};

export interface StatusCardProps {
  title: string;
  value: string;
  unit?: string;
  level: StatusLevel;
  icon: LucideIcon;
  subtitle?: string;
  /** Pinned pixel height (user-resized). Content centers vertically. */
  heightPx?: number;
}

export function StatusCard({
  title,
  value,
  unit,
  level,
  icon: Icon,
  subtitle,
  heightPx,
}: StatusCardProps): JSX.Element {
  const style = LEVEL_STYLES[level];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`glass-card flex flex-col justify-center p-5 pl-6 ${style.border} ${style.shadow}`}
      data-testid="status-card"
      {...(heightPx !== undefined ? { style: { height: `${heightPx}px` } } : {})}
    >
      {/* Accent rail — the state reads at a glance without hunting the number. */}
      <span
        aria-hidden
        className={`absolute inset-y-4 left-0 w-[3px] rounded-full bg-current ${style.text}`}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{title}</span>
        <Icon className={`h-4 w-4 ${style.text}`} aria-hidden />
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className={`metric-value text-3xl ${style.text}`}>{value}</span>
        {unit !== undefined && (
          <span className="text-sm font-medium text-[#8d95a8]">{unit}</span>
        )}
      </div>
      {subtitle !== undefined && (
        <p className="mt-2 text-[11px] text-[#5f6779]">{subtitle}</p>
      )}
    </motion.div>
  );
}
