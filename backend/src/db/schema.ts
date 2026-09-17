import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { z } from "zod";

/**
 * PostgreSQL access for multi-tenant metadata. Prometheus auth tokens are
 * ALWAYS persisted encrypted (AES-256-GCM) — see `encryption.ts`.
 */

export interface TenantRow {
  id: string;
  name: string;
  created_at: Date;
}

export interface ConnectionRow {
  id: number;
  tenant_id: string;
  prometheus_url: string;
  auth_token_encrypted: string | null;
  status: "connected" | "error" | "unknown";
  /** 'prometheus' | 'grafana' — defaults to 'prometheus' for legacy rows. */
  upstream_type?: string;
  /** Human label distinguishing multiple connections per tenant. */
  label?: string;
  /** True for the connection queries/SSE currently resolve to. */
  is_active?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertConnectionInput {
  tenantId: string;
  prometheusUrl: string;
  /** Already-encrypted payload (iv:authTag:ciphertext). */
  authTokenEncrypted: string | null;
  status: "connected" | "error" | "unknown";
  /** Detected upstream flavor; defaults to 'prometheus'. */
  upstreamType?: "prometheus" | "grafana";
  /** Human label for multi-connection switching (e.g. "prod", "staging"). */
  label?: string;
  /** Set false to store the connection without switching to it. */
  activate?: boolean;
}

const globalForPool = globalThis as unknown as { __PG_POOL__?: Pool };

/**
 * Query observability (dev/diagnostic aid, off by default):
 *   DB_LOG_SLOW_MS=100  log queries slower than this (default 100ms when logging enabled)
 *   DB_LOG_QUERIES=1    log every query (noisy — dev only)
 * Set DB_LOG_QUERIES or DB_LOG_SLOW_MS to enable; production defaults to
 * silence so logs stay about the app, not the ORM.
 */
const dbLogAll = process.env.DB_LOG_QUERIES === "1";
const dbLogSlowMs = process.env.DB_LOG_SLOW_MS === undefined ? null : Number(process.env.DB_LOG_SLOW_MS);
let dbQueryCount = 0;

/** Total queries executed through the pool since process start (diagnostics). */
export function getDbQueryCount(): number {
  return dbQueryCount;
}

function observeQuery(text: string, durationMs: number): void {
  dbQueryCount += 1;
  const firstLine = text.replace(/\s+/g, " ").trim().slice(0, 120);
  if (dbLogAll) {
    console.log(`[db] ${durationMs.toFixed(1)}ms ${firstLine}`);
  } else if (dbLogSlowMs !== null && durationMs >= dbLogSlowMs) {
    console.warn(`[db:slow] ${durationMs.toFixed(0)}ms ${firstLine}`);
  }
}

export function getPool(): Pool {
  if (!globalForPool.__PG_POOL__) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // Instrument the pool once — every helper (schema/users/alerts) goes
    // through pool.query, so this observes all DB activity. Only promise-
    // style calls are timed; callback-style (unused in this codebase) passes
    // through untouched.
    const originalQuery = pool.query.bind(pool);
    const instrumented = function query(
      this: Pool,
      ...args: unknown[]
    ): unknown {
      const last = args[args.length - 1];
      if (typeof last === "function") {
        return (originalQuery as (...a: unknown[]) => unknown).apply(pool, args);
      }
      const started = Date.now();
      const result = (originalQuery as (...a: unknown[]) => Promise<unknown>).apply(pool, args);
      void result.then(
        () => observeQuery(String(args[0] ?? ""), Date.now() - started),
        () => observeQuery(String(args[0] ?? ""), Date.now() - started)
      );
      return result;
    };
    pool.query = instrumented as typeof pool.query;
    globalForPool.__PG_POOL__ = pool;
  }
  return globalForPool.__PG_POOL__;
}

export function setPool(pool: Pool | undefined): void {
  globalForPool.__PG_POOL__ = pool;
}

export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prometheus_connections (
  id                   SERIAL PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prometheus_url       TEXT NOT NULL,
  auth_token_encrypted TEXT,
  status               TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('connected', 'error', 'unknown')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);
