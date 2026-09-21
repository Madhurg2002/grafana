import type { FastifyContextConfig, FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { getEnv } from "../config/env.js";

/**
 * Rate limiting configuration. Applied globally; dev/test defaults stay
 * generous so Vitest route tests are not throttled.
 *
 * Auth endpoints additionally use a stricter per-IP bucket (see
 * `authRateLimitOptions`) to slow credential-stuffing attempts without
 * locking out the whole API for a shared-IP office.
 */

/** Options attached to auth routes via `config: { rateLimit: ... }`. */
export function authRateLimitOptions(): FastifyContextConfig {
  const env = getEnv();
  return {
    rateLimit: {
      // Brute-force budget: 10 attempts / minute / IP. Uniform with the
      // login error so lockouts do not reveal whether an account exists.
      max: env.NODE_ENV === "test" ? 10_000 : 10,
      timeWindow: "1 minute",
    },
  };
}

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  const env = getEnv();
  await app.register(rateLimit, {
    global: true,
    max: env.NODE_ENV === "test" ? 10_000 : env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
  });
}
