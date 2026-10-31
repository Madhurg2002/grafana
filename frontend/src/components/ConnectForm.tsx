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

  const inputClass = "field";

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
        <Plug className="h-4 w-4 text-[#5eead4]" aria-hidden />
        <h2 className="eyebrow text-[#c3cad8]">Connect your monitoring stack</h2>
      </div>

      {/* Prometheus / Grafana / Auto toggle — narrows the fields shown. */}
      <div
        className="segmented mt-4 grid-cols-3"
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
            className={`segmented-item ${
              flavor === option.key ? "segmented-item-active" : ""
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
            <label htmlFor="tenantId" className="field-label">
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
          <label htmlFor="prometheusUrl" className="field-label">
            Prometheus or Grafana URL <span className="text-[#5f6779]">(auto-detected)</span>
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
          <p className="mt-1.5 text-[11px] leading-relaxed text-[#5f6779]">
            Bare <span className="font-mono">ip:port</span> works (http:// is
            added automatically); pasting a Grafana dashboard link is fine — the
            mount path is detected for you.
          </p>
        </div>
        <div>
          <label htmlFor="authToken" className="field-label">
            {flavor === "grafana"
              ? "Grafana service-account token "
              : flavor === "prometheus"
                ? "Prometheus bearer token "
                : "Auth token "}
            <span className="normal-case tracking-normal text-[#5f6779]">
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
        className="btn btn-primary mt-6 w-full px-4 py-2.5 text-sm"
      >
        {submitting ? "Connecting…" : "Connect"}
      </button>

      {!failedOnce ? (
        <button
          type="button"
          data-testid="demo-connect"
          title="Fill in the public demo Prometheus — real live metrics, nothing to install"
          className="btn btn-quiet mt-2 w-full text-[11px] underline-offset-2 hover:underline"
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
          className="btn btn-quiet mt-2 w-full text-[11px] underline-offset-2 hover:underline"
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
              ? "border-[#5eead4]/30 bg-[#5eead4]/5 text-[#7df0dc]"
              : "border-[#fb7185]/40 bg-[#fb7185]/10 text-[#fda4af]"
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
              <span className="text-[#8d95a8]">
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
          <p className="rounded-lg border border-[#fb7185]/40 bg-[#fb7185]/10 px-3 py-2 text-xs text-[#fda4af]">
            {error}
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[#8d95a8]">
            Double-check the URL and that it's reachable from the internet —
            private/internal hostnames can't be reached. Need data fast? Use the
            demo link below.
          </p>
        </div>
      )}
    </motion.form>
  );
}
