import { Migration } from "./runner.js";

/**
 * 010: per-page control over the built-in essentials strip.
 *
 * `dashboard_pages.show_builtins` (default TRUE so every existing page keeps
 * its Hosts Up / CPU / RAM / Network cards) lets a page opt out of the fixed
 * built-in layer and be composed ONLY from its own widgets. New pages can
 * start clean; the toggle lives in the page toolbar.
 */
const M010_PAGE_SHOW_BUILTINS = `
ALTER TABLE dashboard_pages
  ADD COLUMN IF NOT EXISTS show_builtins BOOLEAN NOT NULL DEFAULT TRUE;
`;

export const M010: Migration = {
  name: "010_page_show_builtins",
  sql: M010_PAGE_SHOW_BUILTINS,
};
