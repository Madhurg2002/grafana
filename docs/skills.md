# Agent Skills & Operational Capabilities (`SKILLS.md`)

This document outlines the specialized tools, domain skills, and execution capabilities available to AI agents operating inside the Prometheus Passthrough monorepo.

---

## 1. Skill: `promql-normalizer`
- **Description:** Parses, scrubs, and normalizes PromQL queries prior to upstream proxy execution.
- **Execution Directives:**
  - **Physical Network Scrubbing:** Inspect network queries (`node_network_receive_bytes_total`, `node_network_transmit_bytes_total`) and inject physical interface selectors: `device=~"eth.*|ens.*|eno.*|bond.*"`.
  - **Memory Metric Standard:** Rewrite `node_memory_MemFree_bytes` to `node_memory_MemAvailable_bytes`.
  - **Rate Vector Range:** Enforce a minimum `[5m]` range vector on all `rate()` functions.

---

## 2. Skill: `token-vault-crypto`
- **Description:** Provides zero-leakage AES-256-GCM encryption and decryption for authentication tokens.
- **Execution Directives:**
  - Use Node.js native `crypto` with `aes-256-gcm`.
  - Format output as `iv:authTag:ciphertext` (hex-encoded).
  - Never print unencrypted tokens to logs.

---

## 3. Skill: `circuit-breaker-engine`
- **Description:** Manages a 3-state machine (Closed, Open, Half-Open) around Prometheus HTTP client pools.
- **Execution Directives:**
  - Trip to Open after 5 consecutive failures or 3000ms timeouts.
  - Open state: Reject requests for 30s and serve cached fallback.
  - Half-Open: Send 1 probe request after 30s to verify upstream recovery.

---

## 4. Skill: `sse-fanout-broadcaster`
- **Description:** Manages single-poll multi-client real-time streaming over Fastify SSE.
- **Execution Directives:**
  - Maintain active SSE connections keyed by `tenantId`.
  - Execute 1 backend health-check query every 5 seconds per tenant.
  - Broadcast single payload simultaneously to all tenant clients.
  - Clean up client references on socket close (`req.raw.on('close')`).

---

## 5. Skill: `frontend-ui-designer`
- **Description:** Builds mobile-first dark obsidian monitoring UIs.
- **Execution Directives:**
  - Apply `bg-zinc-950` background with `bg-zinc-900/60 backdrop-blur-md` glassmorphic cards.
  - Render percentage metrics in `<GaugeCard />` using Recharts.
  - Render time-series trends in `<SparkLineCard />` using Recharts area charts with gradient fills.
  - Connect `<HealthBadge />` directly to `useSSE` hook status.

---

## 6. Skill: `vitest-monorepo-runner`
- **Description:** Executes automated tests across backend and frontend workspaces.
- **Execution Directives:**
  - Test Fastify routes via `app.inject()`.
  - Mock external Undici calls to Prometheus via Vitest spies.
  - Test React components via React Testing Library.
  - Verify 100% pass rate on `npm test`.

---

## 7. Skill: `run-verification-loop`
- **Description:** The standard end-of-run gate: typecheck + full tests in one command.
- **Execution Directives:**
  - Run `npm run verify` (typecheck both workspaces, then all tests) after any capability change.
  - Fix every finding in the same run; re-run until green.
  - Never report completion on an unverified tree.

---

## 8. Skill: `migration-status-audit`
- **Description:** Inspects schema drift before/after deploys without changing anything.
- **Execution Directives:**
  - `npm run db:migrate:status` lists applied / pending / MODIFIED / orphan rows.
  - MODIFIED (checksum drift) exits non-zero — resolve by adding a NEW migration, never by editing the applied file (runner fails closed anyway).
  - Run it right after a production deploy to confirm the pre-deploy command applied everything.

---

## 9. Skill: `capability-mapping`
- **Description:** Feeds the AGENTS.md auto code-review: maps changed files to the capabilities they touch.
- **Execution Directives:**
  - `npm run capability-review` diffs the working tree (or pass a commit/range arg) against `docs/capabilities.md` rows.
  - For each printed capability, read every file in its Where column end-to-end: correctness, security, PromQL laws, error shape, tests.
  - Record findings + fixes in the commit message body.

---

## 10. Skill: `live-smoke`
- **Description:** End-to-end sanity check against a real Prometheus after connecting or deploying.
- **Execution Directives:**
  - `API=<backend-url> BASE=<prometheus-host> npm run smoke:live` (BASE can be scheme-less — exercises the https-inference path).
  - Covers health → connect/auto-detect → normalized instant query → pages → SSE handshake.
  - Any step failing means the pipeline is broken; fix before shipping.