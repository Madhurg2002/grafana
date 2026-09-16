import { Activity } from "lucide-react";
import { motion } from "framer-motion";
import type { StreamStatus } from "../hooks/useSSE";

const STYLES: Record<StreamStatus, { label: string; className: string; dot: string }> = {
  live: {
    label: "Live",
    className: "border-emerald-500/40 text-emerald-300 shadow-glow-emerald",
    dot: "bg-emerald-400",
  },
  connecting: {
    label: "Connecting",
    className: "border-amber-500/40 text-amber-300 shadow-glow-amber",
    dot: "bg-amber-400 animate-pulse",
  },
  disconnected: {
    label: "Disconnected",
    className: "border-rose-500/40 text-rose-300 shadow-glow-rose",
    dot: "bg-rose-400",
  },
};

export function HealthBadge({ status }: { status: StreamStatus }): JSX.Element {
  const style = STYLES[status];
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`inline-flex items-center gap-2 rounded-full border bg-zinc-900/60 px-3 py-1 text-xs font-medium backdrop-blur-md ${style.className}`}
      data-testid="health-badge"
    >
      <Activity className="h-3.5 w-3.5" aria-hidden />
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />
      <span>{style.label}</span>
    </motion.div>
  );
}
