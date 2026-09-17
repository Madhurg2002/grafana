# Instructions & Guidelines for AI Coding Agents

## Core Directives
1. **Strict TypeScript:** Do not use `any`. Define explicit interfaces or TypeBox/Zod schemas for all request/response models and environment variables.
2. **Framework Alignment:**
   * Backend: **Fastify** (use standard plugins: `@fastify/cors`, `@fastify/rate-limit`).
   * Frontend: **React** with **Vite** and **Tailwind CSS** (plus `recharts`, `framer-motion`, and `lucide-react`).
3. **No External Grafana Dependency:** Route all metric requests directly to Prometheus endpoints (`/api/v1/query` and `/api/v1/query_range`). A pasted Grafana URL is *resolved to its Prometheus datasource* (see `backend/src/services/upstream.ts`) — never proxy Grafana dashboards/panels.
4. **Never Bypass Security:** All Prometheus/Grafana credentials/tokens passed to the backend must be encrypted via `src/db/encryption.ts` using AES-256-GCM before database persistence.

## Deferred Ledger (MANDATORY)
* `docs/deferred.md` is the single source of truth for unfinished work.
* **Every commit** that defers work, simplifies an implementation, or discovers a gap MUST add/update its row in `docs/deferred.md` **in the same commit**.
* When a deferred item ships, flip its status to ✅ in the same commit — never delete rows.
* Before starting new work, read `docs/deferred.md` to avoid re-implementing or contradicting known decisions.

## PromQL Safety Laws
When generating or modifying PromQL queries in `backend/src/services/prometheus.ts`:
* ALWAYS filter network devices using `device=~"eth.*|ens.*|eno.*|bond.*"`.
* NEVER write `device!="lo"` without physical interface filtering.
* ALWAYS use `node_memory_MemAvailable_bytes` for RAM calculations, NEVER `node_memory_MemFree_bytes`.
* Range vectors for `rate()` must be `[5m]` or larger.

## Code Style & Testing
* Use async/await syntax exclusively.
* Wrap external HTTP calls (to Prometheus) in try/catch blocks with circuit breaker handling (`src/services/circuitBreaker.ts`).
* Use process in-memory caching (`lru-cache`) with a 300-second TTL for query responses.
* Write full Vitest test coverage for backend services/routes and frontend components. Ensure `npm test` passes cleanly.

## Capability Map (what exists — check here BEFORE building something new)
Referenced from `docs/deferred.md` (status) and `docs/skills.md` (deep dive). Route-level truth lives in the code: `backend/src/routes/*.ts`, `frontend/src/lib/api.ts`.

| Capability | Where |
| :--- | :--- |
| Accounts: signup/login/me (scrypt + HMAC sessions) | `backend/src/routes/auth.ts`, `frontend/src/hooks/useAuth.tsx` |
| Connect flow: URI + optional token → detect (Prometheus **or** Grafana) → encrypt → persist | `backend/src/routes/connect.ts`, `backend/src/services/upstream.ts`, `frontend/src/components/ConnectForm.tsx` |
| Multiple stored URIs per user + one-click switch (no re-auth) | `ConnectionSwitcher.tsx`, `/api/connections/:tenantId*` |
| PromQL proxy: instant/range, normalizer, 300s LRU cache, circuit breaker | `backend/src/services/prometheus.ts`, `cache.ts`, `circuitBreaker.ts` |
| Live updates: single-poll SSE fan-out (1 query / 5s / tenant) | `backend/src/services/sse.ts`, `/api/stream` |
| Built-in dashboard: hosts up, CPU/RAM gauges, network sparklines, scrape-target table | `frontend/src/components/DashboardView.tsx` |
| Custom views: widgets (stat/gauge/sparkline/hosts-table), per-widget grid span, in-place edit, drag-reorder, persisted | `CustomPanels.tsx`, `/api/pages/:tenantId/:pageId/widgets*` |
| Dashboard PAGES: user-modifiable dashboards — rename, pick home, per-page refresh/window, widgets | migrations 007+009, `/api/pages/:tenantId*`, page tabs in `CustomPanels` |
| Organizations: create/join by invite code, member roster, attach workspace, org-wide share audience | migration 008, `backend/src/routes/orgs.ts`, ProfileView → Organizations |
| Account settings: password change + display name | `POST /api/auth/change-password`, `PATCH /api/auth/profile`, ProfileView → Account |
| Tenant auth: session **or** tenant-scoped token (header/`?token=`) on every tenant route | `requireTenantAccess` in `backend/src/middleware/auth.ts`; token minted by `POST /api/connect` |
| PromQL helper: recipes filtered by upstream, metric catalog, label values, series browser, predictive autocomplete | `PromqlHelper.tsx`, `MetricBrowser.tsx`, `/api/metrics|labels|promql/*` |
| Formula transparency: every card/table exposes the query behind it (hover tooltip / `query:` line) | `SparkLineCard`, `GaugeCard`, `DashboardView` hosts table |
| Share links: audience (anyone-link / email allow-list / **org members**) × right (view/edit), revoke, public snapshot view | `backend/src/routes/share.ts`, `ShareDialog.tsx`, `ShareView.tsx` |
| Profile: links I created (revoke), links shared with me, revoked status | `frontend/src/components/ProfileView.tsx`, `/api/profile/shares` |
| Per-widget grid span (1–3) + responsive wide layout | `CustomPanels.tsx` span controls, `PATCH /api/pages/:tenantId/widgets/:id` |
| Invite emails via Resend | `backend/src/services/email.ts` — OPTIONAL, disabled until `RESEND_API_KEY` is set (deferred; see ledger) |

## Decision Tree (how to choose where things go)
1. **New metric display?** → Built-in card (`DashboardView`) only for node-exporter essentials; anything user-specific = custom panel. Never hardcode tenant-specific queries into the built-ins.
2. **New persisted per-user data?** → new column/table via a **new migration file** (`backend/src/db/migrations/0NN-*.ts`) + registered in `migrations/index.ts` + schema helpers in `db/schema.ts` or `db/users.ts`. Never edit an applied migration (checksum guard).
3. **New upstream interaction?** → goes through `services/prometheus.ts` (breaker + cache + normalizer). Never `fetch()` Prometheus from a route directly.
4. **New user-facing surface?** → route in `frontend/src/App.tsx` parseRoute + component; auth-gated surfaces live under `SignedInApp`. Keep ONE header (`SignedInApp`'s); embedded views render toolbars, not headers.
5. **Internal identifiers (tenant IDs, user IDs)?** → NEVER render them in the UI. Users see labels/emails only.
6. **New API error?** → always `{ error, details? }` with zod issue paths; the client (`authedJson`) surfaces `details` so failures are diagnosable.
7. **Anything you cannot finish now?** → `docs/deferred.md` row in the SAME commit.

## Migrations Policy
* `backend/src/db/migrations/` files are standalone; the app runtime NEVER runs them implicitly.
* Apply schema changes explicitly: `npm run db:migrate` (release step / Render pre-deploy command). Boot (`bootstrapDatabase`) only verifies + retries — keep it, but treat it as a safety net, not the mechanism.
* One migration per schema change, named `0NN-description.ts`, registered in `migrations/index.ts`. Immutable once applied.