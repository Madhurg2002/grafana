import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Sparkles, X } from "lucide-react";
import {
  fetchLabelValues,
  fetchMetricNames,
  fetchRecipesForTenant,
  type PromqlRecipe,
} from "../lib/api";

interface Props {
  tenantId: string;
  value: string;
  onChange: (next: string) => void;
  /** The query textarea this helper annotates — anchors the floating list. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** Parent registers a callback to recompute the overlay position on caret moves. */
  registerTrigger?: (fn: () => void) => void;
  /** Parent registers the textarea keydown handler (IDE-style keyboard nav). */
  registerKeyDown?: (fn: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void) => void;
}

/** PromQL vocabulary used to predict what the user is typing. */
const FUNCTIONS: Array<{ name: string; hint: string }> = [
  { name: "rate(", hint: "per-second increase of a counter — needs [5m]+ window" },
  { name: "irate(", hint: "instant per-second counter rate (jumpy)" },
  { name: "sum(", hint: "aggregate across all series" },
  { name: "avg(", hint: "mean value across series" },
  { name: "max(", hint: "highest value across series" },
  { name: "min(", hint: "lowest value across series" },
  { name: "count(", hint: "number of series" },
  { name: "topk(", hint: "largest k series, e.g. topk(5, …)" },
  { name: "by (", hint: "group aggregations, e.g. sum by (instance) (…)" },
  { name: "histogram_quantile(", hint: "percentiles from histogram buckets" },
  { name: "increase(", hint: "total increase over the window" },
  { name: "avg_over_time(", hint: "average of a range vector" },
];

const LABEL_NAMES = ["instance", "job", "device", "mode", "method", "status", "endpoint", "le", "quantile"];

const MAX_VISIBLE = 8;

/**
 * Code-editor-style PromQL autocomplete: as the user types, a VERTICAL
 * suggestion list floats above everything (fixed overlay, like an IDE's
 * intellisense) with ↑/↓ keyboard navigation, Enter to accept, Escape to
 * dismiss. Nothing can clip it and it never disturbs the form layout.
 */
