import { Migration } from "./runner.js";

/**
 * 017: freeform widget sizing.
 *
 * Widgets were capped at span 1–3, which predates the doubled grids
 * (4 columns at sm+, 6 at 2xl+ in wide mode). Users compose walls of
 * graphs and want any width: this widens both widget span and the page
 * default to 1–12 (covers full-row on every grid size the UI emits,
 * and future-proof for finer grids). CHECK constraints are enforced at
 * the DB level; the API validates 1–12 too.
 */
const sql = `
ALTER TABLE page_widgets DROP CONSTRAINT IF EXISTS page_widgets_span_check;
ALTER TABLE page_widgets
  ADD CONSTRAINT page_widgets_span_check
  CHECK (span >= 1 AND span <= 12);

ALTER TABLE dashboard_pages DROP CONSTRAINT IF EXISTS dashboard_pages_default_span_check;
ALTER TABLE dashboard_pages
  ADD CONSTRAINT dashboard_pages_default_span_check
  CHECK (default_span >= 1 AND default_span <= 12);
`;

export const M017: Migration = {
  name: "017_widget_span_12",
  sql,
};
