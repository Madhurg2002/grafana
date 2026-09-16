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