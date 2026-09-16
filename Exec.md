# Product Specification & Implementation Plan: Prometheus Passthrough Monorepo

## 1. Project Goal
Build a lightweight, multi-tenant passthrough proxy and mobile-responsive UI directly around Prometheus (eliminating Grafana). The system ingests a user's Prometheus URL and authentication tokens, normalizes PromQL queries, caches heavy payloads in-memory, and renders a dark glassmorphic dashboard designed for non-technical users.

---

## 2. Technology Stack & Key Libraries

| Component | Choice | Reason / Purpose |
| :--- | :--- | :--- |
| **Monorepo Architecture** | npm Workspaces | Simple workspace management (`/backend`, `/frontend`) |
| **Backend Framework** | Fastify (Node.js) | High-performance API proxy with native SSE support |
| **HTTP Client & Pool** | `undici` | High-throughput connection pooling to Prometheus |
| **Caching Layer** | `lru-cache` | Sub-millisecond in-memory LRU caching (300s TTL) |
| **Database** | PostgreSQL | Multi-tenant metadata & AES-256-GCM encrypted tokens |
| **Frontend Framework** | React + Vite | Fast build times and lightweight SPA client |
| **UI & Styling** | Tailwind CSS + Recharts + Framer Motion | Dark glassmorphic design, smooth animations, dynamic charts |
| **Testing** | Vitest + React Testing Library | Full monorepo unit and integration testing |

---

## 3. Core API Routes & Endpoint Specs

### Backend (`/backend/src/routes/`)

1. **`POST /api/connect`**
   * **Body:** `{ prometheusUrl: string, authToken?: string, tenantId: string }`
   * **Behavior:** Tests connection against Prometheus `/api/v1/query?query=up`, encrypts authentication token via AES-256-GCM, persists connection metadata to PostgreSQL, and returns connection status.

2. **`POST /api/query`**
   * **Body:** `{ tenantId: string, query: string, time?: string }`
   * **Behavior:** Applies PromQL safety normalizer (injects physical interface filters `eth.*|ens.*`, forces `node_memory_MemAvailable_bytes`, enforces minimum 5m rate vectors). Serves from `lru-cache` on hit (300s TTL). On miss, proxies request to Prometheus `/api/v1/query`.

3. **`POST /api/query_range`**
   * **Body:** `{ tenantId: string, query: string, start: string, end: string, step: string }`
   * **Behavior:** Applies PromQL normalizer and serves time-series data from `lru-cache` or proxies request to Prometheus `/api/v1/query_range`.

4. **`GET /api/stream` (Server-Sent Events)**
   * **Query Params:** `?tenantId=...`
   * **Behavior:** Establishes persistent SSE stream (`Content-Type: text/event-stream`, `X-Accel-Buffering: no`). Executes 1 background interval poll (every 5 seconds) per tenant and fans out live host health to all connected clients.

---

## 4. Frontend Component Hierarchy (`/frontend/src/components/`)

1. **`ConnectForm.tsx`:** Form for Prometheus URL, optional auth token, and Tenant ID.
2. **`DashboardView.tsx`:** Grid layout orchestrating metric fetch hooks and panel cards.
3. **`StatusCard.tsx`:** Primary KPI card displaying metric values, unit badges, and status glows (`emerald`, `amber`, `rose`).
4. **`GaugeCard.tsx`:** Semi-circle percentage meter for CPU and RAM utilization using Recharts.
5. **`SparkLineCard.tsx`:** Minimalist line/area chart showing network throughput with gradient fills.
6. **`HealthBadge.tsx`:** Top navbar pill indicating live SSE connection state (`Live`, `Connecting`, `Disconnected`).

---

## 5. Implementation Roadmap for AI Agent

1. **Phase 1: Foundations & Root Setup**
   * Initialize npm workspaces (`/backend` and `/frontend`).
   * Generate `.gitignore`, root `package.json`, `.env.example`, `render.yaml`, and `.cursorrules`.
   * Implement AES-256-GCM encryption in `backend/src/db/encryption.ts` and PostgreSQL schema in `backend/src/db/schema.ts`.

2. **Phase 2: Backend Core Services**
   * Implement Undici-backed client in `backend/src/services/prometheus.ts` with PromQL normalization rules.
   * Build `lru-cache` wrapper in `backend/src/services/cache.ts` (300s TTL).
   * Implement 3-state circuit breaker in `backend/src/services/circuitBreaker.ts`.
   * Build single-poll SSE broadcaster engine in `backend/src/services/sse.ts`.

3. **Phase 3: API Routes**
   * Implement `/api/connect`, `/api/query`, `/api/query_range`, and `/api/stream`.

4. **Phase 4: Frontend Development**
   * Build React client with Tailwind CSS, Recharts, Framer Motion, and Lucide icons.
   * Implement API client (`lib/api.ts`) and SSE consumer hook (`hooks/useSSE.ts`).
   * Build `ConnectForm`, `DashboardView`, `GaugeCard`, `SparkLineCard`, `StatusCard`, and `HealthBadge`.

5. **Phase 5: Test Automation**
   * Write Vitest unit and route integration tests across backend and frontend. Ensure `npm test` passes cleanly.