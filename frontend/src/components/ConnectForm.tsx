import { useState, type FormEvent } from "react";
import { Plug } from "lucide-react";
import { motion } from "framer-motion";
import { connectTenant, type ConnectResponse } from "../lib/api";

export interface ConnectFormProps {
  onConnected: (tenantId: string) => void;
}

export function ConnectForm({ onConnected }: ConnectFormProps): JSX.Element {
  const [tenantId, setTenantId] = useState("");
  const [prometheusUrl, setPrometheusUrl] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ConnectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const response = await connectTenant(tenantId, prometheusUrl, authToken || undefined);
      setResult(response);
      if (response.ok) {
        onConnected(tenantId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/40";

  return (
    <motion.form
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="glass-card w-full max-w-md p-6"
      data-testid="connect-form"
    >
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-emerald-300" aria-hidden />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Connect Prometheus
        </h2>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor="tenantId" className="mb-1 block text-xs text-zinc-400">
            Tenant ID
          </label>
          <input
            id="tenantId"
            className={inputClass}
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="my-team"
            required
            minLength={1}
          />
        </div>
        <div>
          <label htmlFor="prometheusUrl" className="mb-1 block text-xs text-zinc-400">
            Prometheus URL
          </label>
          <input
            id="prometheusUrl"
            type="url"
            className={inputClass}
            value={prometheusUrl}
            onChange={(e) => setPrometheusUrl(e.target.value)}
            placeholder="https://prometheus.example.com"
            required
          />
        </div>
        <div>
          <label htmlFor="authToken" className="mb-1 block text-xs text-zinc-400">
            Auth token <span className="text-zinc-600">(optional, encrypted at rest)</span>
          </label>
          <input
            id="authToken"
            type="password"
            className={inputClass}
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder="bearer token"
            autoComplete="off"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 w-full rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Connecting…" : "Connect"}
      </button>

      {result !== null && (
        <p
          className={`mt-3 text-xs ${result.ok ? "text-emerald-300" : "text-rose-300"}`}
          role="status"
        >
          {result.ok
            ? `Connected in ${result.latencyMs}ms — streaming live data.`
            : `Upstream error: ${result.error ?? "unknown"}`}
        </p>
      )}
      {error !== null && (
        <p className="mt-3 text-xs text-rose-300" role="alert">
          {error}
        </p>
      )}
    </motion.form>
  );
}
