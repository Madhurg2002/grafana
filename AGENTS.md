# Instructions & Guidelines for AI Coding Agents

## Core Directives
1. **Strict TypeScript:** Do not use `any`. Define explicit interfaces or TypeBox/Zod schemas for all request/response models and environment variables.
2. **Framework Alignment:**
   * Backend: **Fastify** (use standard plugins: `@fastify/cors`, `@fastify/rate-limit`).
   * Frontend: **React** with **Vite** and **Tailwind CSS** (plus `recharts`, `framer-motion`, and `lucide-react`).
3. **No External Grafana Dependency:** Route all metric requests directly to Prometheus endpoints (`/api/v1/query` and `/api/v1/query_range`). A pasted Grafana URL is *resolved to its Prometheus datasource* (see `backend/src/services/upstream.ts`) — never proxy Grafana dashboards/panels.
4. **Never Bypass Security:** All Prometheus/Grafana credentials/tokens passed to the backend must be encrypted via `src/db/encryption.ts` using AES-256-GCM before database persistence.

## Git Workflow
* At the start of every task, check whether `main` has commits that are not present in the current branch and review them before making changes.
* Keep work on the current branch and merge completed changes into that branch by default.
* Do not create or switch to a new branch unless the user explicitly requests it or the task requires isolated parallel work.
* When a branch is explicitly needed, name it after the task being performed and merge it back before finishing when the user has asked for an end-to-end change.

## Project Docs (keep these in sync)
| File | Purpose | Update rule |
| :--- | :--- | :--- |
| `docs/capabilities.md` | Full capability map: what exists, where it lives, how it is tested | Add/update a row **in the same commit** when a run ships or changes a capability |
| `docs/todo.md` | ONLY the remaining work + when each item should be done (no completed rows) | Add/update/remove rows in the **same commit** as the work that changes them; remove rows when they ship |
| `docs/deferred.md` | Current unfinished work and known limitations | Add unresolved items in the same commit; remove items when they ship. Do not keep completed rows here. |
| `docs/deferred-history.md` | Historical record of work that was once deferred and later shipped | Move completed deferred items here when removing them from `docs/deferred.md`; do not add active work here. |
| `docs/skills.md` | Deep-dive on services/architecture | Update when the described behavior changes |
| `docs/repoStructure.md` | File-tree conventions | Update when adding/removing top-level structure |

## Auto Code Review (MANDATORY)
After finishing a run that adds or modifies a capability (any row in `docs/capabilities.md` that this run touched):
1. Run `npm run capability-review` to list the touched capabilities and their Where-file lists.
2. For EACH affected capability, review the files listed in its "Where" column end-to-end: correctness, security (auth + encryption paths), PromQL safety laws, error shape `{ error, details? }`, and test coverage.
3. Fix every finding in the same run (not a new run), then re-run `npm run verify` (typecheck + all tests) until green.
4. Record the review outcome (findings + fixes) in the commit message body so the history shows each capability was reviewed.

## Standard Verification
* End of every run: `npm run verify` (typecheck both workspaces + full test suite).
* Migration questions: `npm run db:migrate:status` (read-only; MODIFIED rows fail closed at apply time).
* Live sanity after connecting/deploying: `npm run smoke:live` (BASE may be scheme-less).

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
7. **Anything you cannot finish now?** → add it to `docs/deferred.md` in the SAME commit; remove it when it ships.

## Migrations Policy
* `backend/src/db/migrations/` files are standalone; the app runtime NEVER runs them implicitly.
* Prefer applying schema changes explicitly with `npm run db:migrate` from a migration-capable environment before deployment. The backend currently also applies pending migrations during boot via `bootstrapDatabase`; keep that as a bounded startup safety net, but do not depend on a Render pre-deploy command when using the free tier.
* One migration per schema change, named `0NN-description.ts`, registered in `migrations/index.ts`. Immutable once applied.
