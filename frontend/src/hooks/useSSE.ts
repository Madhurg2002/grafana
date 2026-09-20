import { useEffect, useRef, useState } from "react";
import { apiBase, getTenantToken, getToken } from "../lib/api";
import type { HostHealth } from "./types";

export type StreamStatus = "connecting" | "live" | "disconnected";

export interface StreamAlertEvent {
  alertId: number;
  title: string;
  state: "firing" | "resolved";
  value: number | null;
  threshold: number;
  comparator: string;
  firedAt: string;
}

/**
 * Consumes GET /api/stream?tenantId=... Server-Sent Events and exposes the
 * latest HostHealth payload plus connection status for HealthBadge, and the
 * latest alert transition for the header firing badge.
 *
 * EventSource cannot send Authorization headers, so the user session token
 * rides the `?token=` query parameter (the backend accepts header or query).
 */
export function useSSE(
  tenantId: string | null,
  onAlert?: (alert: StreamAlertEvent) => void
): {
  status: StreamStatus;
  health: HostHealth | null;
} {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [health, setHealth] = useState<HostHealth | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  // Keep the callback in a ref so a new listener identity never tears down
  // the EventSource (same pattern as the fallback refresh tick).
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  useEffect(() => {
    if (tenantId === null || tenantId.length === 0) {
      setStatus("disconnected");
      return;
    }

    setStatus("connecting");
    const token = getToken() ?? getTenantToken();
    const auth = token !== null ? `&token=${encodeURIComponent(token)}` : "";
    const source = new EventSource(
      `${apiBase()}/api/stream?tenantId=${encodeURIComponent(tenantId)}${auth}`
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

    source.addEventListener("alert", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as StreamAlertEvent;
        onAlertRef.current?.(payload);
        // App-wide fan-out (header badge) without prop drilling.
        window.dispatchEvent(new CustomEvent("passthrough:alert", { detail: payload }));
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
