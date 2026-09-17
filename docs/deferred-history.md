# Deferred Work History

> Completed items that were previously tracked in `docs/deferred.md`.
> This file is historical context only; active unfinished work belongs in
> `docs/deferred.md`.

## Backend

| Item | Outcome |
| :--- | :--- |
| AES-256-GCM token vault | Shipped encrypted Prometheus/Grafana credential storage using versioned payloads and a 32-byte encryption key. |
| PostgreSQL schema and migration runner | Shipped checksum-verified, advisory-locked, transactional migrations through migration 014. |
| PromQL safety normalizer | Shipped physical network-interface filtering, `MemAvailable` RAM calculations, and minimum `[5m]` rate windows. |
| Query cache | Shipped the 300-second in-memory query cache. |
| Circuit breaker | Shipped closed/open/half-open upstream protection with last-known-value fallback. |
| SSE fan-out | Shipped one upstream host-health poll per tenant every five seconds with multiple connected clients supported. |
| Prometheus and Grafana upstreams | Shipped upstream detection and Grafana datasource-proxy resolution. |
| Paste-friendly upstream input | Shipped normalization for bare host:port values and Grafana dashboard URLs. |
| User accounts | Shipped signup, login, profile access, scrypt password hashing, and HMAC sessions. |
| Shareable dashboard links | Shipped owner-managed public share links and read-only dashboard snapshots. |
| Share access modes | Shipped anyone, email allow-list, and organization view/edit access with signed short-lived tokens. |
| Tenant authorization enforcement | Shipped access checks across queries, streams, metrics, panels, pages, widgets, and connection management. |
| Organizations | Shipped invite-code joining, member rosters, workspace attachment, and organization-scoped sharing. |
| Dashboard pages and widgets | Shipped named pages, selectable home pages, persisted widgets, ordering, spans, refresh settings, and shared-view rendering. |
| Multiple upstream connections | Shipped labeled connections, active-connection switching, deletion, and the connection switcher. |
| Alerting | Shipped threshold evaluation, firing/resolved state transitions, webhook retries, CRUD routes, and the alert UI. |
| Live Prometheus integration tests | Shipped gated live-upstream coverage that skips cleanly without test infrastructure. |
| Secret rotation v1 | Shipped version-tagged encrypted payloads and the encryption-key rotation command; JWT rotation intentionally invalidates sessions. |
| `/api/connect` conflict regression | Migration 014 restored the unique `(tenant_id, label)` target required by the connection upsert. Production was verified with repeated successful connect requests. |

## Frontend

| Item | Outcome |
| :--- | :--- |
| Dashboard UI | Shipped the responsive dashboard with cards, gauges, sparklines, and motion styling. |
| Authentication flow | Shipped login/signup routing, session context, and redirects for signed-in users. |
| Inline connection flow | Shipped the connect panel for signed-in users without an upstream. |
| Custom 404 and SPA routing | Shipped Vercel rewrites for login, signup, share URLs, and the branded not-found view. |
| Share view | Shipped public share snapshots with periodic refresh and parity with composed dashboard pages. |
| Friendly connection fallback | Shipped user-facing connection errors and the public demo-Prometheus fallback. |
| Dashboard controls | Shipped refresh cadence, time-window selection, manual refresh, and persisted settings. |
| Per-host drill-down | Shipped instance-scoped dashboard views from the hosts table. |
| Single header chrome | Shipped one application header with embedded dashboard toolbars. |
| Hidden internal identifiers | Removed tenant IDs from user-facing UI. |
| Per-user dashboard density | Shipped persisted widget spans and responsive grid sizing. |
| Profile and sharing inventory | Shipped profile settings, share inventory, password changes, display names, and organization controls. |
| Formula transparency | Shipped visible PromQL formulas and hover details for dashboard cards. |
| Custom panel builder | Shipped editable stat, gauge, sparkline, and hosts-table widgets with persisted PromQL. |
| PromQL helper and metric browser | Shipped metric/label autocomplete, recipes, series exploration, and panel insertion. |
| Rearrangeable dashboards | Shipped drag-reorder and persisted widget span changes. |
| Prometheus/Grafana toggle | Shipped automatic and explicit upstream selection in the connect UI. |
| Multiple dashboard views | Superseded the earlier saved-view design with the full dashboard-pages system. |

## Deployment and Operations

| Item | Outcome |
| :--- | :--- |
| Render free-tier configuration | Removed the restricted pre-deploy command, configured an external `DATABASE_URL`, and validated the live API health endpoint with `db: true`. |
| Render deployment validation | Verified the live `/api/connect` path and repeated connection upserts against the production database. |
| CORS origin handling | Shipped normalized comma-separated origins and added the deployed Vercel origin to the Render configuration. |
| Environment configuration | Shipped dashboard-managed Render/Vercel environment configuration and `.env.example`. |
| Commit authorship policy | Established repository-owner authorship for new commits. |
| Migration/Render todo follow-up | Removed completed migration and Render validation items from the active todo ledger after production verification. |
