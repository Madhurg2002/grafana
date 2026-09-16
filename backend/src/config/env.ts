import { z } from "zod";

/**
 * Environment schema. Fail-fast at boot: no implicit `any`, no silent defaults
 * for security-critical values.
 */
const hex64 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "must be a 64-character hex string (32 bytes)");

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  ENCRYPTION_KEY: hex64,
  JWT_SECRET: hex64,
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://postgres:postgres@localhost:5432/prometheus_passthrough"),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
});

export type Env = z.infer<typeof envSchema>;

/** Test hooks may inject a synthetic environment. */
const globalForEnv = globalThis as unknown as { __APP_ENV__?: Env };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  return parsed.data;
}

export function getEnv(): Env {
  if (!globalForEnv.__APP_ENV__) {
    globalForEnv.__APP_ENV__ = loadEnv();
  }
  return globalForEnv.__APP_ENV__;
}

/** Used by tests to override the environment without mutating process.env. */
export function setEnv(env: Env | undefined): void {
  globalForEnv.__APP_ENV__ = env;
}
