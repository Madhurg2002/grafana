import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { getEnv } from "./config/env.js";
import { registerRateLimit } from "./middleware/rateLimit.js";
import { connectRoutes } from "./routes/connect.js";
import { queryRoutes } from "./routes/query.js";
import { streamRoutes } from "./routes/stream.js";
import { authRoutes } from "./routes/auth.js";
import { shareRoutes } from "./routes/share.js";
import { profileRoutes } from "./routes/profile.js";
import { orgRoutes } from "./routes/orgs.js";
import { alertRoutes } from "./routes/alerts.js";
import { getAlertEvaluator } from "./services/alertEvaluator.js";
import { getCircuitBreaker } from "./services/circuitBreaker.js";
import { healthcheck } from "./db/schema.js";
import { startDatabaseSupervisor } from "./db/bootstrap.js";
import { getDatabaseStatus, isDatabaseReady } from "./db/status.js";

export interface BuildAppOptions {
  /** Skip DB-backed plugins (used by unit tests). */
  skipDb?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = getEnv();
  const app = Fastify({
    logger: env.NODE_ENV !== "test",
    disableRequestLogging: env.NODE_ENV === "test",
  });

  // CORS_ORIGIN is a comma-separated allow-list (bare hostnames normalized
  // to https by the env schema). Multiple Vercel preview URLs can be listed.
  const allowedOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim());
  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser tools (curl, healthchecks) send no Origin — allow.
      if (origin === undefined || allowedOrigins.includes("*")) {
        cb(null, true);
        return;
      }
      cb(null, allowedOrigins.includes(origin));
    },
    credentials: true,
  });
  await registerRateLimit(app);

  // Security headers on every response. CSP allows the Vercel origin's own
  // assets + inline styles (Tailwind runtime classes); connect-src permits the
  // configured API origins for XHR/SSE. In API-only test mode the defaults are
  // harmless.
  const apiOrigins = allowedOrigins.filter((o) => o !== "*");
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", ...apiOrigins],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    // SSE streams over the same origin — no cross-origin framing needed.
    frameguard: { action: "deny" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
  });

  app.get("/api/health", async (_request, reply) => {
    let db = false;
    if (!options.skipDb) {
      try {
        db = await healthcheck();
      } catch {
        db = false;
      }
    }
    const breaker = getCircuitBreaker().status();
    // Liveness always answers 200: the process is up and serving. Database
    // state is reported in the body (and hard on /api/health/ready) so a dead
    // Postgres reads as a diagnosable degradation, not a failed deploy.
    return reply.code(200).send({
      status: db ? "ok" : "degraded",
      db,
      database: getDatabaseStatus(),
      circuit: breaker.state,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  /** Readiness: 503 until the schema is migrated and the pool answers. */
  app.get("/api/health/ready", async (_request, reply) => {
    const database = getDatabaseStatus();
    if (database.ready) {
      return reply.code(200).send({ status: "ready" });
    }
    await reply.code(503).send({
      error: "Database unavailable",
      details: [
        { path: "database", message: database.hint ?? database.lastError ?? "Not connected" },
      ],
    });
  });

  // Fail closed, but diagnosably: while the database is unreachable every data
  // route answers 503 with the supervisor's explanation instead of leaking a pg
  // stack trace. The health routes above stay open so the platform can see why.
  app.addHook("onRequest", async (request, reply) => {
    if (options.skipDb || isDatabaseReady()) {
      return;
    }
    const path = request.url.split("?")[0] ?? "";
    if (!path.startsWith("/api/") || path.startsWith("/api/health")) {
      return;
    }
    const database = getDatabaseStatus();
    await reply.code(503).send({
      error: "Database unavailable",
      details: [
        { path: "database", message: database.hint ?? database.lastError ?? "Not connected" },
      ],
    });
  });

  await app.register(connectRoutes);
  await app.register(queryRoutes);
  await app.register(streamRoutes);
  await app.register(authRoutes);
  await app.register(shareRoutes);
  await app.register(profileRoutes);
  await app.register(orgRoutes);
  await app.register(alertRoutes);

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
    app.log.error({ err: error }, "Unhandled route error");
    void reply.code(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : error.message,
    });
  });

  return app;
}

export async function startServer(): Promise<void> {
  const env = getEnv();
  const app = await buildApp();
  // The database is a hard dependency at runtime but not at boot: a missing
  // instance (deleted Postgres, DNS failure) must not crash-loop the service
  // and fail the deploy. The supervisor retries with backoff while
  // /api/health reports exactly why, and the evaluator starts once it is ready.
  startDatabaseSupervisor({
    onReady: () => {
      app.log.info("Database schema initialized");
      // Threshold-alert evaluator: one background scan loop for all tenants.
      getAlertEvaluator().start();
      app.log.info("Alert evaluator started");
    },
    onFailure: (status, nextRetryInMs) => {
      app.log.error(
        { database: status },
        `Database unreachable — retrying in ${Math.round(nextRetryInMs / 1000)}s; the API keeps serving /api/health`
      );
    },
  });
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`Backend listening on :${env.PORT}`);
  } catch (error) {
    app.log.error(error, "Failed to start server");
    process.exit(1);
  }
}

// ESM main-module detection.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  void startServer();
}
