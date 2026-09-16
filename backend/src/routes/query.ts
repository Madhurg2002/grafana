import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CircuitOpenError } from "../services/circuitBreaker.js";
import {
  instantQuery,
  rangeQuery,
  PrometheusClientError,
  type PromQueryResult,
} from "../services/prometheus.js";

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
}
