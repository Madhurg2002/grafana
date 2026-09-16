import { useEffect, useRef, useState } from "react";
import { apiBase } from "../lib/api";
import type { HostHealth } from "./types";

export type StreamStatus = "connecting" | "live" | "disconnected";

/**
 * Consumes GET /api/stream?tenantId=... Server-Sent Events and exposes the
 * latest HostHealth payload plus connection status for HealthBadge.
 */
export function useSSE(tenantId: string | null): {
  status: StreamStatus;
  health: HostHealth | null;
} {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [health, setHealth] = useState<HostHealth | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (tenantId === null || tenantId.length === 0) {
      setStatus("disconnected");
      return;
    }

    setStatus("connecting");
    const source = new EventSource(
      `${apiBase()}/api/stream?tenantId=${encodeURIComponent(tenantId)}`
    );
    sourceRef.current = source;

    source.addEventListener("connected", () => {
      setStatus("live");
    });

    source.addEventListener("health", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as HostHealth;
        setHealth(payload);
        setStatus("live");
      } catch {
        // Ignore malformed frames.
      }
    });

    source.onerror = () => {
      setStatus("disconnected");
    };

    return () => {
      source.close();
      sourceRef.current = null;
      setStatus("disconnected");
    };
  }, [tenantId]);

  return { status, health };
}
