# Deferred Items & Known Limitations

> **Maintenance rule (see AGENTS.md §Deferred Ledger):** every commit that
> defers, simplifies, or discovers a gap MUST update this file in the same
> commit. When an item ships, flip its status here instead of deleting the row.

Status legend: ✅ Done · 🔶 Done with simplification · ⏳ Deferred

## Backend

| Item | Status | Notes |
| :--- | :--- | :--- |
| AES-256-GCM token vault (`iv:authTag:ciphertext`, hex) | ✅ | `backend/src/db/encryption.ts`; key from `ENCRYPTION_KEY` (32-byte hex) |
| PostgreSQL schema | ✅ | Versioned migrations (001 core, 002 indexes/trigger, 003 users+shares, 004 upstream_type, 007 pages, 009 page_widgets, **010 per-page built-ins toggle**) via checksum-verified, advisory-locked runner |
| PromQL normalizer (all 3 safety laws) | ✅ | Physical NIC filter, MemFree→MemAvailable, ≥[5m] rate windows; unit-tested |
| `lru-cache` (300s TTL) query cache | ✅ | `backend/src/services/cache.ts` |
| 3-state circuit breaker | ✅ | 5 fails/3000ms → 30s open → half-open; open-state fallback serves last-known value |
| Single-poll SSE fan-out (1 query / 5s / tenant) | ✅ | `backend/src/services/sse.ts` |
| Dual upstream: Prometheus **and** Grafana | ✅ | Auto-detection + Grafana datasource-proxy resolution (`services/upstream.ts`); per-tenant routing with `PROMETHEUS_BASE_URL` as fallback |
| Paste-friendly upstream input | ✅ | `normalizeUpstreamInput`: bare `ip:port` gets `http://`, Grafana dashboard links (`/d/<uid>/slug?orgId=1`) truncate to the mount prefix, whitespace/slashes stripped. |
| User accounts (signup/login/me, scrypt + HMAC sessions) | ✅ | `routes/auth.ts`; uniform login errors; 7-day tokens |
| Shareable read-only links | ✅ | `routes/share.ts`; owner-only management + public snapshot view |
| Share access control (audience × right) | ✅ | Migration 006 `access` enum + **008 org extension**: anyone-with-link, email allow-list, **or the tenant's org (every member)** × view or edit. Email views use signed 1h tokens bound to share+email; org views authorize via the caller's session + org membership. Invite emails via Resend (`RESEND_API_KEY` optional — falls back to copy-link). |
| Edit-access enforcement depth | ✅ | Write endpoints (`panels`/`pages`/`widgets`/`connections`) now enforce `requireTenantAccess`: owner session, org-member session, or the tenant-scoped token minted on connect. Collaborator writes actually mutate. |
| Route enforcement of tenant auth on query/stream | ✅ | `requireTenantAccess` guards `/api/query`, `/api/query_range`, `/api/stream` (token via header **or** `?token=` for EventSource), metric-catalog/labels/series, panels, pages, widgets, and connection management. Legacy owner-less workspaces stay reachable for the no-account flow. |
| Live Prometheus integration tests (real upstream) | ✅ | `backend/tests/live-upstream.test.ts` — gated by `TEST_PROMETHEUS_URL` + a reachable `TEST_DATABASE_URL`; runs the real client path (undici → breaker → cache → normalizer) and skips cleanly so CI stays hermetic. |
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
| Dashboard refresh controls (manual refresh, window picker) | ✅ | Every page has a refresh-cadence picker (5s–5m) and time-window picker (15m–7d) persisted server-side (`dashboard_pages.refresh_seconds/window_minutes`); a toolbar button broadcasts an instant refresh to all widgets. |
| Per-host drill-down pages | 🔶 | Hosts table is a page widget; click-to-filter gauges/sparklines still deferred. |
| Single header chrome | ✅ | `SignedInApp` renders the ONLY header; `DashboardView embedded` renders a slim toolbar (switcher + health + share) beneath it — no duplicate branding row. |
| Internal tenant IDs hidden from UI | ✅ | The `tenant: t_…` line is gone; users see connection labels/emails only (`parseRoute`-level surfaces never render IDs). |
| Dashboard pages (Home + custom pages) | ✅ | Migration 007 `dashboard_pages` + **009 widgets**: pages are fully user-modifiable dashboards — rename, **choose which page is home** (`is_home` flag + `POST /api/pages/:tenantId/:id/home`), per-page refresh/window defaults, widgets (stat/gauge/sparkline/hosts-table) with per-widget grid span, drag-reorder, in-place edit. |
| Per-user grid density | ✅ | Widget-level `span` (1–3 columns) persisted server-side replaces the localStorage density selector; grid is responsive (`lg:grid-cols-2 2xl:grid-cols-3`) and the dashboard container widened to `max-w-[1800px]` for large screens. |
| Profile page (share inventory) | ✅ | `/profile` + `GET /api/profile/shares`: links I created (copy/revoke, revoked kept visible + marked), links shared with my email (open/revoked). **Plus**: account settings (display name, password change) and Organizations (create/join by invite code, member roster, rotate code, attach/detach workspace). |
| Formula transparency | ✅ | Hosts-table `query:` line + hover tooltips on every built-in and custom card expose the exact PromQL powering it. |
| Alerting (threshold → email/Slack) | ⏳ | The biggest Grafana-parity gap; needs an alerts table + notifier service + UI. |
| Custom queries / panel builder | ✅ | `CustomPanels` UI: widgets (titled PromQL stat/gauge/sparkline + scrape-target table) persisted in `page_widgets`, normalized server-side, edited in place (title/query/span/kind), rendered live. |
| PromQL helper (autocomplete + recipes) | ✅ | `GET /api/metrics/:tenantId` (cached metric catalog), `GET /api/labels/:tenantId/:label`, tenant-aware recipes (`/api/promql/recipes/:tenantId` flags what the upstream lacks + auto-generates rate() panels for its own `_total` counters); `PromqlHelper` suggests metrics/instances from the CONNECTED upstream. |
| Metric browser (table/column explorer) | ✅ | `MetricBrowser` modal: metrics as tables, `/api/promql/series` label sets as rows×columns; insert metric or per-series rate() into the panel builder. |
| Rearrangeable dashboard | ✅ | Widgets are drag-to-reorder with positions persisted via `POST /api/pages/:tenantId/:pageId/widgets/reorder` (transactional batch); per-widget span stretch/shrink persisted via `PATCH /api/pages/:tenantId/widgets/:id`. |
| Prometheus/Grafana toggle in connect UI | ✅ | Auto/Prometheus/Grafana segmented control; label copy + token requirements adapt per flavor (`upstreamType` override hits the backend's existing mismatch check). |
| Share view = live dashboard parity | ✅ | Share snapshots now include network RX/TX series (same 60m/5m window); live dashboard now includes the hosts table. |
| Multiple dashboards / saved views per user | ✅ | Superseded by Dashboard pages (migration 007+009): Home + named pages, each an independently composed widget group; home page is user-selectable. |
| Organizations (team sharing) | ✅ | Migration 008: create org, join by invite code (owner-rotatable), member roster, attach/detach workspace; org share links (`org_view`/`org_edit`) authorize via session + membership; attach also grants read/edit across query/panels/pages. |
| Password change + display name | ✅ | `POST /api/auth/change-password` (verifies current password, scrypt re-hash) and `PATCH /api/auth/profile`; UI in Profile → Account. |
| Multiple upstream URIs per tenant + switcher | ✅ | Migration 005 (multi-row `prometheus_connections`, partial unique active index); header `ConnectionSwitcher` lists/activates/deletes without re-entering credentials. |
| Log/trace correlation, non-Prometheus datasources | ⏳ | Out of scope by design (Prometheus-only per spec). |

## Environment / Ops

| Item | Status | Notes |
| :--- | :--- | :--- |
| Invite emails (Resend) | ⏳ Deferred until prod-ready | Plumbing exists (`services/email.ts`, `POST /api/share/:id/invite`); sharing falls back to copy-link while `RESEND_API_KEY` is unset. Activation deliberately postponed — non-prod app must not send mail. |

| Item | Status | Notes |
| :--- | :--- | :--- |
| `.env.example` | ✅ | Created via filesystem (platform blocks direct writes to `.env*` names) |
| CORS origin normalization (bare hostnames, comma lists) | ✅ | `backend/src/config/env.ts` + dynamic origin check in `index.ts` |
| Sandbox `.env` secrets | ✅ | Render/Vercel deploy with dashboard-set env vars |
| Vercel `vercel.json` SPA rewrites | ✅ | Deep links (`/signup`, `/login`, `/share/:id`) no longer 404 |
| Commit authorship | ✅ | All new commits authored by the repo owner (no bot merge commits since `d061927`; older `freebuff-web[bot]` merge commits are immutable published history) |
| Production analytics/error tracking | ⏳ | No Sentry/analytics wired. |

## Verification (latest)

- Orgs (migration 008): create/join by invite code, member roster, rotate code, attach/detach workspace, `org_view`/`org_edit` share audience authorized via session + membership.
- Pages as full dashboards (migration 009): widgets (`page_widgets`) with per-widget span, drag-reorder, in-place edit, hosts-table widget; per-page refresh cadence + time window; user-selectable home page.
- Tenant auth enforcement closed (deferred → ✅): `requireTenantAccess` on query/query_range/stream (header or `?token=`)/metrics/labels/series/panels/pages/widgets/connections; tenant-scoped token minted at connect; legacy owner-less workspaces still work.
- Account settings: password change (current-password verified) + display name in Profile.
- ShareDialog access-enum bug fixed (was sending `link_edit`; now maps audience×right → `anyone_edit` etc.) + org audience added.
- `npm test` (root): backend 86 passed + 11 skipped (no live DB/upstream in sandbox) ✅ + frontend 18/18 ✅
- `npm run typecheck`: backend + frontend clean, zero `any` ✅

## DB initializer quick reference

```bash
npm run db:migrate     # apply pending migrations, then exit (release step)
npm run db:init        # legacy alias, same runner (idempotent, advisory-locked)
```

- Migrations live in `backend/src/db/migrations/index.ts` — **never edit an applied migration** (checksum verification aborts boot); append `005_*.ts`-style entries instead.
- Applied versions are tracked in `schema_migrations (name, checksum, applied_at)`.
- Concurrent server instances are serialized via `pg_advisory_lock`, so multi-replica deploys are safe.
