# Architectural Research & Decision Log

## Overview
This document outlines the engineering decisions, performance bottlenecks, and security trade-offs for the Grafana Passthrough Proxy application.

---

## 1. Throughput & Rate Protection Strategy

### Problem Statement
Standard Grafana instances are designed for interactive human usage (typically 10-50 requests/second capacity). Exposing a Grafana instance directly to hundreds of non-technical users or mobile clients will cause connection pool exhaustion, elevated latency, and server crashes.

### Technical Solutions
1. **5-Minute Cache TTL for Time-Series Queries:**
   * Metric panels (CPU, RAM, Network) are cached for 300 seconds (5 minutes) in Redis.
   * *Rationale:* Non-technical users checking system status do not require sub-second metric precision. Caching queries reduces Grafana load by up to 95%.
2. **Single-Poll Fan-Out Engine (SSE):**
   * Instead of $N$ clients independently polling Grafana every 5 seconds, the proxy backend executes **one** background health check query per target instance and broadcasts the result to all connected clients over Server-Sent Events (SSE).
3. **HTTP Connection Pooling (Undici):**
   * Backend-to-Grafana HTTP requests are multiplexed over a persistent connection pool capped at 10 concurrent sockets per Grafana host to prevent socket exhaustion.
4. **Circuit Breaker Pattern:**
   * If Grafana responds with `5xx` errors or timing out (>3s latency) on 5 consecutive requests, the proxy trips the circuit breaker open for 30 seconds, serving cached fallback data instead of swamping the upstream service.

---

## 2. PromQL Normalization & Metric Inflation Fixes

### Virtual Network Interface Inflation
* **Issue:** Default Node Exporter queries like `node_network_receive_bytes_total{device!="lo"}` capture Docker (`veth*`), Calico (`cali*`), and container bridge interfaces, over-reporting real physical traffic by $2\times$ to $10\times$.
* **Fix:** The query normalizer injects regex filters to match only physical/bonded interfaces:
  `device=~"eth.*|ens.*|eno.*|bond.*"`

### Small `rate()` Calculation Windows
* **Issue:** Queries using short range vectors like `rate(metric[1m])` produce `NaN` values or missing points if Prometheus drops a single scrape cycle.
* **Fix:** The query normalizer enforces range vectors of at least `[5m]` or `$__range` dynamically.

---

## 3. Data Storage & Multi-Tenancy Strategy

### User Data vs. Metric Caching Split
* **Tenant & User Database (Relational - PostgreSQL):**
  * Stores user identity, session state, tenant mappings, and encrypted Grafana connection configurations.
  * *Partitioning Strategy:* All queries filter by `tenant_id`. Tables are indexed by `(tenant_id, id)` to enable seamless horizontal partitioning/sharding as user volume scales.
* **Metric Cache (Key-Value - Redis):**
  * Holds raw PromQL JSON responses, parsed dashboard models, and ephemeral SSE state.
  * Uses deterministic cache keys: `grafana:query:{tenant_id}:{dashboard_uid}:{query_hash}`.

---

## 4. Security & Least Privilege

* **Viewer-Only Service Accounts:** The application strictly enforces read-only access. During URI ingestion, the proxy issues a test call to `/api/dashboards/uid/{uid}` using the provided token. If the token possesses `Admin` or `Editor` roles, the system warns or restricts token permissions.
* **Token Encryption at Rest:** Service account tokens are encrypted using **AES-256-GCM** with a rotating master key prior to database insertion.