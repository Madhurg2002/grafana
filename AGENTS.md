# Instructions & Guidelines for AI Coding Agents

## Core Directives
1. **Strict TypeScript:** Do not use `any`. Define explicit interfaces or TypeBox/Zod schemas for all request/response models and environment variables.
2. **Framework Alignment:**
   * Backend: **Fastify** (use standard plugins: `@fastify/cors`, `@fastify/rate-limit`).
   * Frontend: **React** with **Vite** and **Tailwind CSS**.
3. **No Direct Grafana Client Calls:** The frontend must NEVER call Grafana APIs directly. All requests must pass through the Fastify proxy backend.
4. **Never Bypass Security:** All Service Account Tokens passed to the backend must be encrypted via `src/db/encryption.ts` before persistence.

## PromQL Safety Laws
When generating or modifying PromQL queries in `backend/src/services/grafana.ts`:
* ALWAYS filter network devices using `device=~"eth.*|ens.*|eno.*|bond.*"`.
* NEVER write `device!="lo"` without physical interface filtering.
* ALWAYS use `node_memory_MemAvailable_bytes` for RAM calculations, NEVER `node_memory_MemFree_bytes`.
* Range vectors for `rate()` must be `[5m]` or larger.

## Code Style Rules
* Use async/await syntax exclusively (no raw `.then()` promises).
* Wrap external HTTP calls (to Grafana or Redis) in try/catch blocks with circuit breaker handling.
* Write clean, self-documenting code with concise inline comments explaining complex logic.