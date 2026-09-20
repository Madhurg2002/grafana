import { useState, type FormEvent } from "react";
import { Plug, BarChart3, LineChart } from "lucide-react";
import { motion } from "framer-motion";
import { connectTenant, type ConnectResponse } from "../lib/api";

export type UpstreamFlavor = "prometheus" | "grafana" | "auto";

export interface ConnectFormProps {
  /** Fires after a successful connect; carries the scoped tenant token. */
  onConnected: (tenantId: string, tenantToken?: string) => void;
  /** When set (signed-in users), the tenant is fixed and hidden from the form. */
  fixedTenantId?: string;
}

export function ConnectForm({ onConnected, fixedTenantId }: ConnectFormProps): JSX.Element {
  const [tenantId, setTenantId] = useState(fixedTenantId ?? "");
  const [prometheusUrl, setPrometheusUrl] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [flavor, setFlavor] = useState<UpstreamFlavor>("auto");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ConnectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedOnce, setFailedOnce] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const response = await connectTenant(
        tenantId,
        prometheusUrl,
        authToken || undefined,
        flavor === "auto" ? undefined : flavor
      );
      setResult(response);
      if (response.ok) {
        setFailedOnce(false);
        onConnected(tenantId, response.tenantToken);
      } else {
        setFailedOnce(true);
      }
    } catch (err) {
      setFailedOnce(true);
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
          Connect your monitoring stack
        </h2>
      </div>

      {/* Prometheus / Grafana / Auto toggle — narrows the fields shown. */}
      <div
        className="mt-4 grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-1"
        role="tablist"
        aria-label="Upstream type"
      >
        {(
          [
            { key: "auto", label: "Auto" },
            { key: "prometheus", label: "Prometheus" },
            { key: "grafana", label: "Grafana" },
          ] as Array<{ key: UpstreamFlavor; label: string }>
        ).map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={flavor === option.key}
            data-testid={`flavor-${option.key}`}
            onClick={() => setFlavor(option.key)}
            className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
              flavor === option.key
                ? "bg-emerald-500/15 text-emerald-300"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {option.key === "grafana" ? (
              <BarChart3 className="h-3.5 w-3.5" aria-hidden />
            ) : option.key === "prometheus" ? (
              <LineChart className="h-3.5 w-3.5" aria-hidden />
            ) : null}
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        {fixedTenantId === undefined ? (
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
        ) : null}
        <div>
          <label htmlFor="prometheusUrl" className="mb-1 block text-xs text-zinc-400">
            Prometheus or Grafana URL <span className="text-zinc-600">(auto-detected)</span>
          </label>
          <input
            id="prometheusUrl"
            type="text"
            inputMode="url"
            className={inputClass}
            value={prometheusUrl}
            onChange={(e) => setPrometheusUrl(e.target.value)}
            placeholder="prometheus.internal:9090 · https://prom.example.com · grafana link"
            required
          />
          <p className="mt-1 text-[11px] text-zinc-600">
            Bare <span className="font-mono">ip:port</span> works (http:// is
            added automatically); pasting a Grafana dashboard link is fine — the
            mount path is detected for you.
          </p>
        </div>
        <div>
          <label htmlFor="authToken" className="mb-1 block text-xs text-zinc-400">
            {flavor === "grafana"
              ? "Grafana service-account token "
              : flavor === "prometheus"
                ? "Prometheus bearer token "
                : "Auth token "}
            <span className="text-zinc-600">
              (
              {flavor === "grafana"
                ? "required for Grafana — Administration → Service accounts"
                : "optional, encrypted at rest"}
              )
            </span>
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

      {!failedOnce ? (
        <button
          type="button"
          data-testid="demo-connect"
          title="Fill in the public demo Prometheus — real live metrics, nothing to install"
          className="mt-2 w-full text-center text-xs text-zinc-500 underline-offset-2 transition hover:text-zinc-300 hover:underline"
          onClick={() => {
            setPrometheusUrl("https://prometheus.demo.prometheus.io");
            setAuthToken("");
          }}
        >
          No URL handy? Explore with the public demo Prometheus
        </button>
      ) : null}

      {failedOnce ? (
        <button
          type="button"
          className="mt-2 w-full text-center text-xs text-zinc-500 underline-offset-2 transition hover:text-zinc-300 hover:underline"
          onClick={() => {
            setPrometheusUrl("https://prometheus.demo.prometheus.io");
            setAuthToken("");
          }}
        >
          Try the public demo Prometheus
        </button>
      ) : null}

      {result !== null && (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            result.ok
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
              : "border-rose-500/40 bg-rose-500/10 text-rose-300"
          }`}
          role="status"
        >
          {result.ok ? (
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 font-semibold">
                {result.upstreamType === "grafana" ? (
                  <>
                    <BarChart3 className="h-3.5 w-3.5" aria-hidden />
                    Grafana connected — routing through its Prometheus datasource
                  </>
                ) : (
                  <>
                    <LineChart className="h-3.5 w-3.5" aria-hidden />
                    Prometheus connected
                  </>
                )}
              </span>
              <span className="text-emerald-400/80">
                {result.detail ?? "Streaming live data."} · {result.latencyMs}ms
              </span>
            </span>
          ) : (
            <span>Upstream error: {result.error ?? "unknown"}</span>
          )}
        </div>
      )}
      {error !== null && (
        <div className="mt-3" role="alert">
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            Double-check the URL and that it's reachable from the internet —
            private/internal hostnames can't be reached. Need data fast? Use the
            demo link below.
          </p>
        </div>
      )}
    </motion.form>
  );
}
