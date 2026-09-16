import { useState } from "react";
import { Radio } from "lucide-react";
import { motion } from "framer-motion";
import { ConnectForm } from "./components/ConnectForm";
import { DashboardView } from "./components/DashboardView";

export default function App(): JSX.Element {
  const [tenantId, setTenantId] = useState<string | null>(null);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      {tenantId === null ? (
        <div className="flex w-full flex-col items-center gap-6">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-2 text-center"
          >
            <div className="flex items-center gap-2">
              <Radio className="h-6 w-6 text-emerald-300" aria-hidden />
              <h1 className="text-2xl font-bold tracking-tight">Passthrough</h1>
            </div>
            <p className="max-w-md text-sm text-zinc-400">
              Mobile-first Prometheus monitoring without Grafana. Connect your
              endpoint, and stream normalized host telemetry in real time.
            </p>
          </motion.div>
          <ConnectForm onConnected={setTenantId} />
        </div>
      ) : (
        <DashboardView tenantId={tenantId} />
      )}
    </div>
  );
}
