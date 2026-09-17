# Capability Map

> **Source of truth for what exists.** `AGENTS.md` links here and stays slim.
> Route-level truth lives in the code: `backend/src/routes/*.ts`,
> `frontend/src/lib/api.ts`. Remaining work + timing lives in `docs/todo.md`.

| Capability | Where |
| :--- | :--- |
| Accounts: signup/login/me (scrypt + HMAC sessions) | `backend/src/routes/auth.ts`, `frontend/src/hooks/useAuth.tsx` — every interactive control across the app carries a `title` tooltip explaining its effect |
| Account settings: password change + display name | `POST /api/auth/change-password`, `PATCH /api/auth/profile`, Profile → Account |
| Connect flow: URI + optional token → detect (Prometheus **or** Grafana) → encrypt → persist — accepts any paste: `https://…`, bare `ip:port` (http), scheme-less public hostnames (https inferred, http fallback probe), private ranges/internal TLDs stay http; Grafana UI links truncate to the mount prefix | `backend/src/routes/connect.ts`, `backend/src/services/upstream.ts`, `frontend/src/components/ConnectForm.tsx` |
| Multiple stored URIs per user + one-click switch (no re-auth) — add/switch/delete opens as a centered modal with per-field guidance | `ConnectionSwitcher.tsx`, `/api/connections/:tenantId*` |
| PromQL proxy: instant/range, normalizer, 300s LRU cache, circuit breaker | `backend/src/services/prometheus.ts`, `cache.ts`, `circuitBreaker.ts` |
| Live updates: single-poll SSE fan-out (1 query / 5s / tenant) | `backend/src/services/sse.ts`, `/api/stream` |
| Built-in dashboard: hosts up, CPU/RAM gauges, network sparklines — optional per page (`dashboard_pages.show_builtins`, default on) | `frontend/src/components/DashboardView.tsx` |
| Dashboard request coalescing: identical concurrent instant/range queries share one browser request, range windows align, and refresh scheduling uses one shared clock | `frontend/src/lib/api.ts`, `frontend/src/hooks/useDashboard.ts`, `frontend/tests/components.test.tsx` |
| Custom views: widgets (stat/gauge/sparkline/hosts-table), per-widget span, **clone/duplicate**, in-place edit via a centered add/edit modal, drag-reorder, persisted — every form field carries a visible hint + tooltip | `CustomPanels.tsx`, `/api/pages/:tenantId/:pageId/widgets*` |
| Dashboard PAGES: user-modifiable dashboards — rename, pick home, per-page refresh/window, optional built-in essentials strip (checkbox at page creation, "Built-ins: on/off" toggle per page) | migrations 007+009+010, `/api/pages/:tenantId*`, page tabs in `CustomPanels`, `DashboardView` honors `show_builtins` |
| PromQL helper: recipes filtered by upstream, metric catalog, label values, series browser, predictive autocomplete — full helper opens as a centered modal; inline suggestions are width/height-capped and scroll internally (never overflow the card) | `PromqlHelper.tsx`, `MetricBrowser.tsx`, `/api/metrics\|labels\|promql/*` |
| Formula transparency: every card/table exposes the query behind it (hover tooltip / `query:` line) | `SparkLineCard`, `GaugeCard`, hosts-table widget |
| Share links: audience (anyone-link / email allow-list / org members) × right (view/edit), revoke, public snapshots, and editor access for edit links via short-lived share-bound workspace tokens — **multiple links per tenant coexist** (migration 013); snapshots embed composed pages + widgets and edit links open the dashboard editor | `backend/src/routes/share.ts`, `backend/src/middleware/auth.ts`, `backend/src/db/migrations/013-share-links-multi.ts`, `ShareDialog.tsx`, `ShareView.tsx`, `DashboardView.tsx` |
| Share people-picker: search registered users by email/display-name prefix (≥2 chars, safe fields only, capped) and click to add to the allow-list; in-app "Shared with me" list in Profile | `GET /api/users/search` in `backend/src/routes/profile.ts`, `searchUsers` in `backend/src/db/users.ts`, migration 012 indexes, `ShareDialog.tsx` picker, `ProfileView.tsx` |
| Alerting: threshold rules (PromQL + comparator + for-duration) evaluated on a background loop through the breaker/cache stack; webhook notifications; fired/ok state with last-value + eval time; full CRUD UI | migration 011, `backend/src/services/alertEvaluator.ts`, `backend/src/services/webhook.ts`, `backend/src/routes/alerts.ts`, `frontend/src/components/AlertManager.tsx` |
| Host drill-down: clicking a hosts-table row scopes all widgets on the page to that instance (`{instance="…"}` injected); click again / ✕ to clear | `CustomPanels.tsx` (`selectedHost`, `LiveWidget` scoping), hosts-table widget |
| Key-versioned encryption + rotation: payloads tagged `v<N>!`, decrypt picks the key by tag (legacy payloads still decrypt), `rewrapPayload` + `npm run rotate` rewraps rows under the current version | `backend/src/db/encryption.ts`, `backend/src/scripts/rotateEncryptionKey.ts` |
| Organizations: create/join by invite code, member roster, rotate code, attach workspace, org-wide share audience | migration 008, `backend/src/routes/orgs.ts`, ProfileView → Organizations |
| Tenant auth: session **or** tenant-scoped token (header / `?token=`) on every tenant route | `requireTenantAccess` in `backend/src/middleware/auth.ts`; token minted by `POST /api/connect` |
| Profile: links I created (revoke), links shared with me, revoked status | `frontend/src/components/ProfileView.tsx`, `/api/profile/shares` |
| Per-widget grid span (1–3) + responsive wide layout | `CustomPanels.tsx` span controls, `PATCH /api/pages/:tenantId/widgets/:id` |
| Invite emails via Brevo | `backend/src/services/email.ts` — OPTIONAL, disabled until `BREVO_API_KEY` + `BREVO_FROM_EMAIL` are set (see `docs/todo.md`) |
| Live-upstream integration tests (gated) | `backend/tests/live-upstream.test.ts` — `TEST_PROMETHEUS_URL` + DB required, skips otherwise |
| Operator scripts: `npm run verify` (typecheck + all tests), `npm run db:migrate:status` (applied/pending/MODIFIED), `npm run capability-review` (maps changed files → touched capabilities for the auto-review rule), `npm run rotate` (key-rotation rewrap), `npm run smoke:live` (end-to-end against a real Prometheus incl. scheme-less connect) | root `package.json`, `scripts/capability-review.sh`, `scripts/smoke-live.sh`, `backend/src/db/migrateStatus.ts`, `backend/src/scripts/rotateEncryptionKey.ts` |
| DB query observability: pool-instrumented timing with `DB_LOG_QUERIES=1` / `DB_LOG_SLOW_MS` (off by default) + `getDbQueryCount()`; migrations guide in `MIGRATIONS.md` | `backend/src/db/schema.ts` (pool instrumentation), `backend/src/db/migrations/MIGRATIONS.md` |
