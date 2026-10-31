import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * Alert operations routes (docs/capabilities.md — Alert operations):
 *   GET    /api/alerts/:tenantId/firing      badge hydration
 *   POST   /api/alerts/:tenantId/:id/ack     acknowledge (timed or indefinite)
 *   DELETE /api/alerts/:tenantId/:id/ack     release
 *   GET    /api/alerts/:tenantId/:id/events  transition history
 *
 * Auth is stubbed at the middleware boundary (the real guard is covered by the
 * auth suites); these tests pin parsing, mapping, ownership scoping and the
 * audit calls.
 */

const access = vi.hoisted(() => ({ granted: true }));
vi.mock("../src/middleware/auth.js", () => ({
  // Mirrors the real guard's contract: on refusal it SENDS the 401 itself and
  // returns false (a bare `false` would leave the request hanging forever).
  requireTenantAccess: vi.fn(
    async (
      _request: unknown,
      reply: { code: (status: number) => { send: (body: unknown) => unknown } },
      _tenantId: string
    ): Promise<boolean> => {
      if (access.granted) {
        return true;
      }
      reply.code(401).send({ error: "Authentication required" });
      return false;
    }
  ),
}));
vi.mock("../src/services/audit.js", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

const listFiring = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const acknowledge = vi.hoisted(() => vi.fn(async () => true));
const clearAck = vi.hoisted(() => vi.fn(async () => true));
const listEvents = vi.hoisted(() => vi.fn(async () => [] as unknown[]));

vi.mock("../src/db/schema.js", () => ({
  listFiringAlerts: listFiring,
  acknowledgeAlert: acknowledge,
  clearAlertAcknowledgement: clearAck,
  listAlertEvents: listEvents,
  listAlerts: vi.fn(async () => []),
  createAlert: vi.fn(),
  updateAlertEnabled: vi.fn(async () => true),
  deleteAlert: vi.fn(async () => true),
}));

import { alertRoutes } from "../src/routes/alerts.js";
import { recordAudit } from "../src/services/audit.js";

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(alertRoutes);
  return app;
}

function firingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 12,
    tenant_id: "team-9",
    title: "CPU too high",
    promql: "up",
    comparator: ">",
    threshold: 90,
    for_seconds: 0,
    webhook_url: null,
    enabled: true,
    state: "firing",
    first_breach_at: new Date().toISOString(),
    firing_time: new Date().toISOString(),
    resolved_time: null,
    last_value: 97.5,
    last_eval_at: new Date().toISOString(),
    acknowledged_at: null,
    acknowledged_until: null,
    acknowledged_by: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("alert operations routes", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp();
    access.granted = true;
    listFiring.mockClear();
    acknowledge.mockClear();
    clearAck.mockClear();
    listEvents.mockClear();
    vi.mocked(recordAudit).mockClear();
  });

  describe("GET /api/alerts/:tenantId/firing", () => {
    it("returns firing alerts with derived acknowledgement state", async () => {
      listFiring.mockResolvedValue([
        firingRow({
          acknowledged_at: new Date().toISOString(),
          acknowledged_until: null,
          acknowledged_by: "oncall@test.dev",
        }),
      ]);
      const response = await app.inject({ method: "GET", url: "/api/alerts/team-9/firing" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        alerts: Array<{ alertId: number; acknowledged: boolean; acknowledgedBy: string | null; value: number | null }>;
      };
      expect(body.alerts).toHaveLength(1);
      expect(body.alerts[0]?.alertId).toBe(12);
      expect(body.alerts[0]?.value).toBe(97.5);
      expect(body.alerts[0]?.acknowledged).toBe(true);
      expect(body.alerts[0]?.acknowledgedBy).toBe("oncall@test.dev");
    });

    it("treats an expired ack as not acknowledged", async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      listFiring.mockResolvedValue([firingRow({ acknowledged_at: past, acknowledged_until: past })]);
      const response = await app.inject({ method: "GET", url: "/api/alerts/team-9/firing" });
      const body = response.json() as { alerts: Array<{ acknowledged: boolean }> };
      expect(body.alerts[0]?.acknowledged).toBe(false);
    });

    it("401s when the caller has no access to the workspace", async () => {
      access.granted = false;
      const response = await app.inject({ method: "GET", url: "/api/alerts/team-9/firing" });
      expect(response.statusCode).toBe(401);
      expect(listFiring).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/alerts/:tenantId/:id/ack", () => {
    it("acknowledges for an hour by default", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/alerts/team-9/12/ack",
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { acknowledged: boolean; until: string | null };
      expect(body.acknowledged).toBe(true);
      expect(body.until).not.toBeNull();
      expect(acknowledge).toHaveBeenCalledWith("team-9", 12, expect.any(String), null);
      // Roughly one hour out.
      const until = new Date(body.until ?? "").getTime();
      expect(until - Date.now()).toBeGreaterThan(55 * 60_000);
      expect(until - Date.now()).toBeLessThan(65 * 60_000);
      expect(recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "alert.acknowledge" }),
        expect.anything()
      );
    });

    it("treats minutes=0 as an indefinite acknowledgement", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/alerts/team-9/12/ack",
        payload: { minutes: 0 },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { until: string | null }).until).toBeNull();
      expect(acknowledge).toHaveBeenCalledWith("team-9", 12, null, null);
    });

    it("rejects an out-of-range duration with zod field details", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/alerts/team-9/12/ack",
        payload: { minutes: 99_999 },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string; details: Array<{ path: string }> };
      expect(body.error).toBe("Invalid acknowledgement");
      expect(body.details[0]?.path).toBe("minutes");
      expect(acknowledge).not.toHaveBeenCalled();
    });

    it("404s when the alert does not belong to this workspace", async () => {
      acknowledge.mockResolvedValueOnce(false);
      const response = await app.inject({
        method: "POST",
        url: "/api/alerts/team-9/999/ack",
        payload: {},
      });
      expect(response.statusCode).toBe(404);
      expect(recordAudit).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/alerts/:tenantId/:id/ack", () => {
    it("releases the acknowledgement and audits it", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/alerts/team-9/12/ack",
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { cleared: boolean }).cleared).toBe(true);
      expect(clearAck).toHaveBeenCalledWith("team-9", 12);
      expect(recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "alert.unacknowledge" }),
        expect.anything()
      );
    });
  });

  describe("GET /api/alerts/:tenantId/:id/events", () => {
    it("returns history newest-first with the requested limit", async () => {
      listEvents.mockResolvedValue([
        { id: 2, alert_id: 12, tenant_id: "team-9", state: "resolved", value: 40, threshold: 90, comparator: ">", acknowledged: false, created_at: new Date().toISOString() },
        { id: 1, alert_id: 12, tenant_id: "team-9", state: "firing", value: 97.5, threshold: 90, comparator: ">", acknowledged: true, created_at: new Date().toISOString() },
      ]);
      const response = await app.inject({
        method: "GET",
        url: "/api/alerts/team-9/12/events?limit=5",
      });
      expect(response.statusCode).toBe(200);
      expect(listEvents).toHaveBeenCalledWith("team-9", 12, 5);
      const body = response.json() as { events: Array<{ id: number; acknowledged: boolean }> };
      expect(body.events).toHaveLength(2);
      expect(body.events[1]?.acknowledged).toBe(true);
    });

    it("falls back to a bounded default when the limit is nonsense", async () => {
      await app.inject({ method: "GET", url: "/api/alerts/team-9/12/events?limit=abc" });
      expect(listEvents).toHaveBeenCalledWith("team-9", 12, 50);
    });
  });
});
