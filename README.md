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
* **SSE Real-Time Engine:** Single-poll background loop broadcasting host health status updates to multiple connected clients via Server-Sent Events.
* **Upstream Resilience:** Circuit breaker pattern with automatic fallback and connection pooling via Undici.

## Project Structure

```text
prometheus-passthrough/
├── docs/               # Architecture decision log & agent rules
├── backend/            # Fastify server, DB schema, SSE engine, & proxy routes
└── frontend/           # React dashboard UI, metric cards, & SSE hooks