export function PromqlHelper({ tenantId, value, onChange, inputRef, registerTrigger, registerKeyDown }: Props): JSX.Element {
  const [recipes, setRecipes] = useState<PromqlRecipe[]>([]);
  const [metricNames, setMetricNames] = useState<string[]>([]);
  const [labelValues, setLabelValues] = useState<Record<string, string[]>>({});
  const [showHelper, setShowHelper] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { recipes: list } = await fetchRecipesForTenant(tenantId);
        setRecipes(list);
      } catch {
        // Recipes are a nicety — silently skip if unreachable.
      }
      try {
        const { names } = await fetchMetricNames(tenantId);
        setMetricNames(names);
      } catch {
        // Upstream catalog unavailable — autocomplete just stays empty.
      }
    })();
  }, [tenantId]);

  // ---- Predictive context analysis ---------------------------------------
  const prediction = useMemo(() => {
    const cursorPrefix = value; // treat end-of-input as the cursor
    const inSelector = /\{[^}]*$/.test(cursorPrefix);
    const wordMatch = /([a-zA-Z_:][a-zA-Z0-9_:]*)$/.exec(cursorPrefix);
    const partial = wordMatch?.[1] ?? "";
    const selectorMetric = /([a-zA-Z_:][a-zA-Z0-9_:]*)\{[^}]*$/.exec(cursorPrefix)?.[1] ?? null;

    if (inSelector) {
      const afterEquals = /= ?~? ?"([^"]*)$/.exec(cursorPrefix);
      if (afterEquals !== null && selectorMetric !== null) {
        return { mode: "labelValue" as const, partial: afterEquals[1], selectorMetric };
      }
      const labelPartial = /([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(cursorPrefix.replace(/= ?~? ?"[^"]*$/, ""))?.[1] ?? "";
      return { mode: "labelName" as const, partial: labelPartial, selectorMetric };
    }

    const afterOpen = /\(\s*$/.test(cursorPrefix);
    if (partial.length > 0) {
      return { mode: "word" as const, partial, afterOpen };
    }
    return { mode: "idle" as const, partial: "", afterOpen };
  }, [value]);

  // Opportunistically fetch instance/job values for the active metric.
  const activeMetric = prediction.mode === "labelName" || prediction.mode === "labelValue"
    ? prediction.selectorMetric
    : /([a-zA-Z_:][a-zA-Z0-9_:]*)\s*\{/.exec(value)?.[1] ?? null;

  useEffect(() => {
    if (activeMetric === null || labelValues[activeMetric] !== undefined) {
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const label of ["instance", "job"]) {
        try {
          const { values } = await fetchLabelValues(tenantId, label);
          if (!cancelled) {
            setLabelValues((prev) => ({ ...prev, [activeMetric]: values.slice(0, 50) }));
          }
          break;
        } catch {
          // try next label
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeMetric, tenantId, labelValues]);

  const suggestions = useMemo(() => {
    const p = prediction.partial.toLowerCase();
    if (prediction.mode === "word") {
      const metricHits = metricNames
        .filter((m) => m.toLowerCase().startsWith(p) || m.toLowerCase().includes(p))
        .slice(0, 6)
        .map((m) => ({ kind: "metric" as const, text: m, hint: "metric on this upstream" }));
      const fnHits = FUNCTIONS.filter((f) => f.name.toLowerCase().startsWith(p))
        .slice(0, 4)
        .map((f) => ({ kind: "function" as const, text: f.name, hint: f.hint }));
      return [...metricHits, ...fnHits];
    }
    if (prediction.mode === "labelName") {
      return LABEL_NAMES.map((l) => ({ kind: "label" as const, text: l, hint: "label name" }));
    }
    if (prediction.mode === "labelValue" && activeMetric !== null) {
      return (labelValues[activeMetric] ?? [])
        .slice(0, 10)
        .map((v) => ({ kind: "value" as const, text: v, hint: "value on this upstream" }));
    }
    return [];
  }, [prediction, metricNames, labelValues, activeMetric]);

  const showList =
    !dismissed &&
    anchor !== null &&
    suggestions.length > 0 &&
    (prediction.mode === "word" || prediction.mode === "labelName" || prediction.mode === "labelValue");

  // Click anywhere outside (list or textarea) closes the suggestion list —
  // mirrors editor behavior and stops the overlay from lingering over the
  // form buttons.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showList) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (listRef.current?.contains(target)) {
        return;
      }
      if (inputRef?.current?.contains(target)) {
        return;
      }
      setDismissed(true);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [showList]);

  // Keep the highlight in range whenever the suggestion set changes.
  useEffect(() => {
    setHighlight((current) => Math.min(current, Math.max(suggestions.length - 1, 0)));
  }, [suggestions.length]);

  // Let the parent (textarea keyup/click) re-anchor the floating list and
  // forward textarea key events for ↑/↓/Enter/Esc navigation.
  useEffect(() => {
    registerTrigger?.(updateAnchor);
    registerKeyDown?.(handleKeyDown);
    // Re-clamp on window resize/scroll so the list never drifts out of
    // bounds while open.
    const reflow = (): void => {
      if (anchor !== null) {
        updateAnchor();
      }
    };
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    return () => {
      registerTrigger?.(() => undefined);
      registerKeyDown?.(() => undefined);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    };
  });

  /** Compute the floating overlay position from the caret (end-of-input).
   *  Clamped to the viewport: flips above the textarea when there is no
   *  room below, and pulls left when the textarea hugs the right edge —
   *  the list can never leave the visible area. */
  function updateAnchor(): void {
    const el = inputRef?.current;
    if (el === null || el === undefined) {
      setAnchor(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const LIST_WIDTH = 320; // w-80
    const LIST_MAX_HEIGHT = 224; // max-h-56
    const margin = 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow >= LIST_MAX_HEIGHT + margin
        ? rect.bottom + 4
        : Math.max(margin, rect.top - LIST_MAX_HEIGHT - 4);
    const left = Math.max(
      margin,
      Math.min(rect.left, window.innerWidth - LIST_WIDTH - margin)
    );
    setAnchor({ top, left });
  }

  function applySuggestion(text: string): void {
    if (prediction.mode === "labelName") {
      onChange(`${value.replace(/([a-zA-Z_][a-zA-Z0-9_]*)$/, "")}${text}`);
    } else if (prediction.mode === "labelValue") {
      onChange(`${value.replace(/"[^"]*$/, "")}"${text}"`);
    } else {
      onChange(`${value.replace(/([a-zA-Z_:][a-zA-Z0-9_:]*)$/, "")}${text}`);
    }
    setDismissed(false);
    inputRef?.current?.focus();
  }

  function applyRecipe(recipe: PromqlRecipe): void {
    onChange(recipe.promql);
    setShowHelper(false);
    setDismissed(false);
  }

  /** Keyboard handling on the textarea — ↑/↓/Enter/Escape like an IDE. */
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (!showList || suggestions.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = suggestions[highlight];
      if (chosen !== undefined) {
        applySuggestion(chosen.text);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(true);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        title="Starter queries and the metric catalog for this upstream — opens a modal"
        className="flex items-center gap-1 text-[11px] text-emerald-400 transition hover:text-emerald-300"
        onClick={() => setShowHelper(true)}
      >
        <Sparkles className="h-3 w-3" aria-hidden />
        PromQL helper
      </button>

      {/* Code-editor-style floating suggestion list — a fixed overlay that
          cannot be clipped by the form/card, positioned under the caret. */}
      {showList && anchor !== null ? (
        <div
          ref={listRef}
          className="fixed z-[60] max-h-56 w-80 max-w-[90vw] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl"
          style={{ top: anchor.top, left: anchor.left }}
          data-testid="promql-suggestions"
          role="listbox"
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.kind}-${s.text}-${i}`}
              type="button"
              role="option"
              aria-selected={i === highlight}
              title={s.hint}
              // mousedown (not click) so the textarea keeps focus
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(s.text);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left font-mono text-[11px] transition ${
                i === highlight ? "bg-emerald-500/15 text-emerald-200" : "text-zinc-300 hover:bg-zinc-900"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{s.text}</span>
              <span
                className={`shrink-0 text-[9px] uppercase tracking-wide ${
                  s.kind === "metric"
                    ? "text-emerald-500"
                    : s.kind === "function"
                      ? "text-sky-400"
                      : s.kind === "label"
                        ? "text-violet-400"
                        : "text-zinc-500"
                }`}
              >
                {s.kind}
              </span>
            </button>
          ))}
          <div className="border-t border-zinc-800 px-2.5 py-1 text-[9px] text-zinc-600">
            ↑↓ navigate · Enter accept · Esc dismiss{suggestions.length > MAX_VISIBLE ? ` · ${suggestions.length} matches` : ""}
          </div>
        </div>
      ) : null}

      {/* Full helper as a centered modal — clipped by nothing. */}
      {showHelper ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="PromQL helper"
          data-testid="promql-helper"
          onClick={() => setShowHelper(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowHelper(false);
          }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-zinc-200">PromQL helper</p>
                <p className="text-[11px] text-zinc-500">
                  Starter queries and the metric catalog for this upstream. Click anything to insert it.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close helper"
                onClick={() => setShowHelper(false)}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
              <section>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Starter queries (checked against your upstream)
                </p>
                <ul className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                  {recipes.map((recipe) => {
                    const unavailable = recipe.available === false;
                    return (
                      <li key={recipe.title}>
                        <button
                          type="button"
                          disabled={unavailable}
                          title={
                            unavailable
                              ? `Needs: ${(recipe.missingMetrics ?? []).slice(0, 3).join(", ")}`
                              : recipe.promql
                          }
                          className={`w-full rounded-lg px-2 py-1.5 text-left text-xs transition ${
                            unavailable
                              ? "cursor-not-allowed text-zinc-600"
                              : "text-zinc-300 hover:bg-zinc-900 hover:text-emerald-200"
                          }`}
                          onClick={() => applyRecipe(recipe)}
                        >
                          <span className="block font-medium">{recipe.title}</span>
                          <span className="block truncate font-mono text-[10px] text-zinc-500">
                            {recipe.promql}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Metrics on this upstream ({metricNames.length})
                </p>
                <p className="mb-2 text-[11px] text-zinc-600">
                  Click a metric to append it to the query. Type in the query box for predictive suggestions.
                </p>
                <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                  {metricNames.slice(0, 60).map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="max-w-full truncate rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                      onClick={() => {
                        onChange(`${value}${value.length > 0 && !/\s$/.test(value) ? " " : ""}${name}`);
                        inputRef?.current?.focus();
                      }}
                    >
                      {name}
                    </button>
                  ))}
                  {metricNames.length === 0 ? (
                    <p className="text-[11px] text-zinc-600">
                      No metric catalog available — the upstream may be unreachable.
                    </p>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
