# Contributing to Prometheus Passthrough

Thanks for helping out! This is a small monorepo: a Fastify backend that proxies
Prometheus (multi-tenant, with custom dashboards, sharing, and alerting) and a
React + Vite frontend.

## Getting started

```bash
npm install          # installs both workspaces
npm run dev          # backend + frontend dev servers
npm run verify       # typecheck both workspaces + full Vitest suite
```

Environment: copy `.env.example` to `.env.local` (if present) and fill in the
values described in `backend/src/config/env.ts`. The app fail-fasts at boot on
missing required variables.

## Project rules (enforced in review)

1. **Strict TypeScript** — no `any`. Request/response models use Zod schemas.
2. **Backend framework** — Fastify with standard plugins (`@fastify/cors`,
   `@fastify/rate-limit`, `@fastify/helmet`). No Express.
3. **Frontend** — React + Vite + Tailwind. No additional state library unless
   discussed first.
4. **All upstream Prometheus access goes through `services/prometheus.ts`**
   (circuit breaker + cache + normalizer). Never `fetch()` Prometheus directly
   from a route.
5. **Credentials are encrypted** with AES-256-GCM (`db/encryption.ts`) before
   they touch the database. No plaintext tokens, ever.
6. **PromQL safety laws** (see `AGENTS.md`): network-device filters on device
   metrics, `MemAvailable_bytes` not `MemFree`, range vectors `[5m]`+.
7. **Errors** are always `{ error, details? }` with Zod issue paths.
8. **Migrations** are immutable once applied; new schema change = new file
   `0NN-description.ts` registered in `migrations/index.ts`.
9. **Tests** — every backend service/route and frontend component change ships
   with Vitest coverage. `npm run verify` must pass before merge.
10. **Never render internal identifiers** (tenant IDs, user IDs) in the UI.

## Commit style

Short imperative subject (`feat:`, `fix:`, `docs:`, `chore:`), body explaining
the why. One logical change per commit.

## Docs to keep in sync

`docs/capabilities.md`, `docs/todo.md`, `docs/deferred.md`, and
`docs/skills.md` describe the current system. Update them in the same commit as
the code that changes them.
