import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { getEnv } from "./config/env.js";
import { registerRateLimit } from "./middleware/rateLimit.js";
import { connectRoutes } from "./routes/connect.js";
import { queryRoutes } from "./routes/query.js";
import { streamRoutes } from "./routes/stream.js";
import { getCircuitBreaker } from "./services/circuitBreaker.js";
import { healthcheck } from "./db/schema.js";

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

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });
  await registerRateLimit(app);

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
    return reply.code(200).send({
      status: "ok",
      db,
      circuit: breaker.state,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  await app.register(connectRoutes);
  await app.register(queryRoutes);
  await app.register(streamRoutes);

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
