# Prometheus Passthrough Monorepo

A high-throughput, stateless Node.js Fastify backend proxy and mobile-first React frontend designed to securely route, cache, and stream Prometheus PromQL queries and real-time host telemetry directly—completely eliminating Grafana dependencies.

## Tech Stack & Architecture

* **Monorepo Manager:** `npm` Workspaces (`/backend` and `/frontend`)
* **Backend:** Fastify, TypeScript, Undici (socket pooling), `lru-cache`, `@fastify/rate-limit`, `@fastify/cors`
* **Frontend:** React, Vite, TypeScript, Tailwind CSS, Recharts, Framer Motion, Lucide Icons
* **Database & Security:** PostgreSQL schema with AES-256-GCM token encryption for Prometheus credentials
* **Testing:** Vitest + React Testing Library

## Key Features

* **Direct Prometheus Target:** Proxies `/api/v1/query` and `/api/v1/query_range` directly without extra middleware layers.
* **PromQL Safety Enforcement:** Automatically injects physical network interface filters (`eth.*|ens.*|eno.*|bond.*`), standardizes RAM metrics to `node_memory_MemAvailable_bytes`, and enforces `[5m]` minimum rate windows.
* **In-Memory Cache Architecture:** Sub-millisecond `lru-cache` with a 300-second (5-minute) TTL on query results to prevent upstream query floods.
* **SSE Real-Time Engine:** Single-poll background loop (1 query / 5s / tenant) broadcasting host health status updates to multiple connected clients via Server-Sent Events.
* **Upstream Resilience:** 3-state circuit breaker (Closed → Open after 5 failures or 3000ms timeouts → 30s cooldown → Half-Open probe) with last-known-value fallback.

## Quickstart

```bash
# 1. Install all workspace dependencies
npm install

# 2. Configure environment (copy template → fill secrets)
cp .env.example .env
#   ENCRYPTION_KEY and JWT_SECRET: openssl rand -hex 32
#   DATABASE_URL: your PostgreSQL instance

# 3. Run backend (3000) and frontend (5173) together
npm run dev

# 4. Open the dashboard
# http://localhost:5173
```

## API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/connect` | POST | Probe Prometheus `up`, encrypt token (AES-256-GCM), persist connection |
| `/api/query` | POST | Normalized instant query (cached, breaker-wrapped) |
| `/api/query_range` | POST | Normalized range query for sparklines (cached) |
| `/api/stream` | GET (SSE) | Live host health; one upstream poll per 5s per tenant, fanned out to all clients |
| `/api/health` | GET | Liveness + DB + circuit state |

Example:

```bash
curl -X POST http://localhost:3000/api/connect \
  -H 'content-type: application/json' \
  -d '{"tenantId":"team-1","prometheusUrl":"https://prom.example.com","authToken":"optional"}'

curl -X POST http://localhost:3000/api/query \
  -H 'content-type: application/json' \
  -d '{"tenantId":"team-1","query":"up"}'
```

## Testing

```bash
npm test          # backend (Vitest + app.inject) + frontend (RTL) suites
npm run typecheck # strict tsc across both workspaces
```

## Project Structure

```text
prometheus-passthrough/
├── docs/               # Architecture decision log, skills, deferred items
├── backend/            # Fastify server, DB schema, SSE engine, & proxy routes
└── frontend/           # React dashboard UI, metric cards, & SSE hooks
```

## Deferred / Known Limitations

See [`docs/deferred.md`](docs/deferred.md) for the full list (live DB/Prometheus integration tests, route-level tenant token enforcement, production env provisioning).
