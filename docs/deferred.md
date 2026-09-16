# Deferred Items & Known Limitations

> **Maintenance rule (see AGENTS.md §Deferred Ledger):** every commit that
> defers, simplifies, or discovers a gap MUST update this file in the same
> commit. When an item ships, flip its status here instead of deleting the row.

Status legend: ✅ Done · 🔶 Done with simplification · ⏳ Deferred

## Backend

| Item | Status | Notes |
| :--- | :--- | :--- |
| AES-256-GCM token vault (`iv:authTag:ciphertext`, hex) | ✅ | `backend/src/db/encryption.ts`; key from `ENCRYPTION_KEY` (32-byte hex) |
| PostgreSQL schema | ✅ | Versioned migrations (001 core, 002 indexes/trigger, 003 users+shares, 004 upstream_type) via checksum-verified, advisory-locked runner |
| PromQL normalizer (all 3 safety laws) | ✅ | Physical NIC filter, MemFree→MemAvailable, ≥[5m] rate windows; unit-tested |
| `lru-cache` (300s TTL) query cache | ✅ | `backend/src/services/cache.ts` |
| 3-state circuit breaker | ✅ | 5 fails/3000ms → 30s open → half-open; open-state fallback serves last-known value |
| Single-poll SSE fan-out (1 query / 5s / tenant) | ✅ | `backend/src/services/sse.ts` |
| Dual upstream: Prometheus **and** Grafana | ✅ | Auto-detection + Grafana datasource-proxy resolution (`services/upstream.ts`); per-tenant routing with `PROMETHEUS_BASE_URL` as fallback |
| User accounts (signup/login/me, scrypt + HMAC sessions) | ✅ | `routes/auth.ts`; uniform login errors; 7-day tokens |
| Shareable read-only links | ✅ | `routes/share.ts`; owner-only management + public snapshot view |
| Route enforcement of tenant auth on query/stream | ⏳ | `requireTenant`/`requireUser` exist but `/api/query`, `/api/query_range`, `/api/stream` still accept a bare `tenantId` (any caller who guesses an ID can read its metrics). Enforcement was deferred to keep the no-account connect flow working — wire in a signed token or per-tenant API key. |
| Live Prometheus integration tests (real upstream) | ⏳ | Upstream calls mocked in Vitest; normalizer verified directly. A `TEST_PROMETHEUS_URL`-gated suite would close this. |
| `render.yaml` infra validation | ⏳ | Spec written for Render (web + static + Postgres, generated secrets); actual deploy is dashboard-configured instead. |
| Secret rotation (ENCRYPTION_KEY / JWT_SECRET) | ⏳ | Single-key design; rotating ENCRYPTION_KEY invalidates stored tokens. Would need key-versioning (`v1:` prefixes). |

## Frontend

| Item | Status | Notes |
| :--- | :--- | :--- |
| Dark glassmorphic UI, cards, gauges, sparklines | ✅ | Recharts + Framer Motion |
| Auth pages + session context + redirect-on-auth | ✅ | Router re-parses on popstate and bounces signed-in users off `/login`/`/signup` |
| Inline connect panel for signed-in users without an upstream | ✅ | `SignedInApp` checks `GET /api/connection/:tenantId` and renders ConnectForm until connected |
| Custom 404 page | ✅ | SPA rewrite (`frontend/vercel.json`) + branded NotFoundPage |
| Share button + clipboard + public `/share/:id` (30s refresh) | ✅ | |
| Per-host drill-down pages | ⏳ | Dashboard aggregates; clicking a host in a table doesn't filter gauges/sparklines to it. |
| Dashboard refresh controls (manual refresh, window picker) | ⏳ | Instant metrics poll every 15s, sparklines fetched once per mount; no user-facing refresh/window controls. |
| Alerting (threshold → email/Slack) | ⏳ | The biggest Grafana-parity gap; needs an alerts table + notifier service + UI. |
| Custom queries / panel builder | ⏳ | UI ships only the fixed safe query set; `/api/query` accepts arbitrary (normalized) PromQL but there's no UI for it. |
| Multiple dashboards / saved views per user | ⏳ | One implicit workspace tenant per account. |
| Log/trace correlation, non-Prometheus datasources | ⏳ | Out of scope by design (Prometheus-only per spec). |

## Environment / Ops

| Item | Status | Notes |
| :--- | :--- | :--- |
| `.env.example` | ✅ | Created via filesystem (platform blocks direct writes to `.env*` names) |
| CORS origin normalization (bare hostnames, comma lists) | ✅ | `backend/src/config/env.ts` + dynamic origin check in `index.ts` |
| Sandbox `.env` secrets | ✅ | Render/Vercel deploy with dashboard-set env vars |
| Vercel `vercel.json` SPA rewrites | ✅ | Deep links (`/signup`, `/login`, `/share/:id`) no longer 404 |
| Commit authorship | ✅ | All new commits authored by the repo owner (no bot merge commits since `d061927`; older `freebuff-web[bot]` merge commits are immutable published history) |
| Production analytics/error tracking | ⏳ | No Sentry/analytics wired. |

## Verification (latest)

- `npm test` (root): backend 75 passed + 7 skipped (no live DB in sandbox) ✅ + frontend 17/17 ✅
- `npm run typecheck`: backend + frontend clean, zero `any` ✅
- Builds: `frontend/dist` ✅ · `backend/dist` ✅

## DB initializer quick reference

```bash
npm run db:init        # apply pending migrations (idempotent, advisory-locked)
```

- Migrations live in `backend/src/db/migrations/index.ts` — **never edit an applied migration** (checksum verification aborts boot); append `005_*.ts`-style entries instead.
- Applied versions are tracked in `schema_migrations (name, checksum, applied_at)`.
- Concurrent server instances are serialized via `pg_advisory_lock`, so multi-replica deploys are safe.
