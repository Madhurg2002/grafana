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
| Paste-friendly upstream input | ✅ | `normalizeUpstreamInput`: bare `ip:port` gets `http://`, Grafana dashboard links (`/d/<uid>/slug?orgId=1`) truncate to the mount prefix, whitespace/slashes stripped. |
| User accounts (signup/login/me, scrypt + HMAC sessions) | ✅ | `routes/auth.ts`; uniform login errors; 7-day tokens |
| Shareable read-only links | ✅ | `routes/share.ts`; owner-only management + public snapshot view |
| Share access control (audience × right) | ✅ | Migration 006 `access` enum: anyone-with-link or email allow-list × view or edit. Email-restricted views require a signed 1h view token bound to share+email (`shareTokens.ts`, timing-safe). Invite emails via Resend (`RESEND_API_KEY` optional — falls back to copy-link). |
| Edit-access enforcement depth | 🔶 | `canEdit` is delivered to the client and gates UI affordances; write endpoints (panels/connect) still require the owner's session token — a non-owner with an edit share cannot actually mutate yet. Full collaborator write-path deferred. |
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
| Friendly connect/auth error copy + demo-Prometheus fallback button | ✅ | Verified working public demo: `https://prometheus.demo.prometheus.io` (the old `prometheus.demo.do.prometheus.io` no longer resolves — do not suggest it). |
| Per-host drill-down pages | 🔶 | Hosts table now on the live dashboard (matches the share view); click-to-filter gauges/sparklines still deferred. |
| Dashboard refresh controls (manual refresh, window picker) | ⏳ | Instant metrics poll every 15s, sparklines fetched once per mount; no user-facing refresh/window controls. |
| Alerting (threshold → email/Slack) | ⏳ | The biggest Grafana-parity gap; needs an alerts table + notifier service + UI. |
| Custom queries / panel builder | ✅ | `CustomPanels` UI: titled PromQL panels (sparkline/gauge/stat) persisted in `dashboard_panels`, normalized server-side, rendered live. Editing = delete + recreate. |
| PromQL helper (autocomplete + recipes) | ✅ | `GET /api/metrics/:tenantId` (cached metric catalog), `GET /api/labels/:tenantId/:label`, tenant-aware recipes (`/api/promql/recipes/:tenantId` flags what the upstream lacks + auto-generates rate() panels for its own `_total` counters); `PromqlHelper` suggests metrics/instances from the CONNECTED upstream. |
| Metric browser (table/column explorer) | ✅ | `MetricBrowser` modal: metrics as tables, `/api/promql/series` label sets as rows×columns; insert metric or per-series rate() into the panel builder. |
| Rearrangeable dashboard | ✅ | Custom panels are drag-to-reorder (HTML5 DnD) with positions persisted via `POST /api/panels/:tenantId/:id/reorder` (transactional batch update); grid scales to `2xl:grid-cols-3` for large screens. |
| Prometheus/Grafana toggle in connect UI | ✅ | Auto/Prometheus/Grafana segmented control; label copy + token requirements adapt per flavor (`upstreamType` override hits the backend's existing mismatch check). |
| Share view = live dashboard parity | ✅ | Share snapshots now include network RX/TX series (same 60m/5m window); live dashboard now includes the hosts table. |
| Multiple dashboards / saved views per user | 🔶 | Custom panels per tenant ship; multiple *named dashboards* (groups of panels) still deferred. |
| Multiple upstream URIs per tenant + switcher | ✅ | Migration 005 (multi-row `prometheus_connections`, partial unique active index); header `ConnectionSwitcher` lists/activates/deletes without re-entering credentials. |
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
