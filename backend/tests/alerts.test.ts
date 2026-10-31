import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Alerting capability tests (docs/capabilities.md — Alerting):
 * webhook SSRF guard + payload shape, and the evaluator state machine
 * (pending → firing on sustained breach → resolved on clear) with the
 * Prometheus service mocked.
 */

const sendWebhook = vi.hoisted(() => vi.fn(async () => true));
const recordEval = vi.hoisted(() => vi.fn(async () => undefined));
const recordEvent = vi.hoisted(() => vi.fn(async () => undefined));
const clearAck = vi.hoisted(() => vi.fn(async () => true));
const listEnabled = vi.hoisted(() => vi.fn(async () => []));
const instantQuery = vi.hoisted(() => vi.fn());

vi.mock("../src/services/webhook.js", () => ({
  sendWebhookNotification: sendWebhook,
}));
vi.mock("../src/db/schema.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db/schema.js")>();
  return {
    ...actual,
    listEnabledAlerts: listEnabled,
    recordAlertEvaluation: recordEval,
    recordAlertEvent: recordEvent,
    clearAlertAcknowledgement: clearAck,
  };
});
vi.mock("../src/services/prometheus.js", () => ({
  instantQuery,
}));

import { getAlertEvaluator, resetAlertEvaluator } from "../src/services/alertEvaluator.js";
import { isAcknowledgementActive } from "../src/services/alertAcknowledgement.js";

// The real webhook sender (evaluator tests get the mock via module mock;
// these tests exercise the genuine SSRF guard + fetch payload).
const realWebhook = await vi.importActual<typeof import("../src/services/webhook.js")>(
  "../src/services/webhook.js"
);
const { sendWebhookNotification } = realWebhook;

function alertRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 1,
    tenant_id: "t_test",
    title: "CPU too high",
    promql: '100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
    comparator: ">",
    threshold: 90,
    for_seconds: 0,
    webhook_url: "https://hooks.example.com/alert",
    enabled: true,
    state: "pending",
    first_breach_at: null,
    firing_time: null,
    resolved_time: null,
    last_value: null,
    last_eval_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

function sample(value: number): unknown {
  return {
    result: {
      resultType: "vector",
      result: [{ metric: {}, value: { timestamp: Date.now(), value } }],
    },
  };
}

describe("alert webhook delivery", () => {
  it("rejects non-http(s) schemes (SSRF guard)", async () => {
    expect(await sendWebhookNotification("file:///etc/passwd", {} as never)).toBe(false);
    expect(await sendWebhookNotification("ftp://internal", {} as never)).toBe(false);
  });

  it("POSTs a JSON body describing firing/resolved events", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const ok = await sendWebhookNotification("https://hooks.example.com/x", {
      alertId: 1,
      tenantId: "t_test",
      title: "CPU too high",
      state: "firing",
      value: 95.5,
      threshold: 90,
      comparator: ">",
      promql: "up",
      firedAt: new Date().toISOString(),
    });
    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/x");
    const body = JSON.parse(String(init.body)) as { text: string; event: { state: string } };
    expect(body.event.state).toBe("firing");
    expect(body.text).toContain("FIRING");
    fetchSpy.mockRestore();
  });

  it("swallows network errors", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    expect(await sendWebhookNotification("https://hooks.example.com/x", {} as never)).toBe(false);
    fetchSpy.mockRestore();
  });
});

