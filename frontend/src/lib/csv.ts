/**
 * Client-side CSV export for widget data (sparkline series, gauge/stat
 * samples). Pure string building — no server round-trip, works on share
 * views too.
 */

function csvEscape(value: string): string {
  if (/[\",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds a CSV string from row objects sharing the same keys and triggers a
 * browser download. Column order follows the first row's key order.
 */
export function downloadCsv(
  filename: string,
  rows: Array<Record<string, string | number>>
): void {
  if (rows.length === 0) {
    return;
  }
  const headers = Object.keys(rows[0] ?? {});
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((header) => {
          const value = row[header];
          return csvEscape(value === undefined || value === null ? "" : String(value));
        })
        .join(",")
    );
  }
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Timestamped, safe filename from a widget title. */
export function csvFilename(title: string): string {
  const safe = title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "widget";
  return `${safe}-${new Date().toISOString().slice(0, 10)}`;
}
