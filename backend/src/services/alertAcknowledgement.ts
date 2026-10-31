import type { AlertRow } from "../db/schema.js";

/**
 * Acknowledgement state of an alert — "someone is on it".
 *
 * An ack silences OUTBOUND notifications only: the evaluator still runs the
 * rule, still transitions pending → firing → resolved, and still records
 * history, so the UI never lies about the metric. An ack with
 * `acknowledged_until` in the past is no longer active (and the evaluator
 * clears it on the next scan).
 */
export function isAcknowledgementActive(
  alert: Pick<AlertRow, "acknowledged_at" | "acknowledged_until">,
  now: Date = new Date()
): boolean {
  if (alert.acknowledged_at === null || alert.acknowledged_at === undefined) {
    return false;
  }
  if (alert.acknowledged_until === null || alert.acknowledged_until === undefined) {
    return true; // indefinite ack
  }
  return new Date(alert.acknowledged_until).getTime() > now.getTime();
}
