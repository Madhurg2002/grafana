# Instructions & Guidelines for AI Coding Agents

## Core Directives
1. **Strict TypeScript:** Do not use `any`. Define explicit interfaces or TypeBox/Zod schemas for all request/response models and environment variables.
2. **Framework Alignment:**
   * Backend: **Fastify** (use standard plugins: `@fastify/cors`, `@fastify/rate-limit`).
   * Frontend: **React** with **Vite** and **Tailwind CSS** (plus `recharts`, `framer-motion`, and `lucide-react`).
3. **No External Grafana Dependency:** Route all metric requests directly to Prometheus endpoints (`/api/v1/query` and `/api/v1/query_range`). A pasted Grafana URL is *resolved to its Prometheus datasource* (see `backend/src/services/upstream.ts`) — never proxy Grafana dashboards/panels.
4. **Never Bypass Security:** All Prometheus/Grafana credentials/tokens passed to the backend must be encrypted via `src/db/encryption.ts` using AES-256-GCM before database persistence.

## Project Docs (keep these in sync)
| File | Purpose | Update rule |
| :--- | :--- | :--- |
| `docs/capabilities.md` | Full capability map: what exists, where it lives, how it is tested | Add/update a row **in the same commit** when a run ships or changes a capability |
| `docs/todo.md` | ONLY the remaining work + when each item should be done (no completed rows) | Add/update/remove rows in the **same commit** as the work that changes them; remove rows when they ship |
| `docs/deferred.md` | Historical deferred ledger (append-only) | Append rows for anything unfinished in a commit; flip to ✅ when it ships — never delete |
| `docs/skills.md` | Deep-dive on services/architecture | Update when the described behavior changes |
| `docs/repoStructure.md` | File-tree conventions | Update when adding/removing top-level structure |

## Auto Code Review (MANDATORY)
After finishing a run that adds or modifies a capability (any row in `docs/capabilities.md` that this run touched):
1. Re-read the touched rows in `docs/capabilities.md` to identify each affected capability.
2. For EACH affected capability, review the files listed in its "Where" column end-to-end: correctness, security (auth + encryption paths), PromQL safety laws, error shape `{ error, details? }`, and test coverage.
3. Fix every finding in the same run (not a new run), then re-run `npm run typecheck` and `npm test` until green.
4. Record the review outcome (findings + fixes) in the commit message body so the history shows each capability was reviewed.

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