`;

export async function ensureSchema(client?: PoolClient): Promise<void> {
  // Delegates to the versioned migration runner (keeps legacy callers safe).
  const { initializeDatabase } = await import("./migrations/runner.js");
  const { MIGRATIONS } = await import("./migrations/index.js");
  const pool = getPool();
  if (client !== undefined) {
    await initializeDatabase(pool, MIGRATIONS);
    return;
  }
  await initializeDatabase(pool, MIGRATIONS);
}

export async function upsertTenant(tenantId: string, name: string): Promise<TenantRow> {
  const result: QueryResult<TenantRow> = await getPool().query(
    `INSERT INTO tenants (id, name) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, created_at`,
    [tenantId, name]
  );
  return result.rows[0];
}

export async function tenantExists(tenantId: string): Promise<boolean> {
  const result = await getPool().query<Pick<TenantRow, "id">>(
    "SELECT id FROM tenants WHERE id = $1",
    [tenantId]
  );
  return result.rowCount === 1;
}

export async function upsertConnection(input: UpsertConnectionInput): Promise<ConnectionRow> {
  const label = input.label ?? "default";
  const activate = input.activate ?? true;
  const result: QueryResult<ConnectionRow> = await getPool().query(
    `INSERT INTO prometheus_connections
       (tenant_id, prometheus_url, auth_token_encrypted, status, upstream_type, label, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, label) DO UPDATE SET
       prometheus_url = EXCLUDED.prometheus_url,
       auth_token_encrypted = COALESCE(EXCLUDED.auth_token_encrypted,
                                       prometheus_connections.auth_token_encrypted),
       status = EXCLUDED.status,
       upstream_type = EXCLUDED.upstream_type,
       is_active = EXCLUDED.is_active,
       updated_at = NOW()
     RETURNING id, tenant_id, prometheus_url, auth_token_encrypted,
               status, upstream_type, label, is_active, created_at, updated_at`,
    [
      input.tenantId,
      input.prometheusUrl,
      input.authTokenEncrypted,
      input.status,
      input.upstreamType ?? "prometheus",
      label,
      activate,
    ]
  );
  if (activate) {
    // Exactly one active connection per tenant (deferred to dodge the
    // partial-unique index within the same statement batch).
    await getPool().query(
      `UPDATE prometheus_connections
       SET is_active = (label = $2)
       WHERE tenant_id = $1`,
      [input.tenantId, label]
    );
  }
  return result.rows[0];
}

export async function getConnection(tenantId: string): Promise<ConnectionRow | null> {
  const result = await getPool().query<ConnectionRow>(
    `SELECT id, tenant_id, prometheus_url, auth_token_encrypted,
            status, upstream_type, label, is_active, created_at, updated_at
     FROM prometheus_connections
     WHERE tenant_id = $1
     ORDER BY is_active DESC, updated_at DESC
     LIMIT 1`,
    [tenantId]
  );
  return result.rows[0] ?? null;
}

export interface PanelRow {
  id: number;
  tenant_id: string;
  title: string;
  promql: string;
  kind: "sparkline" | "gauge" | "stat";
  unit: string | null;
  position: number;
  page_id: number | null;
  created_at: Date;
}

export async function listConnections(tenantId: string): Promise<Array<ConnectionRow>> {
  const result = await getPool().query<ConnectionRow>(
    `SELECT id, tenant_id, prometheus_url, auth_token_encrypted,
            status, upstream_type, label, is_active, created_at, updated_at
     FROM prometheus_connections
     WHERE tenant_id = $1
     ORDER BY is_active DESC, updated_at DESC`,
    [tenantId]
  );
  return result.rows;
}

/** Switches the tenant's active connection; returns the newly active row. */
export async function activateConnection(
  tenantId: string,
  connectionId: number
): Promise<ConnectionRow | null> {
  const owned = await getPool().query<{ id: number }>(
    "SELECT id FROM prometheus_connections WHERE id = $1 AND tenant_id = $2",
    [connectionId, tenantId]
  );
  if (owned.rowCount !== 1) {
    return null;
  }
  await getPool().query("BEGIN");
  try {
    await getPool().query(
      "UPDATE prometheus_connections SET is_active = FALSE WHERE tenant_id = $1",
      [tenantId]
    );
    const updated = await getPool().query<ConnectionRow>(
      `UPDATE prometheus_connections SET is_active = TRUE
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, tenant_id, prometheus_url, auth_token_encrypted,
                 status, upstream_type, label, is_active, created_at, updated_at`,
      [connectionId, tenantId]
    );
    await getPool().query("COMMIT");
    return updated.rows[0] ?? null;
  } catch (error) {
    await getPool().query("ROLLBACK");
    throw error;
  }
}

export async function deleteConnection(tenantId: string, connectionId: number): Promise<boolean> {
  const result = await getPool().query(
    "DELETE FROM prometheus_connections WHERE id = $1 AND tenant_id = $2",
    [connectionId, tenantId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Custom dashboard panels (user-defined views)
// ---------------------------------------------------------------------------

export async function listPanels(tenantId: string, pageId?: number): Promise<PanelRow[]> {
  const result = await getPool().query<PanelRow>(
    `SELECT id, tenant_id, title, promql, kind, unit, position, page_id, created_at
     FROM dashboard_panels
     WHERE tenant_id = $1 AND ($2::int IS NULL OR page_id = $2)
     ORDER BY position, id`,
    [tenantId, pageId ?? null]
  );
  return result.rows;
}

export async function createPanel(input: {
  tenantId: string;
  title: string;
  promql: string;
  kind: "sparkline" | "gauge" | "stat";
  unit?: string;
  pageId?: number | null;
}): Promise<PanelRow> {
  const result = await getPool().query<PanelRow>(
    `INSERT INTO dashboard_panels (tenant_id, title, promql, kind, unit, position, page_id)
     VALUES ($1, $2, $3, $4, $5,
             COALESCE((SELECT MAX(position) + 1 FROM dashboard_panels WHERE tenant_id = $1), 0),
             $6)
     ON CONFLICT (tenant_id, title) DO UPDATE SET
       promql = EXCLUDED.promql, kind = EXCLUDED.kind, unit = EXCLUDED.unit,
       page_id = EXCLUDED.page_id
     RETURNING id, tenant_id, title, promql, kind, unit, position, page_id, created_at`,
    [input.tenantId, input.title, input.promql, input.kind, input.unit ?? null, input.pageId ?? null]
  );
  return result.rows[0];
}

export async function deletePanel(tenantId: string, panelId: number): Promise<boolean> {
  const result = await getPool().query(
    "DELETE FROM dashboard_panels WHERE id = $1 AND tenant_id = $2",
    [panelId, tenantId]
  );
  return (result.rowCount ?? 0) > 0;
}

export interface DashboardPageRow {
  id: number;
  tenant_id: string;
  name: string;
  position: number;
  is_home?: boolean;
  default_span?: number;
  refresh_seconds?: number;
  window_minutes?: number;
  show_builtins?: boolean;
}

export async function listPages(tenantId: string): Promise<DashboardPageRow[]> {
  const result = await getPool().query<DashboardPageRow>(
    `SELECT id, tenant_id, name, position, is_home, default_span,
            refresh_seconds, window_minutes, show_builtins
     FROM dashboard_pages
     WHERE tenant_id = $1
     ORDER BY is_home DESC, position, id`,
    [tenantId]
  );
  return result.rows;
}

export async function createPage(
  tenantId: string,
  name: string,
  showBuiltins = true
): Promise<DashboardPageRow> {
  const result = await getPool().query<DashboardPageRow>(
    `INSERT INTO dashboard_pages (tenant_id, name, position, show_builtins)
     VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM dashboard_pages WHERE tenant_id = $1), 0), $3)
     RETURNING id, tenant_id, name, position, is_home, default_span,
               refresh_seconds, window_minutes, show_builtins`,
    [tenantId, name, showBuiltins]
  );
  return result.rows[0] as DashboardPageRow;
}

/** Promotes a page to be the tenant's home (the app's landing page). */
export async function setHomePage(tenantId: string, pageId: number): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query<{ id: number }>(
      "SELECT id FROM dashboard_pages WHERE id = $1 AND tenant_id = $2",
      [pageId, tenantId]
    );
    if ((owned.rowCount ?? 0) !== 1) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      "UPDATE dashboard_pages SET is_home = FALSE WHERE tenant_id = $1",
      [tenantId]
    );
    await client.query(
      "UPDATE dashboard_pages SET is_home = TRUE, position = 0 WHERE id = $1",
      [pageId]
    );
    // Keep positions unique+ordered after the promotion.
    await client.query(
      `UPDATE dashboard_pages p
       SET position = sub.rn
       FROM (
         SELECT id, ROW_NUMBER() OVER (ORDER BY is_home DESC, position, id) - 1 AS rn
         FROM dashboard_pages WHERE tenant_id = $1
       ) sub
       WHERE p.id = sub.id AND p.tenant_id = $1`,
      [tenantId]
    );
    await client.query("COMMIT");
    return true;
  } catch {
    await client.query("ROLLBACK");
    return false;
  } finally {
    client.release();
  }
}

const pageSettingsSchemaSpan = z.coerce.number().int().min(1).max(3);

/** Updates page display settings (span, refresh cadence, time window, built-ins). */
export async function updatePageSettings(
  tenantId: string,
  pageId: number,
  settings: {
    defaultSpan?: number;
    refreshSeconds?: number;
    windowMinutes?: number;
    showBuiltins?: boolean;
  }
): Promise<boolean> {
  const sets: string[] = [];
  const values: Array<string | number | boolean> = [];
  if (settings.defaultSpan !== undefined) {
    const span = pageSettingsSchemaSpan.safeParse(settings.defaultSpan);
    if (!span.success) return false;
    values.push(span.data);
    sets.push(`default_span = $${values.length}`);
  }
  if (settings.refreshSeconds !== undefined) {
    const refresh = z.coerce.number().int().min(5).max(600).safeParse(settings.refreshSeconds);
    if (!refresh.success) return false;
    values.push(refresh.data);
    sets.push(`refresh_seconds = $${values.length}`);
  }
  if (settings.windowMinutes !== undefined) {
    const win = z.coerce.number().int().min(5).max(10080).safeParse(settings.windowMinutes);
    if (!win.success) return false;
    values.push(win.data);
    sets.push(`window_minutes = $${values.length}`);
  }
  if (settings.showBuiltins !== undefined) {
    values.push(settings.showBuiltins === true);
    sets.push(`show_builtins = $${values.length}`);
  }
  if (sets.length === 0) {
    return false;
  }
  values.push(pageId, tenantId);
  const result = await getPool().query(
    `UPDATE dashboard_pages SET ${sets.join(", ")} WHERE id = $${values.length - 1} AND tenant_id = $${values.length}`,
    values
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deletePage(tenantId: string, pageId: number): Promise<boolean> {
  // Panels are re-homed to the tenant's first page instead of being lost.
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const target = await client.query<{ id: number }>(
      `SELECT id FROM dashboard_pages WHERE tenant_id = $1 AND id <> $2
       ORDER BY position, id LIMIT 1`,
      [tenantId, pageId]
    );
    if (target.rowCount === 1) {
      const homeId = target.rows[0]?.id;
      await client.query(
        "UPDATE dashboard_panels SET page_id = $1 WHERE page_id = $2 AND tenant_id = $3",
        [homeId, pageId, tenantId]
      );
    } else {
      await client.query(
        "UPDATE dashboard_panels SET page_id = NULL WHERE page_id = $1 AND tenant_id = $2",
        [pageId, tenantId]
      );
    }
    const del = await client.query(
      "DELETE FROM dashboard_pages WHERE id = $1 AND tenant_id = $2",
      [pageId, tenantId]
    );
    await client.query("COMMIT");
    return (del.rowCount ?? 0) > 0;
  } catch {
    await client.query("ROLLBACK");
    return false;
  } finally {
    client.release();
  }
}

export async function renamePage(tenantId: string, pageId: number, name: string): Promise<boolean> {
  const result = await getPool().query(
    "UPDATE dashboard_pages SET name = $1 WHERE id = $2 AND tenant_id = $3",
    [name, pageId, tenantId]
  );
  return (result.rowCount ?? 0) > 0;
}

export interface PanelPosition {
  id: number;
  position: number;
}

/** Persists new panel positions (tenant-scoped so IDs can't cross tenants). */
export async function reorderPanels(
  tenantId: string,
  positions: PanelPosition[]
): Promise<boolean> {
  if (positions.length === 0) {
    return true;
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const { id, position } of positions) {
      const result = await client.query(
        "UPDATE dashboard_panels SET position = $1 WHERE id = $2 AND tenant_id = $3",
        [position, id, tenantId]
      );
      if ((result.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return false;
      }
    }
    await client.query("COMMIT");
    return true;
  } catch {
    await client.query("ROLLBACK");
    return false;
  } finally {
    client.release();
  }
}

export async function healthcheck(): Promise<boolean> {
  const result = await getPool().query<QueryResultRow>("SELECT 1 AS ok");
  return result.rowCount === 1;
}

// ---------------------------------------------------------------------------
// Page widgets — everything visible on a dashboard page (migration 009).
// ---------------------------------------------------------------------------

export type WidgetKind = "stat" | "gauge" | "sparkline" | "hosts_table";

export interface PageWidgetRow {
  id: number;
  page_id: number;
  tenant_id: string;
  kind: WidgetKind;
  title: string;
  promql: string;
  unit: string | null;
  span: number;
  position: number;
  created_at: Date;
}

export async function listWidgets(pageId: number, tenantId: string): Promise<PageWidgetRow[]> {
  const result = await getPool().query<PageWidgetRow>(
    `SELECT id, page_id, tenant_id, kind, title, promql, unit, span, position, created_at
     FROM page_widgets WHERE page_id = $1 AND tenant_id = $2
     ORDER BY position, id`,
    [pageId, tenantId]
  );
  return result.rows;
}

export async function createWidget(input: {
  pageId: number;
  tenantId: string;
  kind: WidgetKind;
  title: string;
  promql: string;
  unit?: string | null;
  span?: number;
}): Promise<PageWidgetRow> {
  const result = await getPool().query<PageWidgetRow>(
    `INSERT INTO page_widgets (page_id, tenant_id, kind, title, promql, unit, span, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             COALESCE((SELECT MAX(position) + 1 FROM page_widgets WHERE page_id = $1), 0))
     RETURNING id, page_id, tenant_id, kind, title, promql, unit, span, position, created_at`,
    [
      input.pageId,
      input.tenantId,
      input.kind,
      input.title,
      input.promql,
      input.unit ?? null,
      input.span ?? 1,
    ]
  );
  return result.rows[0] as PageWidgetRow;
}

export async function updateWidget(
  tenantId: string,
  widgetId: number,
  patch: { title?: string; promql?: string; unit?: string | null; span?: number; kind?: WidgetKind }
): Promise<PageWidgetRow | null> {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  if (patch.title !== undefined) {
    values.push(patch.title);
    sets.push(`title = $${values.length}`);
  }
  if (patch.promql !== undefined) {
    values.push(patch.promql);
    sets.push(`promql = $${values.length}`);
  }
  if (patch.unit !== undefined) {
    values.push(patch.unit);
    sets.push(`unit = $${values.length}`);
  }
  if (patch.span !== undefined) {
    values.push(patch.span);
    sets.push(`span = $${values.length}`);
  }
  if (patch.kind !== undefined) {
    values.push(patch.kind);
    sets.push(`kind = $${values.length}`);
  }
  if (sets.length === 0) {
    return null;
  }
  values.push(widgetId, tenantId);
  const result = await getPool().query<PageWidgetRow>(
    `UPDATE page_widgets SET ${sets.join(", ")}
     WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
     RETURNING id, page_id, tenant_id, kind, title, promql, unit, span, position, created_at`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteWidget(tenantId: string, widgetId: number): Promise<boolean> {
  const result = await getPool().query(
    "DELETE FROM page_widgets WHERE id = $1 AND tenant_id = $2",
    [widgetId, tenantId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Reorders widgets within a page (tenant-scoped). */
export async function reorderWidgets(
  tenantId: string,
  pageId: number,
  positions: PanelPosition[]
): Promise<boolean> {
  if (positions.length === 0) {
    return true;
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const { id, position } of positions) {
      const result = await client.query(
        "UPDATE page_widgets SET position = $1 WHERE id = $2 AND tenant_id = $3 AND page_id = $4",
        [position, id, tenantId, pageId]
      );
      if ((result.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return false;
      }
    }
    await client.query("COMMIT");
    return true;
  } catch {
    await client.query("ROLLBACK");
    return false;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Threshold alerts (migration 011) — evaluated by services/alertEvaluator.ts
// ---------------------------------------------------------------------------

export type AlertComparator = ">" | "<" | ">=" | "<=" | "==";
export type AlertState = "pending" | "firing" | "resolved";

export interface AlertRow {
  id: number;
  tenant_id: string;
  title: string;
  promql: string;
  comparator: AlertComparator;
  threshold: number;
  for_seconds: number;
  webhook_url: string | null;
  enabled: boolean;
  state: AlertState;
  first_breach_at: string | null;
  firing_time: string | null;
  resolved_time: string | null;
  last_value: number | null;
  last_eval_at: string | null;
  created_at: string;
}

export async function listAlerts(tenantId: string): Promise<AlertRow[]> {
  const result = await getPool().query<AlertRow>(
    `SELECT * FROM alerts WHERE tenant_id = $1 ORDER BY created_at`,
    [tenantId]
  );
  return result.rows;
}

export interface CreateAlertInput {
  tenantId: string;
  title: string;
  promql: string;
  comparator: AlertComparator;
  threshold: number;
  forSeconds?: number;
  webhookUrl?: string;
}

export async function createAlert(input: CreateAlertInput): Promise<AlertRow> {
  const result = await getPool().query<AlertRow>(
    `INSERT INTO alerts (tenant_id, title, promql, comparator, threshold, for_seconds, webhook_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.tenantId,
      input.title,
      input.promql,
      input.comparator,
      input.threshold,
      input.forSeconds ?? 0,
      input.webhookUrl ?? null,
    ]
  );
  return result.rows[0] as AlertRow;
}

