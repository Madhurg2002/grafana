# Grafana Passthrough Monorepo

A high-throughput, stateless Node.js Fastify backend proxy and mobile-first React frontend designed to securely route, cache, and stream Grafana PromQL queries and real-time host telemetry.

## Tech Stack & Architecture

* **Monorepo Manager:** `npm` Workspaces (`/backend` and `/frontend`)
* **Backend:** Fastify, TypeScript, Undici (socket pooling), `@upstash/redis`, `@fastify/rate-limit`, `@fastify/cors`
* **Frontend:** React, Vite, TypeScript, Tailwind CSS
* **Database & Security:** PostgreSQL schema definitions with AES-256-GCM token encryption for Grafana Viewer service account tokens

## Key Features

* **PromQL Safety Enforcement:** Automatically injects physical network interface filters (`eth.*|ens.*|eno.*|bond.*`), forces `node_memory_MemAvailable_bytes`, and enforces `[5m]` minimum rate range vectors.
* **Cache-Aside Architecture:** Redis caching with a 300-second (5-minute) TTL on metric queries and dashboard metadata to prevent upstream Grafana rate limits.
* **SSE Real-Time Engine:** Single-poll background loop broadcasting host health status updates to multiple connected clients via Server-Sent Events.
* **Upstream Resilience:** Circuit breaker pattern with automatic fallback and connection pooling via Undici.

## Project Structure

```text
grafana-passthrough/
├── docs/               # Architecture decision log & agent rules
├── backend/            # Fastify server, DB schema, SSE engine, & proxy routes
└── frontend/           # React dashboard UI, metric cards, & SSE hooks