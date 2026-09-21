import { Migration } from "./runner.js";

/**
 * 018: user-decided widget height.
 *
 * Span keeps controlling how many columns a widget stretches across;
 * height_px pins the widget's pixel height so a widget stays exactly the
 * size the user set regardless of zoom/viewport. The UI clamps to sane
 * bounds; the DB just needs a broad sane CHECK.
 */
const sql = `
ALTER TABLE page_widgets
  ADD COLUMN IF NOT EXISTS height_px SMALLINT NOT NULL DEFAULT 112
    CHECK (height_px >= 60 AND height_px <= 1200);
`;

export const M018: Migration = {
  name: "018_widget_height_px",
  sql,
};
