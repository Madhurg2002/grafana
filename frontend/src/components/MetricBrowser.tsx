import { useEffect, useMemo, useState } from "react";
import { Table2, Search, X } from "lucide-react";
import { fetchMetricNames, fetchMetricSeries } from "../lib/api";

interface Props {
  tenantId: string;
  onInsert: (promql: string) => void;
  onClose: () => void;
}

type Row = Record<string, string>;

/**
 * Table-style metric browser: metrics are "tables", their label sets are
 * "columns". Pick a metric, browse the live series rows from the connected
 * upstream, filter by any label value, and insert a ready-made PromQL
 * expression (optionally filtered to a specific series).
 */
export function MetricBrowser({ tenantId, onInsert, onClose }: Props): JSX.Element {
  const [metrics, setMetrics] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [rowFilter, setRowFilter] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const { names } = await fetchMetricNames(tenantId);
        setMetrics(names);
      } catch {
        // Catalog unavailable — search box stays empty.
      }
    })();
  }, [tenantId]);

  useEffect(() => {
    if (selected === null) {
      return;
    }
    setLoadingSeries(true);
    let cancelled = false;
    void (async () => {
      try {
        const result = (await fetchMetricSeries(tenantId, selected)) as {
          series?: Row[];
        };
        if (!cancelled) {
          setRows(result.series ?? []);
        }
      } catch {
        if (!cancelled) {
          setRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingSeries(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, tenantId]);

  const filteredMetrics = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q.length > 0 ? metrics.filter((m) => m.includes(q)) : metrics;
    return list.slice(0, 60);
  }, [metrics, filter]);

  const columns = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows.slice(0, 50)) {
      for (const key of Object.keys(row)) {
        if (key !== "__name__") {
          set.add(key);
        }
      }
    }
    return [...set].slice(0, 5);
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = rowFilter.trim().toLowerCase();
    if (q.length === 0) {
      return rows.slice(0, 30);
    }
    return rows
      .filter((row) => Object.values(row).some((v) => v.toLowerCase().includes(q)))
      .slice(0, 30);
  }, [rows, rowFilter]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-label="Metric browser"
      data-testid="metric-browser"
    >
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Table2 className="h-4 w-4 text-emerald-300" aria-hidden />
            Metric browser
            <span className="text-xs font-normal text-zinc-500">
              {selected === null ? `${metrics.length} tables` : selected}
            </span>
          </h2>
          <button
            type="button"
            aria-label="Close browser"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 transition hover:text-zinc-200"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 overflow-hidden sm:grid-cols-[220px_1fr]">
          {/* Metric "tables" list */}
          <div className="flex flex-col overflow-hidden border-b border-zinc-800 sm:border-b-0 sm:border-r">
            <div className="p-2">
              <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter metrics…"
                  className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-600 outline-none"
                />
              </div>
            </div>
            <ul className="flex-1 overflow-y-auto px-2 pb-2">
              {filteredMetrics.map((metric) => (
                <li key={metric}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(metric);
                      setRowFilter("");
                    }}
                    title={metric}
                    className={`w-full truncate rounded-md px-2 py-1 text-left font-mono text-[11px] transition ${
                      selected === metric
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                    }`}
                  >
                    {metric}
                  </button>
                </li>
              ))}
              {filteredMetrics.length === 0 ? (
                <li className="px-2 py-4 text-xs text-zinc-600">No matching metrics.</li>
              ) : null}
            </ul>
          </div>

          {/* Series "rows × columns" table */}
          <div className="flex flex-col overflow-hidden">
            {selected === null ? (
              <p className="p-6 text-center text-xs text-zinc-600">
                Select a metric on the left to browse its live series — each row
                is one labeled stream, each column a label.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 p-2">
                  <input
                    value={rowFilter}
                    onChange={(e) => setRowFilter(e.target.value)}
                    placeholder="Filter rows by label value…"
                    className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50"
                  />
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-500/90 px-2.5 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400"
                    onClick={() => onInsert(selected)}
                  >
                    Insert metric
                  </button>
                </div>
                <div className="flex-1 overflow-auto px-2 pb-2">
                  {loadingSeries ? (
                    <p className="p-4 text-xs text-zinc-500">Loading series…</p>
                  ) : (
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-zinc-500">
                        <tr>
                          {columns.map((col) => (
                            <th key={col} className="px-2 py-1 font-medium">
                              {col}
                            </th>
                          ))}
                          <th className="px-2 py-1" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.map((row, index) => (
                          <tr
                            key={index}
                            className="border-t border-zinc-800/60 hover:bg-zinc-900/60"
                          >
                            {columns.map((col) => (
                              <td
                                key={col}
                                className="max-w-40 truncate px-2 py-1 font-mono text-zinc-300"
                              >
                                <span title={row[col] ?? ""} className="block truncate">
                                  {row[col] ?? "—"}
                                </span>
                              </td>
                            ))}
                            <td className="px-2 py-1 text-right">
                              <button
                                type="button"
                                className="rounded px-1.5 py-0.5 text-[10px] text-emerald-400 hover:bg-emerald-500/10"
                                onClick={() => {
                                  const selector = `{__name__="${row.__name__ ?? selected}"${columns
                                    .map((c) => `,${c}="${row[c]}"`)
                                    .join("")}}`;
                                  onInsert(`sum(rate(${selector}[5m]))`);
                                }}
                              >
                                insert rate()
                              </button>
                            </td>
                          </tr>
                        ))}
                        {filteredRows.length === 0 && !loadingSeries ? (
                          <tr>
                            <td colSpan={columns.length + 1} className="px-2 py-4 text-zinc-600">
                              No series match.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
