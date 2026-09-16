# Product Specification & Master Implementation Plan: Grafana Passthrough Application

## 1. Project Goal
Build a lightweight, production-ready, multi-tenant passthrough proxy and mobile-friendly UI around Grafana. The system ingests a user's Grafana URL and read-only Service Account Token, normalizes panel data, caches heavy queries, and renders a clean interface designed for non-technical users.

---

## 2. Technology Stack & Key Libraries

| Component | Choice | Reason / Purpose |
| :--- | :--- | :--- |
| **Monorepo Architecture** | npm Workspaces | Simple workspace management (`/backend`, `/frontend`) |
| **Backend Framework** | Fastify (Node.js) | High-performance, low overhead, native SSE support |
| **HTTP Client & Pool** | `undici` | High-throughput HTTP/1.1 client with native connection pooling |
| **Cache & Real-Time Engine** | Upstash / Redis | Cache-aside pattern (5-min TTL) & SSE state broadcasting |
| **Database** | PostgreSQL | Tenant metadata, users, & AES-256 encrypted tokens |
| **Frontend Framework** | React + Vite | Fast build times, lightweight SPA execution |
| **Styling & UI** | Tailwind CSS | Utility-first mobile-responsive layout |

---

## 3. Core API Routes & Endpoint Specs

### Backend (`/backend/src/routes/`)

1. **`POST /api/connect`**
   * **Body:** `{ grafanaUrl: string, serviceAccountToken: string, tenantId: string }`
   * **Behavior:** Tests connection against Grafana `/api/dashboards/uid/...`, validates `Viewer` permissions, encrypts token using AES-256-GCM, saves connection metadata to DB, and returns connection status.

2. **`GET /api/dashboards/:uid`**
   * **Query Params:** `?tenantId=...`
   * **Behavior:** Checks Redis cache (`TTL: 300s`). On miss, fetches raw dashboard JSON from Grafana, parses panel specs (titles, types, template variables), caches output, and returns simplified JSON structure.

3. **`POST /api/ds/query`**
   * **Body:** `{ tenantId: string, dashboardUid: string, queries: Array<{ refId: string, expr: string }> }`
   * **Behavior:** Applies PromQL normalizer (injects physical interface filters `eth.*|ens.*`, enforces minimum 5m rate windows). Serves from Redis cache if available (`TTL: 300s`). On cache miss, proxies request through `undici` connection pool to Grafana.

4. **`GET /api/stream` (Server-Sent Events)**
   * **Query Params:** `?tenantId=...&dashboardUid=...`
   * **Behavior:** Establishes persistent SSE connection (`Content-Type: text/event-stream`). Publishes a 5-second live status ping using a single backend polling loop shared across all clients on the same tenant.

---

## 4. Frontend Component Hierarchy (`/frontend/src/components/`)

1. **`ConnectForm.tsx`:** Input form for Grafana URL, Service Account Token, and Tenant ID with live validation feedback.
2. **`DashboardView.tsx`:** Grid container that fetches dashboard metadata and dynamically maps panels to status cards.
3. **`StatusCard.tsx`:** Primary KPI card displaying metric values, units, and status color states (Green/Yellow/Red).
4. **`GaugeCard.tsx`:** Visual percentage gauge (used for RAM and CPU utilization).
5. **`SparkLineCard.tsx`:** Minimalist inline time-series line graph for network bandwidth trends.
6. **`HealthBadge.tsx`:** Header indicator showing real-time SSE stream status (`Live`, `Connecting`, `Disconnected`).

---

## 5. Implementation Roadmap for AI Agent

Follow this exact sequence to build the application:

1. **Phase 1: Foundations & Database Schema**
   * Initialize npm workspaces (`/backend` and `/frontend`).
   * Implement AES-256-GCM encryption helper (`src/db/encryption.ts`).
   * Define database schema for Tenants, Users, and Encrypted Connections.

2. **Phase 2: Backend Core Services**
   * Implement Undici-backed Grafana API client (`src/services/grafana.ts`).
   * Implement Cache-aside wrapper with fallback logic (`src/services/cache.ts`).
   * Implement Circuit Breaker state machine (`src/services/circuitBreaker.ts`).
   * Build query normalizer logic for PromQL interface scrubbing.

3. **Phase 3: API Routes & SSE Engine**
   * Build `/api/connect`, `/api/dashboards/:uid`, and `/api/ds/query` routes.
   * Build single-poll SSE fan-out engine (`src/services/sse.ts`) and `/api/stream` endpoint.

4. **Phase 4: Frontend Build**
   * Scaffold React app with Vite and Tailwind CSS.
   * Implement API client (`lib/api.ts`) and SSE hook (`hooks/useSSE.ts`).
   * Build UI components (`ConnectForm`, `DashboardView`, `StatusCard`, `GaugeCard`, `SparkLineCard`, `HealthBadge`).

5. **Phase 5: Verification & Testing**
   * Verify token validation works and rejects invalid inputs.
   * Verify virtual interface filtering works on queries containing `node_network_receive_bytes_total`.
   * Verify Redis cache returns data within <10ms on hit.
   * Connect 10 simultaneous SSE browser clients and verify backend issues only 1 request per interval to Grafana.