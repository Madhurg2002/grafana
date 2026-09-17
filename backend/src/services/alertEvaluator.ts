import { instantQuery } from "./prometheus.js";
import {
  listEnabledAlerts,
  recordAlertEvaluation,
  type AlertRow,
} from "../db/schema.js";
import { sendWebhookNotification } from "./webhook.js";

/**
 * Threshold-alert evaluator (docs/capabilities.md — Alerting).
 *
 * A single background loop scans every ENABLED alert on an interval and:
 *  1. runs its PromQL through the normalizer/breaker/cache stack
 *  2. applies the state machine:
 *       breach:  value comparator threshold
 *       pending  → firing    once breach holds ≥ for_seconds (webhook fires)
 *       firing   → resolved  when the breach clears (webhook fires)
 *       resolved → pending   re-arms automatically
 *  3. POSTs the notification to the alert's webhook_url (if set)
 *
 * Webhook-first: email notification waits until the app is prod-ready
 * (docs/todo.md — Brevo).
 */

export const ALERT_EVALUATOR_INTERVAL_MS = 30_000;

export interface AlertEvent {
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

type Listener = (event: AlertEvent) => void;

class AlertEvaluator {
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;
  private readonly listeners = new Set<Listener>();

  public onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public start(intervalMs = ALERT_EVALUATOR_INTERVAL_MS): void {
    if (this.timer !== null) {
      return; // already running
    }
    this.timer = setInterval(() => {
      void this.scan();
    }, intervalMs);
    this.timer.unref?.();
    void this.scan();
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public isRunning(): boolean {
    return this.timer !== null;
  }

  /** One pass over every enabled alert. Errors never break the loop. */
  public async scan(): Promise<void> {
    if (this.scanning) {
      return;
    }
    this.scanning = true;
    try {
      const alerts = await listEnabledAlerts();
      await Promise.allSettled(alerts.map((alert) => this.evaluate(alert)));
    } catch {
      // DB unavailable — skip this cycle; the next tick retries.
    } finally {
      this.scanning = false;
    }
  }

  private async evaluate(alert: AlertRow): Promise<void> {
    const now = new Date().toISOString();
    try {
      const { result } = await instantQuery({
        tenantId: alert.tenant_id,
        query: alert.promql,
      });
      // Single-value expression: take the first vector sample.
      const value =
        result.result.length > 0
          ? (result.result[0] as { value?: { value: number } }).value?.value ?? null
          : null;

      const breach =
        value !== null &&
        (alert.comparator === ">"
          ? value > alert.threshold
          : alert.comparator === "<"
            ? value < alert.threshold
            : alert.comparator === ">="
              ? value >= alert.threshold
              : alert.comparator === "<="
                ? value <= alert.threshold
                : value === alert.threshold);

      if (value === null) {
        // No data — treat as cleared but keep the previous state timing.
        if (alert.state === "firing") {
          await this.transition(alert, "resolved", null, now);
        } else {
          await recordAlertEvaluation(alert.id, {
            state: "pending",
            firstBreachAt: null,
            firingTime: alert.firing_time ?? null,
            resolvedTime: alert.state === "resolved" ? now : null,
            lastValue: null,
            lastEvalAt: now,
          });
        }
        return;
      }

      if (breach) {
        const firstBreach = alert.first_breach_at ?? now;
        const heldMs = Date.now() - new Date(firstBreach).getTime();
        if (alert.state !== "firing" && heldMs >= alert.for_seconds * 1000) {
          await this.transition(alert, "firing", value, now, firstBreach);
        } else {
          await recordAlertEvaluation(alert.id, {
            state: alert.state === "firing" ? "firing" : "pending",
            firstBreachAt: firstBreach,
            firingTime: alert.firing_time ?? null,
            resolvedTime: null,
            lastValue: value,
            lastEvalAt: now,
          });
        }
      } else {
        if (alert.state === "firing") {
          await this.transition(alert, "resolved", value, now);
        } else {
          await recordAlertEvaluation(alert.id, {
            state: "pending",
            firstBreachAt: null,
            firingTime: null,
            resolvedTime: alert.state === "resolved" ? now : null,
            lastValue: value,
            lastEvalAt: now,
          });
        }
      }
    } catch {
      // Upstream/breaker error — record the eval attempt, keep prior state.
      await recordAlertEvaluation(alert.id, {
        state: alert.state,
        firstBreachAt: alert.first_breach_at,
        firingTime: alert.firing_time,
        resolvedTime: alert.resolved_time,
        lastValue: alert.last_value,
        lastEvalAt: now,
      }).catch(() => undefined);
    }
  }

  /** Applies a firing/resolved transition and notifies webhook listeners. */
  private async transition(
    alert: AlertRow,
    to: "firing" | "resolved",
    value: number | null,
    now: string,
    firstBreach?: string
  ): Promise<void> {
    await recordAlertEvaluation(alert.id, {
      state: to,
      firstBreachAt: to === "firing" ? firstBreach ?? now : null,
      firingTime: to === "firing" ? now : alert.firing_time,
      resolvedTime: to === "resolved" ? now : null,
      lastValue: value,
      lastEvalAt: now,
    });
    const event: AlertEvent = {
      alertId: alert.id,
      tenantId: alert.tenant_id,
      title: alert.title,
      state: to,
      value,
      threshold: alert.threshold,
      comparator: alert.comparator,
      promql: alert.promql,
      firedAt: now,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors never break evaluation.
      }
    }
    if (alert.webhook_url !== null && alert.webhook_url.length > 0) {
      void sendWebhookNotification(alert.webhook_url, event);
    }
  }
}

const globalForAlerts = globalThis as unknown as { __ALERT_EVALUATOR__?: AlertEvaluator };

export function getAlertEvaluator(): AlertEvaluator {
  if (globalForAlerts.__ALERT_EVALUATOR__ === undefined) {
    globalForAlerts.__ALERT_EVALUATOR__ = new AlertEvaluator();
  }
  return globalForAlerts.__ALERT_EVALUATOR__;
}

export function resetAlertEvaluator(): void {
  globalForAlerts.__ALERT_EVALUATOR__?.stop();
  globalForAlerts.__ALERT_EVALUATOR__ = undefined;
}
