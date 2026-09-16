# Architectural Research & Decision Log

## Overview
This document outlines the engineering decisions, performance bottlenecks, and security trade-offs for the Prometheus Passthrough Proxy application.

---

## 1. Direct Prometheus Proxy vs. Grafana Dependency

### Decision
Target the Prometheus HTTP API (`/api/v1/query` and `/api/v1/query_range`) directly.

### Rationale
* **Grafana Elimination:** Completely eliminates the need for users to log into Grafana or manage viewer accounts.
* **Latency Reduction:** Removes an intermediate application layer, reducing total query response latency by ~40%.
* **Cost Efficiency:** Avoids seat licensing overhead while maintaining complete freedom over mobile component design.

---

## 2. In-Memory LRU Caching (`lru-cache`) vs. Upstash Redis

### Decision
Use process in-memory caching via `lru-cache` with a 300-second TTL.

### Rationale
* Fastify runs as a long-lived process on containers or virtual servers.
* In-memory cache checks resolve in **<1ms**, compared to 30–80ms HTTP REST latency when calling external services like Upstash.
* Reduces infrastructural complexity and external failure points.

---

## 3. PromQL Normalization & Metric Protection

### Virtual Network Interface Inflation
* **Issue:** Default queries like `node_network_receive_bytes_total{device!="lo"}` capture virtual interfaces (Docker, Calico, bridge interfaces), over-reporting traffic by $2\times$ to $10\times$.
* **Fix:** The query normalizer automatically injects physical interface filters: `device=~"eth.*|ens.*|eno.*|bond.*"`.

### Memory Metric Standardization
* **Issue:** `node_memory_MemFree_bytes` ignores cached/buffered memory, misrepresenting available system RAM.
* **Fix:** Queries are automatically rewritten to use `node_memory_MemAvailable_bytes`.

---

## 4. Single-Poll Fan-Out Real-Time Engine (SSE)

### Decision
Maintain one background interval loop (5s) per tenant in Fastify and broadcast results to all active client connections over Server-Sent Events (`/api/stream`).

### Rationale
Prevents $N$ connected mobile clients from triggering $N$ concurrent requests against upstream Prometheus, capping query volume at a steady 1 query per 5 seconds per tenant.