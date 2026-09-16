import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CircuitOpenError } from "../services/circuitBreaker.js";
import {
  instantQuery,
  rangeQuery,
  fetchMetricNames,
  fetchLabelValues,
  fetchMetricSeries,
  PrometheusClientError,
  type PromQueryResult,
} from "../services/prometheus.js";

/**
 * Curated, safety-law-compliant starter queries surfaced in the panel
 * builder so users never start from a blank page.
 */
export const PROMQL_RECIPES: Array<{
  title: string;
  promql: string;
  kind: string;
  unit: string;
}> = [
  {
    title: "CPU per host (%)",
    promql:
      '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
    kind: "gauge",
    unit: "%",
  },
  {
    title: "RAM used (%)",
    promql:
      "100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)",
    kind: "gauge",
    unit: "%",
  },
  {
    title: "Network RX (physical NICs)",
    promql:
      'rate(node_network_receive_bytes_total{device=~"eth.*|ens.*|eno.*|bond.*"}[5m])',
    kind: "sparkline",
    unit: "bytes/s",
  },
  {
    title: "Network TX (physical NICs)",
    promql:
      'rate(node_network_transmit_bytes_total{device=~"eth.*|ens.*|eno.*|bond.*"}[5m])',
    kind: "sparkline",
    unit: "bytes/s",
  },
  {
    title: "Disk busy time (%)",
    promql:
      'rate(node_disk_io_time_seconds_total{device=~"sd.*|vd.*|nvme.*|xvd.*"}[5m]) * 100',
    kind: "gauge",
    unit: "%",
  },
  {
    title: "Hosts up ratio",
    promql: "sum(up) / count(up)",
    kind: "stat",
    unit: "%",
  },
  {
    title: "Request rate — adapt the metric name to your app",
    promql: "sum(rate(http_requests_total[5m]))",
    kind: "sparkline",
    unit: "req/s",
  },
];

/** Last known good results per tenant — circuit-open fallback. */
const lastKnownValues = new Map<
  string,
  { query: string; result: PromQueryResult }
>();

const instantSchema = z.object({
  tenantId: z.string().min(1).max(128),
  query: z.string().min(1).max(4096),
  time: z.string().max(64).optional(),
});

const rangeSchema = instantSchema.extend({
  start: z.string().min(1).max(64),
  end: z.string().min(1).max(64),
  step: z
    .string()
    .regex(/^[0-9]+(?:\.[0-9]+)?(ms|s|m|h|d|w|y)$/, "step must be a duration like 15s, 1m, 5m"),
});

export interface QueryResponseBody {
  resultType: string;
  result: unknown[];
  cached: boolean;
  query: string;
  breaker?: string;
  degraded?: boolean;
}

function upstreamErrorReply(error: unknown): {
  code: number;
  message: string;
} {
  if (error instanceof CircuitOpenError) {
    return { code: 503, message: "Upstream circuit open — retry after cooldown" };
  }
  if (error instanceof PrometheusClientError) {
    return {
      code: error.statusCode ?? 502,
      message: error.message,
    };
  }
  return { code: 502, message: "Upstream Prometheus request failed" };
}