export async function updateAlertEnabled(
  tenantId: string,
  alertId: number,
  enabled: boolean
): Promise<boolean> {
  const result = await getPool().query(
    "UPDATE alerts SET enabled = $1 WHERE id = $2 AND tenant_id = $3",
    [enabled, alertId, tenantId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteAlert(tenantId: string, alertId: number): Promise<boolean> {
  const result = await getPool().query(
    "DELETE FROM alerts WHERE id = $1 AND tenant_id = $2",
    [alertId, tenantId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Every enabled alert, across all tenants (the evaluator's scan set). */
export async function listEnabledAlerts(): Promise<AlertRow[]> {
  const result = await getPool().query<AlertRow>(
    "SELECT * FROM alerts WHERE enabled = TRUE ORDER BY id"
  );
  return result.rows;
}

export interface AlertEvaluationPatch {
  state: AlertState;
  firstBreachAt: string | null;
  firingTime: string | null;
  resolvedTime: string | null;
  lastValue: number | null;
  lastEvalAt: string;
}

export async function recordAlertEvaluation(id: number, patch: AlertEvaluationPatch): Promise<void> {
  await getPool().query(
    `UPDATE alerts
     SET state = $1, first_breach_at = $2, firing_time = $3,
         resolved_time = $4, last_value = $5, last_eval_at = $6
     WHERE id = $7`,
    [
      patch.state,
      patch.firstBreachAt,
      patch.firingTime,
      patch.resolvedTime,
      patch.lastValue,
      patch.lastEvalAt,
      id,
    ]
  );
}
