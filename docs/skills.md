# Agent Skills & Operational Capabilities (`SKILLS.md`)

This document outlines the specialized tools, domain skills, and execution capabilities available to AI agents operating inside the Grafana Passthrough monorepo.

---

## 1. Skill: `promql-normalizer`

- **Description:** Parses, scrubs, and normalizes PromQL queries prior to upstream proxy execution to prevent metric inflation and server strain.
- **Execution Directives:**
  - **Physical Network Scrubbing:** Inspect all network metric queries (such as `node_network_receive_bytes_total` and `node_network_transmit_bytes_total`). Inject regex filters matching physical/bonded interfaces only: `device=~"eth.*|ens.*|eno.*|bond.*"`. Strip or replace `device!="lo"`.
  - **Memory Metric Standard:** Rewrite any occurrences of `node_memory_MemFree_bytes` to use `node_memory_MemAvailable_bytes`.
  - **Rate Vector Range:** Check `rate(metric[window])` queries. If `window` is under `5m` (e.g., `1m`, `30s`), elevate it to `[5m]`.

---

## 2. Skill: `token-vault-crypto`

- **Description:** Provides zero-leakage encryption and decryption for Grafana Service Account Tokens before database persistence.
- **Execution Directives:**
  - Use Node.js native `crypto` module with algorithm `aes-256-gcm`.
  - Require a 32-byte secret key provided via `ENCRYPTION_SECRET`.
  - Format encrypted tokens as `iv:authTag:encryptedData` (hex-encoded).
  - Ensure raw tokens or decrypted strings are never printed to stdout, stderr, or system logs.

---

## 3. Skill: `circuit-breaker-engine`

- **Description:** Protects upstream Grafana instances by managing a three-state machine (Closed, Open, Half-Open) around all HTTP socket pools.
- **Execution Directives:**
  - **Trip Threshold (Closed $\rightarrow$ Open):** Trip the circuit breaker if 5 consecutive upstream requests fail or exceed a 3000ms timeout threshold.
  - **Open State Behavior:** Immediately reject upstream calls for 30 seconds and return cached stale data or fallback state payload (`503 Service Unavailable`).
  - **Half-Open Probe:** Execute 1 trial request after 30 seconds. On success, reset state to Closed; on failure, restart the 30-second Open timer.

---

## 4. Skill: `sse-fanout-broadcaster`

- **Description:** Manages the low-overhead single-poll multi-client real-time stream engine in Fastify.
- **Execution Directives:**
  - Maintain an active in-memory connection map of client SSE response streams keyed by `tenantId`.
  - Execute exactly **one** backend health-check query every 5 seconds per active `tenantId`.
  - Broadcast the single result payload simultaneously to all connected client streams attached to that `tenantId`.
  - Automatically clean up connection references on client socket close (`req.raw.on('close')`).

---

## 5. Skill: `grafana-schema-parser`

- **Description:** Transforms raw Grafana dashboard JSON models (`/api/dashboards/uid/:uid`) into clean mobile UI component contracts.
- **Execution Directives:**
  - Extract panel `title`, `type` (`singlestat`, `stat`, `gauge`, `timeseries`), and `targets` (PromQL queries).
  - Filter out unsupported layout panels (text blocks, row headers, legacy plugins).
  - Map extracted panels to frontend visual targets:
    - `stat` / `singlestat` $\rightarrow$ `<StatusCard />`
    - `gauge` $\rightarrow$ `<GaugeCard />`
    - `timeseries` $\rightarrow$ `<SparkLineCard />`

---

## 6. Skill: `vitest-monorepo-runner`

- **Description:** Executes and validates automated test suites across workspace boundaries.
- **Execution Directives:**
  - Run backend route integration tests using Fastify `app.inject()`.
  - Mock external Undici calls to Grafana endpoints and Upstash/Redis caching layers using Vitest spies.
  - Execute frontend component rendering tests via React Testing Library.
  - Ensure 100% test pass rate upon running `npm test`.

  ***

## 7. Skill: `frontend-ui-designer`

- **Description:** Constructs mobile-first, dark-themed React monitoring interfaces using Tailwind CSS, Recharts, Framer Motion, and Lucide icons.
- **Execution Directives:**
  - **Design System:** Apply dark obsidian styling (`bg-zinc-950` root, `bg-zinc-900/60` glassmorphic cards with `backdrop-blur-md` and `border-zinc-800`).
  - **Component Mapping:**
    - Map single-stat metrics to `<StatusCard />` with dynamic status glows (`emerald`, `amber`, `rose`).
    - Map percentage gauges (CPU/RAM) to `<GaugeCard />` using Recharts semi-circle or SVG ring meters.
    - Map time-series trends (bandwidth) to `<SparkLineCard />` using `<AreaChart>` with gradient opacity fills.
  - **Real-time UX:** Wire `<HealthBadge />` directly to `useSSE` hook state to indicate live stream status (`Live`, `Connecting`, `Disconnected`).
  - **Security Constraint:** Never call Grafana APIs directly from frontend components—route all data fetching strictly through Fastify proxy hooks (`useDashboard`, `lib/api.ts`).
