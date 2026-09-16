import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { getEnv } from "../config/env.js";

/**
 * Rate limiting configuration. Applied globally; dev/test defaults stay
 * generous so Vitest route tests are not throttled.
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  const env = getEnv();
  await app.register(rateLimit, {
    global: true,
    max: env.NODE_ENV === "test" ? 10_000 : env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
  });
}
