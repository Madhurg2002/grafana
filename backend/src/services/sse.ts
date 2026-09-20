import { getCircuitBreaker, CircuitOpenError } from "./circuitBreaker.js";
import { instantQuery, type PromResultValue } from "./prometheus.js";
import type { AlertEvent } from "./alertEvaluator.js";

/**
 * Single-poll SSE fan-out engine (docs/skills.md §4).
 *
 * One background interval (5s) per tenant queries Prometheus once and
 * broadcasts the identical payload to every connected client, capping
 * upstream load at 1 query / 5s / tenant regardless of client count.
 */

export const STREAM_INTERVAL_MS = 5000;

export type SseClient = (payload: string) => void;

export interface HostHealth {
  tenantId: string;
  timestamp: number;
  hosts: Array<{
    instance: string;
    job: string;
    up: number;
  }>;
  upstream: "live" | "stale" | "error";
}

interface TenantStream {
  clients: Map<number, SseClient>;
  interval: NodeJS.Timeout | null;
  nextClientId: number;
  lastPayload: string | null;
  lastPollAt: number | null;
}

class SseBroadcaster {
  private readonly tenants = new Map<string, TenantStream>();
  private readonly pollInFlight = new Set<string>();

  public addClient(tenantId: string, client: SseClient): () => void {
    let stream = this.tenants.get(tenantId);
    if (stream === undefined) {
      stream = {
        clients: new Map(),
        interval: null,
        nextClientId: 0,
        lastPayload: null,
        lastPollAt: null,
      };
      this.tenants.set(tenantId, stream);
      stream.interval = setInterval(() => {
        void this.pollTenant(tenantId);
      }, STREAM_INTERVAL_MS);
      stream.interval.unref?.();
      // Kick off an immediate poll so the first client gets data fast.
      void this.pollTenant(tenantId);
    }

    const clientId = stream.nextClientId++;
    stream.clients.set(clientId, client);
    // Replay the most recent payload immediately for late joiners.
    if (stream.lastPayload !== null) {
      client(stream.lastPayload);
    }

    return () => this.removeClient(tenantId, clientId);
  }

  public removeClient(tenantId: string, clientId: number): void {
    const stream = this.tenants.get(tenantId);
    if (stream === undefined) {
      return;
    }
    stream.clients.delete(clientId);
    if (stream.clients.size === 0) {
      if (stream.interval !== null) {
        clearInterval(stream.interval);
        stream.interval = null;
      }
      this.tenants.delete(tenantId);
    }
  }

  /**
   * Fan an alert state transition out to every connected client of the
   * tenant as an `event: alert` SSE frame (real-time firing badge).
   */
  public broadcastAlert(event: AlertEvent): void {
    const stream = this.tenants.get(event.tenantId);
    if (stream === undefined) {
      return;
    }
    const frame = JSON.stringify(event);
    for (const client of stream.clients.values()) {
      try {
        client(`event: alert\ndata: ${frame}\n\n`);
      } catch {
        // Broken pipe — the close handler will clean the client up.
      }
    }
  }

  public broadcast(tenantId: string, payload: string): void {
    const stream = this.tenants.get(tenantId);
    if (stream === undefined) {
      return;
    }
    stream.lastPayload = payload;
    for (const client of stream.clients.values()) {
      try {
        client(payload);
      } catch {
        // Broken pipe — the close handler will clean the client up.
      }
    }
  }

  public clientCount(tenantId?: string): number {
    if (tenantId !== undefined) {
      return this.tenants.get(tenantId)?.clients.size ?? 0;
    }
    let total = 0;
    for (const stream of this.tenants.values()) {
      total += stream.clients.size;
    }
    return total;
  }

  public stopAll(): void {
    for (const [tenantId, stream] of this.tenants.entries()) {
      if (stream.interval !== null) {
        clearInterval(stream.interval);
      }
      stream.clients.clear();
      this.tenants.delete(tenantId);
    }
  }

  public lastPollAt(tenantId: string): number | null {
    return this.tenants.get(tenantId)?.lastPollAt ?? null;
  }

  /** One upstream poll per tenant per interval; result fanned out to all. */
  private async pollTenant(tenantId: string): Promise<void> {
    if (this.pollInFlight.has(tenantId)) {
      return;
    }
    this.pollInFlight.add(tenantId);
    try {
      const { result } = await instantQuery({
        tenantId,
        query: "up",
      });
      const hosts = result.result
        .filter((item): item is Extract<PromResultValue, { value: unknown }> => "value" in item)
        .map((item) => ({
          instance: item.metric.instance ?? "unknown",
          job: item.metric.job ?? "unknown",
          up: item.value.value,
        }));
      const payload: HostHealth = {
        tenantId,
        timestamp: Date.now(),
        hosts,
        upstream: "live",
      };
      const stream = this.tenants.get(tenantId);
      if (stream !== undefined) {
        stream.lastPollAt = Date.now();
      }
      this.broadcast(tenantId, JSON.stringify(payload));
    } catch (error) {
      const breakerOpen = error instanceof CircuitOpenError;
      const breakerState = getCircuitBreaker().currentState;
      const payload: HostHealth = {
        tenantId,
        timestamp: Date.now(),
        hosts: [],
        upstream: breakerOpen || breakerState === "open" ? "error" : "stale",
      };
      this.broadcast(tenantId, JSON.stringify(payload));
    } finally {
      this.pollInFlight.delete(tenantId);
    }
  }
}

const globalForSse = globalThis as unknown as { __SSE_BROADCASTER__?: SseBroadcaster };

export function getSseBroadcaster(): SseBroadcaster {
  if (!globalForSse.__SSE_BROADCASTER__) {
    globalForSse.__SSE_BROADCASTER__ = new SseBroadcaster();
  }
  return globalForSse.__SSE_BROADCASTER__;
}

export function resetSseBroadcaster(): void {
  globalForSse.__SSE_BROADCASTER__?.stopAll();
  globalForSse.__SSE_BROADCASTER__ = undefined;
}
