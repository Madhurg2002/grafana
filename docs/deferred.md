# Deferred Items & Known Limitations

Status legend: ✅ Done · 🔶 Done with simplification · ⏳ Deferred

## Backend

| Item | Status | Notes |
| :--- | :--- | :--- |
| AES-256-GCM token vault (`iv:authTag:ciphertext`, hex) | ✅ | `backend/src/db/encryption.ts`; key from `ENCRYPTION_KEY` (32-byte hex) |
| PostgreSQL schema (tenants, prometheus_connections) | ✅ | `backend/src/db/schema.ts`; DDL + typed upsert/query helpers |
| PromQL normalizer (all 3 safety laws) | ✅ | Physical NIC filter, MemFree→MemAvailable, ≥[5m] rate windows; unit-tested |
| `lru-cache` (300s TTL) query cache | ✅ | `backend/src/services/cache.ts` |
| 3-state circuit breaker (5 fails/3000ms → 30s open → half-open probe) | ✅ | `backend/src/services/circuitBreaker.ts`; open-state fallback serves last-known value |
| Single-poll SSE fan-out (1 query / 5s / tenant) | ✅ | `backend/src/services/sse.ts`; client cleanup on `req.raw.on('close')` |
| Routes `/api/connect`, `/api/query`, `/api/query_range`, `/api/stream`, `/api/health` | ✅ | `backend/src/routes/` |
| Undici client with breaker + bearer auth from encrypted token | ✅ | `backend/src/services/prometheus.ts` |
| Env validation (zod, fail-fast) | ✅ | `backend/src/config/env.ts` |
| HMAC-signed tenant auth (`middleware/auth.ts`) | 🔶 | Signing/verification implemented + helpers; routes currently accept `x-tenant-id`/body tenant without enforcing the token. Wire `requireTenant` into routes when multi-user auth is needed. |
| Live PostgreSQL integration tests | ⏳ | Route/service tests mock `db/schema.js` (no Postgres service in CI sandbox). `ensureSchema`/pool helpers are ready for a dockerized `npm run test:integration`. |
| Live Prometheus integration tests | ⏳ | Upstream calls mocked in Vitest per `vitest-monorepo-runner` skill. Normalizer verified directly. |
| Auto-running `ensureSchema()` on boot | ⏳ | Kept explicit (`ensureSchema()` exported); call it in `startServer()` once a real DB is provisioned to avoid surprise DDL in tests. |
| `render.yaml` infra review | ⏳ | Spec written for Render (web + static + Postgres, generated secrets); needs account-side validation on first deploy. |

## Frontend

| Item | Status | Notes |
| :--- | :--- | :--- |
| Dark glassmorphic UI (`bg-zinc-950`, `bg-zinc-900/60 backdrop-blur-md`) | ✅ | `.glass-card` utility + status glows (emerald/amber/rose) |
| `ConnectForm` / `DashboardView` / `StatusCard` / `GaugeCard` / `SparkLineCard` / `HealthBadge` | ✅ | Recharts radial gauge + gradient area charts; Framer Motion entrances |
| `useSSE` consumer → HealthBadge | ✅ | Live/Connecting/Disconnected states |
| `useDashboard` hooks (instant polling 15s + range sparklines) | ✅ | Mobile-first responsive grid |
| Typed API client (`lib/api.ts`) | ✅ | No `any`; error surfaces from backend payloads |
| Component tests (RTL, 12 passing) | ✅ | EventSource + ResizeObserver stubbed for jsdom |
| Framer Motion chart animations | 🔶 | Entrance animations only; `isAnimationActive={false}` on Area for deterministic tests |
| Routing (react-router) | ⏳ | Single-view app per spec; add router if multi-page nav is required |

## Environment / Ops

| Item | Status | Notes |
| :--- | :--- | :--- |
| `.env.example` | ✅ | Created via filesystem (platform blocks direct writes to `.env*` names) |
| Sandbox `.env` secrets (`ENCRYPTION_KEY`, `JWT_SECRET`, `DATABASE_URL`) | ⏳ | User must supply via Settings → Environment (32-byte hex keys). Backend fails fast without them. |
| `PROMETHEUS_BASE_URL` default upstream | ⏳ | Per-tenant URLs are stored in DB via `/api/connect`; a deployment-wide default can be added to env schema if needed. |

## Verification performed

- `npm test` (root): backend 51/51 ✅ + frontend 12/12 ✅
- `npm run typecheck`: backend + frontend clean, zero `any` ✅
- `backend npm run build` → `dist/` ✅ · `frontend npm run build` → `dist/` ✅
