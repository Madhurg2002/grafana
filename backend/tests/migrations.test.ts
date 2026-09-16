import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checksum } from "../src/db/migrations/runner.js";
import { MIGRATIONS } from "../src/db/migrations/index.js";

describe("migration definitions", () => {
  it("are ordered by numeric prefix", () => {
    const names = MIGRATIONS.map((m) => m.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it("creates tenants and prometheus_connections with a unique tenant constraint", () => {
    const core = MIGRATIONS.find((m) => m.name === "001_core_tables");
    expect(core?.sql).toContain("CREATE TABLE IF NOT EXISTS tenants");
    expect(core?.sql).toContain("CREATE TABLE IF NOT EXISTS prometheus_connections");
    expect(core?.sql).toContain("UNIQUE (tenant_id)");
    // Security law: no plaintext token column.
    expect(core?.sql).toContain("auth_token_encrypted");
    expect(core?.sql).not.toMatch(/auth_token\s+TEXT(?!_)/);
  });

  it("indexes the hot tenant lookup and keeps updated_at fresh", () => {
    const second = MIGRATIONS.find((m) => m.name === "002_indexes_and_triggers");
    expect(second?.sql).toContain("idx_prometheus_connections_tenant_id");
    expect(second?.sql).toContain("set_updated_at()");
    expect(second?.sql).toContain("CREATE TRIGGER trg_prometheus_connections_updated_at");
  });
});

describe("checksum", () => {
  it("is deterministic and differs per content", () => {
    expect(checksum("CREATE TABLE a ();")).toBe(checksum("CREATE TABLE a ();"));
    expect(checksum("CREATE TABLE a ();")).not.toBe(checksum("CREATE TABLE b ();"));
  });

  it("is a 16-char hex digest", () => {
    expect(checksum("x")).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// Runner behavior against a real Pool API (mocked pg), no live DB required.
// ---------------------------------------------------------------------------

type QueryHandler = (sql: string, params?: unknown[]) => Promise<{
  rowCount: number;
  rows: Array<Record<string, unknown>>;
}>;

function makeFakePool(handler: QueryHandler): {
  connect: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  const release = vi.fn();
  return {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params)),
      release,
    })),
    end: vi.fn(async () => undefined),
  };
}

async function importRunnerWithMockPg(handler: QueryHandler) {
  vi.doMock("pg", () => ({ Pool: class {} }));
  const mod = await import("../src/db/migrations/runner.js");
  return { runMigrations: mod.runMigrations, pool: makeFakePool(handler) };
}

describe("migration runner (mocked pg client)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("pg");
  });

  it("applies pending migrations inside transactions and records checksums", async () => {
    const executed: string[] = [];
    const recorded = new Map<string, string>();
    const { runMigrations, pool } = await importRunnerWithMockPg(async (sql, params) => {
      executed.push(sql);
      if (sql.startsWith("SELECT checksum")) {
        const name = (params as string[])[0];
        return { rowCount: recorded.has(name) ? 1 : 0, rows: [] };
      }
      if (sql.startsWith("INSERT INTO schema_migrations")) {
        const [name, sum] = params as [string, string];
        recorded.set(name, sum);
      }
      return { rowCount: 0, rows: [] };
    });
    const result = await runMigrations(
      pool as unknown as Parameters<typeof runMigrations>[0],
      [
        { name: "001_a", sql: "CREATE TABLE a();" },
        { name: "002_b", sql: "CREATE TABLE b();" },
      ]
    );
    expect(result.applied).toEqual(["001_a", "002_b"]);
    expect(result.skipped).toEqual([]);
    expect(executed).toContain("BEGIN");
    expect(executed).toContain("COMMIT");
    expect(executed).toContain("CREATE TABLE a();");
  });

  it("skips already-applied migrations and verifies checksums", async () => {
    const sum = checksum("CREATE TABLE a();");
    const { runMigrations, pool } = await importRunnerWithMockPg(async (sql, params) => {
      if (sql.startsWith("SELECT checksum")) {
        const name = (params as string[])[0];
        return name === "001_a"
          ? { rowCount: 1, rows: [{ checksum: sum }] }
          : { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });
    const result = await runMigrations(
      pool as unknown as Parameters<typeof runMigrations>[0],
      [{ name: "001_a", sql: "CREATE TABLE a();" }]
    );
    expect(result.skipped).toEqual(["001_a"]);
    expect(result.applied).toEqual([]);
  });

  it("aborts when an applied migration was modified (checksum mismatch)", async () => {
    const { runMigrations, pool } = await importRunnerWithMockPg(async (sql, params) => {
      if (sql.startsWith("SELECT checksum")) {
        return { rowCount: 1, rows: [{ checksum: "different1234567" }] };
      }
      return { rowCount: 0, rows: [] };
    });
    await expect(
      runMigrations(pool as unknown as Parameters<typeof runMigrations>[0], [
        { name: "001_a", sql: "CREATE TABLE a_modified();" },
      ])
    ).rejects.toThrow(/checksum mismatch/);
  });

  it("rolls back a failed migration and rethrows", async () => {
    const executed: string[] = [];
    const { runMigrations, pool } = await importRunnerWithMockPg(async (sql) => {
      executed.push(sql);
      if (sql.startsWith("SELECT checksum")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("BOOM_TABLE")) {
        throw new Error("syntax error near BOOM");
      }
      return { rowCount: 0, rows: [] };
    });
    await expect(
      runMigrations(pool as unknown as Parameters<typeof runMigrations>[0], [
        { name: "001_bad", sql: "CREATE TABLE BOOM_TABLE ();" },
      ])
    ).rejects.toThrow(/syntax error/);
    expect(executed).toContain("ROLLBACK");
    expect(executed).not.toContain("INSERT INTO schema_migrations");
  });
});