/** Registers POST /api/query and POST /api/query_range. */
export async function queryRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>("/api/query", async (request, reply) => {
    const parsed = instantSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request body",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    const { tenantId, query, time } = parsed.data;

    try {
      const { result, cached } = await instantQuery({ tenantId, query, time });
      lastKnownValues.set(tenantId, { query, result });
      const body: QueryResponseBody = {
        resultType: result.resultType,
        result: result.result,
        cached,
        query,
      };
      return reply.code(200).send(body);
    } catch (error) {
      const { code, message } = upstreamErrorReply(error);
      // Circuit-open fallback: serve the last known value when available.
      if (error instanceof CircuitOpenError) {
        const fallback = lastKnownValues.get(tenantId);
        if (fallback !== undefined && fallback.query === query) {
          const body: QueryResponseBody = {
            resultType: fallback.result.resultType,
            result: fallback.result.result,
            cached: true,
            query,
            breaker: "open",
            degraded: true,
          };
          return reply.code(200).send(body);
        }
      }
      return reply.code(code).send({ error: message });
    }
  });

  app.post<{ Body: unknown }>("/api/query_range", async (request, reply) => {
    const parsed = rangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request body",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    const { tenantId, query, start, end, step } = parsed.data;

    try {
      const { result, cached } = await rangeQuery({
        tenantId,
        query,
        start,
        end,
        step,
      });
      const body: QueryResponseBody = {
        resultType: result.resultType,
        result: result.result,
        cached,
        query,
      };
      return reply.code(200).send(body);
    } catch (error) {
      const { code, message } = upstreamErrorReply(error);
      return reply.code(code).send({ error: message });
    }
  });

  // -----------------------------------------------------------------------
  // PromQL helper: metric catalog + label values from the connected upstream
  // -----------------------------------------------------------------------

  /** GET /api/metrics/:tenantId — every metric name the upstream exposes. */
  app.get<{ Params: { tenantId: string } }>(
    "/api/metrics/:tenantId",
    async (request, reply) => {
      const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
      if (!tenantId.success) {
        return reply.code(400).send({ error: "Invalid tenantId" });
      }
      try {
        const { names, cached } = await fetchMetricNames(tenantId.data);
        return reply.code(200).send({ names, cached });
      } catch (error) {
        const { code, message } = upstreamErrorReply(error);
        return reply.code(code).send({ error: message });
      }
    }
  );

  /** GET /api/labels/:tenantId/:label — values for one label (instance, job…). */
  app.get<{ Params: { tenantId: string; label: string } }>(
    "/api/labels/:tenantId/:label",
    async (request, reply) => {
      const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
      const label = z
        .string()
        .regex(/^[a-zA-Z0-9_]{1,64}$/)
        .safeParse(request.params.label);
      if (!tenantId.success || !label.success) {
        return reply.code(400).send({ error: "Invalid tenantId or label" });
      }
      try {
        const result = await fetchLabelValues(tenantId.data, label.data);
        return reply.code(200).send(result);
      } catch (error) {
        const { code, message } = upstreamErrorReply(error);
        return reply.code(code).send({ error: message });
      }
    }
  );

  /** GET /api/promql/recipes — curated starter queries for the panel builder. */
  app.get("/api/promql/recipes", async (_request, reply) => {
    return reply.code(200).send({ recipes: PROMQL_RECIPES });
  });

  /**
   * GET /api/promql/recipes/:tenantId — recipes filtered to what this
   * upstream ACTUALLY has (plus generic templates). Each recipe carries the
   * metrics it needs; unavailable ones are flagged so the UI can hide them.
   */
  app.get<{ Params: { tenantId: string } }>(
    "/api/promql/recipes/:tenantId",
    async (request, reply) => {
      const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
      if (!tenantId.success) {
        return reply.code(400).send({ error: "Invalid tenantId" });
      }
      try {
        const { names } = await fetchMetricNames(tenantId.data);
        const available = new Set(names);
        const catalog = PROMQL_RECIPES.map((recipe) => {
          const needed = recipe.promql.match(/[a-zA-Z_:][a-zA-Z0-9_:]*(?=\s*[({])/g) ?? [];
          const missing = needed.filter((m) => !available.has(m));
          return {
            ...recipe,
            available: missing.length === 0,
            missingMetrics: [...new Set(missing)],
          };
        });
        // Auto-generated recipes: any _total counter on this upstream becomes
        // a ready-made rate() panel.
        const autoCounters = names
          .filter((n) => n.endsWith("_total") && !n.startsWith("node_") && !n.startsWith("process_") && !n.startsWith("http_") && !n.startsWith("go_"))
          .slice(0, 10);
        const auto = autoCounters.map((counter) => ({
          title: `Rate of ${counter}`,
          promql: `sum(rate(${counter}[5m]))`,
          kind: "sparkline",
          unit: "op/s",
          available: true,
          missingMetrics: [] as string[],
        }));
        return reply.code(200).send({ recipes: [...catalog, ...auto] });
      } catch (error) {
        const { code, message } = upstreamErrorReply(error);
        return reply.code(code).send({ error: message });
      }
    }
  );

  /**
   * GET /api/promql/series/:tenantId/:metric — label sets ("columns") the
   * metric exposes, for the table-style metric browser.
   */
  app.get<{ Params: { tenantId: string; metric: string } }>(
    "/api/promql/series/:tenantId/:metric",
    async (request, reply) => {
      const tenantId = z.string().min(1).max(128).safeParse(request.params.tenantId);
      const metric = z
        .string()
        .regex(/^[a-zA-Z0-9_:]{1,200}$/)
        .safeParse(request.params.metric);
      if (!tenantId.success || !metric.success) {
        return reply.code(400).send({ error: "Invalid tenantId or metric" });
      }
      try {
        const result = await fetchMetricSeries(tenantId.data, metric.data);
        return reply.code(200).send(result);
      } catch (error) {
        const { code, message } = upstreamErrorReply(error);
        return reply.code(code).send({ error: message });
      }
    }
  );
}
