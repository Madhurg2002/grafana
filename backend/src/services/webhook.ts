/**
 * Webhook notification delivery for alerts (best-effort, never blocking).
 *
 * POSTs the AlertEvent JSON to the alert's webhook URL with an 8s timeout.
 * Any failure is swallowed — the firing state is always visible in the UI,
 * and email notification (Brevo) arrives with the prod-ready email cycle.
 */

export interface AlertEventPayload {
  alertId: number;
  tenantId: string;
  title: string;
  state: "firing" | "resolved";
  value: number | null;
  threshold: number;
  comparator: string;
  promql: string;
  firedAt: string;
}

export async function sendWebhookNotification(
  url: string,
  event: AlertEventPayload
): Promise<boolean> {
  // Only http(s) webhooks — never let an alert config become an SSRF probe
  // into internal schemes.
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-passthrough-event": event.state,
      },
      body: JSON.stringify({
        text:
          event.state === "firing"
            ? `🔴 ${event.title} is FIRING — value ${event.value ?? "?"} ${event.comparator} ${event.threshold}`
            : `🟢 ${event.title} RESOLVED — value ${event.value ?? "?"} back within ${event.comparator} ${event.threshold}`,
        event,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
