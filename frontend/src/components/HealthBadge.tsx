import { Activity } from "lucide-react";
import { motion } from "framer-motion";
import type { StreamStatus } from "../hooks/useSSE";

const STYLES: Record<
  StreamStatus,
  { label: string; text: string; border: string; dot: string; ring: string }
> = {
  live: {
    label: "Live",
    text: "text-[#7df0dc]",
    border: "border-[#5eead4]/[0.35]",
    dot: "bg-[#5eead4]",
    ring: "shadow-[0_0_16px_-4px_rgba(94,234,212,0.6)]",
  },
  connecting: {
    label: "Connecting",
    text: "text-[#fcd34d]",
    border: "border-[#fbbf24]/[0.35]",
    dot: "bg-[#fbbf24] animate-pulse-dot",
    ring: "",
  },
  disconnected: {
    label: "Disconnected",
    text: "text-[#fda4af]",
    border: "border-[#fb7185]/[0.35]",
    dot: "bg-[#fb7185]",
    ring: "",
  },
};

export function HealthBadge({ status }: { status: StreamStatus }): JSX.Element {
  const style = STYLES[status];
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`inline-flex items-center gap-2 rounded-full border bg-black/40 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] backdrop-blur-md ${style.border} ${style.text} ${style.ring}`}
      data-testid="health-badge"
    >
      <Activity className="h-3.5 w-3.5" aria-hidden />
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />
      <span>{style.label}</span>
    </motion.div>
  );
}
