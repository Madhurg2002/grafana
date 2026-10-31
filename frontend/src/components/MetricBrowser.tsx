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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-label="Metric browser"
      data-testid="metric-browser"
    >
      <div className="glass-card flex max-h-[85vh] w-full max-w-3xl flex-col bg-[#080a0e] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.075] px-4 py-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-white">
            <Table2 className="h-4 w-4 text-[#5eead4]" aria-hidden />
            Metric browser
            <span className="text-[11px] font-normal text-[#8d95a8]">
              {selected === null ? `${metrics.length} tables` : selected}
            </span>
          </h2>
          <button
            type="button"
            aria-label="Close browser"
            onClick={onClose}
            className="rounded-md p-1 text-[#5f6779] transition hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 overflow-hidden sm:grid-cols-[220px_1fr]">
          {/* Metric "tables" list */}
          <div className="flex flex-col overflow-hidden border-b border-white/[0.075] sm:border-b-0 sm:border-r">
            <div className="p-2">
              <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-black/40 px-2 py-1.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-[#5f6779]" aria-hidden />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter metrics…"
                  className="w-full bg-transparent text-xs text-[#e6e9f0] placeholder-[#5f6779] outline-none"
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
                        ? "bg-[#5eead4]/[0.12] text-[#7df0dc]"
                        : "text-[#8d95a8] hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    {metric}
                  </button>
                </li>
              ))}
              {filteredMetrics.length === 0 ? (
                <li className="px-2 py-4 text-xs text-[#5f6779]">No matching metrics.</li>
              ) : null}
            </ul>
          </div>

          {/* Series "rows × columns" table */}
          <div className="flex flex-col overflow-hidden">
            {selected === null ? (
              <p className="p-6 text-center text-xs leading-relaxed text-[#5f6779]">
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
                    className="field min-w-0 flex-1 text-xs"
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onInsert(selected)}
                  >
                    Insert metric
                  </button>
                </div>
                <div className="flex-1 overflow-auto px-2 pb-2">
                  {loadingSeries ? (
                    <p className="p-4 text-xs text-[#8d95a8]">Loading series…</p>
                  ) : (
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-[#8d95a8]">
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
                            className="border-t border-white/[0.06] hover:bg-white/[0.03]"
                          >
                            {columns.map((col) => (
                              <td
                                key={col}
                                className="max-w-40 truncate px-2 py-1 font-mono text-[#c3cad8]"
                              >
                                <span title={row[col] ?? ""} className="block truncate">
                                  {row[col] ?? "—"}
                                </span>
                              </td>
                            ))}
                            <td className="px-2 py-1 text-right">
                              <button
                                type="button"
                                className="rounded px-1.5 py-0.5 text-[10px] text-[#7df0dc] transition hover:bg-[#5eead4]/10"
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
                            <td colSpan={columns.length + 1} className="px-2 py-4 text-[#5f6779]">
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