describe("alert evaluator state machine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    recordEval.mockClear();
    recordEvent.mockClear();
    clearAck.mockClear();
    sendWebhook.mockClear();
    resetAlertEvaluator();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetAlertEvaluator();
  });

  it("fires after the breach holds for for_seconds, then resolves on clear", async () => {
    let value = 95;
    instantQuery.mockImplementation(async () => sample(value));
    listEnabled.mockResolvedValue([alertRow({ for_seconds: 60 })]);

    const evaluator = getAlertEvaluator();
    const events: Array<{ state: string }> = [];
    evaluator.onEvent((event) => events.push({ state: event.state }));

    // First scan: breach recorded, not yet held long enough.
    await evaluator.scan();
    expect(recordEval).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ state: "pending", firstBreachAt: expect.any(String) })
    );
    expect(events).toHaveLength(0);

    // Simulate the DB persisting first_breach_at (recordAlertEvaluation is
    // mocked, so fold its last patch into the row the next scan reads).
    const lastPatch = recordEval.mock.lastCall?.[1] as { firstBreachAt: string };
    listEnabled.mockResolvedValue([
      alertRow({ for_seconds: 60, first_breach_at: lastPatch.firstBreachAt })
    ]);

    // Advance past for_seconds and scan again → firing.
    vi.advanceTimersByTime(61_000);
    value = 96;
    await evaluator.scan();
    expect(events).toEqual([{ state: "firing" }]);
    expect(recordEval).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ state: "firing" })
    );
    expect(sendWebhook).toHaveBeenCalledTimes(1);

    // Simulate the firing transition persisting (state + firing_time).
    const firingPatch = recordEval.mock.lastCall?.[1] as { firingTime: string };
    listEnabled.mockResolvedValue([
      alertRow({
        for_seconds: 60,
        state: "firing",
        first_breach_at: lastPatch.firstBreachAt,
        firing_time: firingPatch.firingTime,
      })
    ]);

    // Breach clears → resolved.
    value = 40;
    await evaluator.scan();
    expect(events).toEqual([{ state: "firing" }, { state: "resolved" }]);
    expect(sendWebhook).toHaveBeenCalledTimes(2);
  });

  it("treats no-data as resolved, never as a breach", async () => {
    instantQuery.mockResolvedValue({
      result: { resultType: "vector", result: [] },
    });
    listEnabled.mockResolvedValue([alertRow({ state: "firing" })]);
    const evaluator = getAlertEvaluator();
    await evaluator.scan();
    expect(recordEval).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ state: "resolved" })
    );
  });

  it("keeps prior state when the upstream errors", async () => {
    instantQuery.mockRejectedValue(new Error("breaker open"));
    const row = alertRow({ state: "firing", firing_time: new Date().toISOString() });
    listEnabled.mockResolvedValue([row]);
    const evaluator = getAlertEvaluator();
    await evaluator.scan();
    expect(recordEval).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ state: "firing" })
    );
  });

  it("acknowledged alert still transitions and records history, but never notifies", async () => {
    instantQuery.mockImplementation(async () => sample(99));
    listEnabled.mockResolvedValue([
      alertRow({
        for_seconds: 0,
        acknowledged_at: new Date().toISOString(),
        acknowledged_until: null,
        acknowledged_by: "oncall@test.dev",
      }),
    ]);
    const evaluator = getAlertEvaluator();
    const events: Array<{ state: string; acknowledged: boolean }> = [];
    evaluator.onEvent((event) => events.push({ state: event.state, acknowledged: event.acknowledged }));

    await evaluator.scan();

    // The alert is real: it fires, and the UI is told. It just does not page.
    expect(events).toEqual([{ state: "firing", acknowledged: true }]);
    expect(recordEval).toHaveBeenLastCalledWith(1, expect.objectContaining({ state: "firing" }));
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ alertId: 1, state: "firing", acknowledged: true })
    );
    expect(sendWebhook).not.toHaveBeenCalled();
  });

  it("clears an expired acknowledgement and resumes notifications", async () => {
    instantQuery.mockImplementation(async () => sample(99));
    const past = new Date(Date.now() - 60_000).toISOString();
    listEnabled.mockResolvedValue([
      alertRow({ for_seconds: 0, acknowledged_at: past, acknowledged_until: past }),
    ]);
    const evaluator = getAlertEvaluator();
    await evaluator.scan();

    expect(clearAck).toHaveBeenCalledWith("t_test", 1);
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ state: "firing", acknowledged: false })
    );
    expect(sendWebhook).toHaveBeenCalledTimes(1);
  });
});

describe("alert acknowledgement rule", () => {
  it("treats an untouched alert as not acknowledged", () => {
    expect(isAcknowledgementActive({ acknowledged_at: null, acknowledged_until: null })).toBe(false);
  });

  it("treats an ack without an end time as indefinite", () => {
    expect(
      isAcknowledgementActive({
        acknowledged_at: new Date(Date.now() - 86_400_000).toISOString(),
        acknowledged_until: null,
      })
    ).toBe(true);
  });

  it("expires a timed ack at its deadline", () => {
    const now = new Date("2026-10-31T12:00:00.000Z");
    expect(
      isAcknowledgementActive(
        { acknowledged_at: "2026-10-31T11:00:00.000Z", acknowledged_until: "2026-10-31T13:00:00.000Z" },
        now
      )
    ).toBe(true);
    expect(
      isAcknowledgementActive(
        { acknowledged_at: "2026-10-31T11:00:00.000Z", acknowledged_until: "2026-10-31T11:30:00.000Z" },
        now
      )
    ).toBe(false);
  });
});
