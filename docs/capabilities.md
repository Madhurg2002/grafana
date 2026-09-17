# Capability Map

> **Source of truth for what exists.** `AGENTS.md` links here and stays slim.
> Route-level truth lives in the code: `backend/src/routes/*.ts`,
> `frontend/src/lib/api.ts`. Remaining work + timing lives in `docs/todo.md`.

| Capability | Where |
| :--- | :--- |
| Accounts: signup/login/me (scrypt + HMAC sessions) | `backend/src/routes/auth.ts`, `frontend/src/hooks/useAuth.tsx` |
| Account settings: password change + display name | `POST /api/auth/change-password`, `PATCH /api/auth/profile`, Profile → Account |
| Connect flow: URI + optional token → detect (Prometheus **or** Grafana) → encrypt → persist | `backend/src/routes/connect.ts`, `backend/src/services/upstream.ts`, `frontend/src/components/ConnectForm.tsx` |
| Multiple stored URIs per user + one-click switch (no re-auth) — add/switch/delete opens as a centered modal with per-field guidance | `ConnectionSwitcher.tsx`, `/api/connections/:tenantId*` |
| PromQL proxy: instant/range, normalizer, 300s LRU cache, circuit breaker | `backend/src/services/prometheus.ts`, `cache.ts`, `circuitBreaker.ts` |
| Live updates: single-poll SSE fan-out (1 query / 5s / tenant) | `backend/src/services/sse.ts`, `/api/stream` |
| Built-in dashboard: hosts up, CPU/RAM gauges, network sparklines — optional per page (`dashboard_pages.show_builtins`, default on) | `frontend/src/components/DashboardView.tsx` |
| Custom views: widgets (stat/gauge/sparkline/hosts-table), per-widget span, in-place edit, drag-reorder, persisted — every form field carries a visible hint + tooltip | `CustomPanels.tsx`, `/api/pages/:tenantId/:pageId/widgets*` |
| Dashboard PAGES: user-modifiable dashboards — rename, pick home, per-page refresh/window, optional built-in essentials strip (checkbox at page creation, "Built-ins: on/off" toggle per page) | migrations 007+009+010, `/api/pages/:tenantId*`, page tabs in `CustomPanels`, `DashboardView` honors `show_builtins` |
| PromQL helper: recipes filtered by upstream, metric catalog, label values, series browser, predictive autocomplete — full helper opens as a centered modal; inline suggestions are width/height-capped and scroll internally (never overflow the card) | `PromqlHelper.tsx`, `MetricBrowser.tsx`, `/api/metrics\|labels\|promql/*` |
| Formula transparency: every card/table exposes the query behind it (hover tooltip / `query:` line) | `SparkLineCard`, `GaugeCard`, hosts-table widget |
| Share links: audience (anyone-link / email allow-list / org members) × right (view/edit), revoke, public snapshot view | `backend/src/routes/share.ts`, `ShareDialog.tsx`, `ShareView.tsx` |
| Organizations: create/join by invite code, member roster, rotate code, attach workspace, org-wide share audience | migration 008, `backend/src/routes/orgs.ts`, ProfileView → Organizations |
| Tenant auth: session **or** tenant-scoped token (header / `?token=`) on every tenant route | `requireTenantAccess` in `backend/src/middleware/auth.ts`; token minted by `POST /api/connect` |
| Profile: links I created (revoke), links shared with me, revoked status | `frontend/src/components/ProfileView.tsx`, `/api/profile/shares` |
| Per-widget grid span (1–3) + responsive wide layout | `CustomPanels.tsx` span controls, `PATCH /api/pages/:tenantId/widgets/:id` |
| Invite emails via Resend | `backend/src/services/email.ts` — OPTIONAL, disabled until `RESEND_API_KEY` is set (see `docs/todo.md`) |
| Live-upstream integration tests (gated) | `backend/tests/live-upstream.test.ts` — `TEST_PROMETHEUS_URL` + DB required, skips otherwise |
