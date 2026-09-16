import { useCallback, useEffect, useState } from "react";
import { instantQuery, rangeQuery, type QueryResponseBody } from "../lib/api";
import type { MetricSeries } from "./types";

export interface DashboardQueries {
  cpu: string;
  ram: string;
  networkRx: string;
  networkTx: string;
  hostsUp: string;
}

/** Default safe queries — the backend normalizer enforces all safety laws. */
export const DEFAULT_QUERIES: DashboardQueries = {
  cpu:
    "100 - (avg by (instance) (rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)",
  ram:
    "100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)",
  networkRx:
    'rate(node_network_receive_bytes_total{device=~"eth.*|ens.*|eno.*|bond.*"}[5m])',
  networkTx:
    'rate(node_network_transmit_bytes_total{device=~"eth.*|ens.*|eno.*|bond.*"}[5m])',
  hostsUp: "up",
};

interface InstantState {
  data: QueryResponseBody | null;
  error: string | null;
  loading: boolean;
}

/** Polls an instant query every `intervalMs` while connected. */
export function useInstantMetric(
  tenantId: string | null,
  query: string,
  intervalMs = 15000
): InstantState {
  const [state, setState] = useState<InstantState>({
    data: null,
    error: null,
    loading: true,
  });

  const fetchData = useCallback(async (): Promise<void> => {
    if (tenantId === null || query.length === 0) {
      return;
    }
    try {
      const data = await instantQuery({ tenantId, query });
      setState({ data, error: null, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Query failed";
      setState((prev) => ({ ...prev, error: message, loading: false }));
    }
  }, [tenantId, query]);

  useEffect(() => {
    void fetchData();
    if (tenantId === null) {
      return;
    }
    const handle = setInterval(() => {
      void fetchData();
    }, intervalMs);
    return () => {
      clearInterval(handle);
    };
  }, [fetchData, tenantId, intervalMs]);

  return state;
}

/** Fetches a range query once per tenant+query change for sparklines. */
export function useRangeMetric(
  tenantId: string | null,
  query: string,
  windowMinutes = 60,
  step = "5m"
): { series: MetricSeries[]; error: string | null; loading: boolean } {
  const [series, setSeries] = useState<MetricSeries[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tenantId === null || query.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const end = new Date();
    const start = new Date(end.getTime() - windowMinutes * 60_000);
    rangeQuery({
      tenantId,
      query,
      start: start.toISOString(),
      end: end.toISOString(),
      step,
    })
      .then((data) => {
        if (cancelled) {
          return;
        }
        const mapped: MetricSeries[] = data.result.map((entry) => {
          const item = entry as {
            metric?: Record<string, string>;
            values?: Array<{ timestamp: number; value: number }>;
          };
          return {
            label: item.metric?.instance ?? "series",
            points: item.values ?? [],
          };
        });
        setSeries(mapped);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : "Range query failed");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, query, windowMinutes, step]);

  return { series, error, loading };
}
