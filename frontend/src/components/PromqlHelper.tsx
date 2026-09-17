import { useEffect, useMemo, useRef, useState } from "react";
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

const MAX_INLINE_SUGGESTIONS = 5;

/**
 * PromQL helper for the panel builder: curated recipes (filtered to what the
 * upstream actually has) plus PREDICTIVE inline autocomplete. The full helper
 * (recipes + metric catalog + series browser) opens as a centered MODAL so it
 * can never be clipped by panel/card bounds; the as-you-type suggestions stay
 * anchored to the input but are width/height capped and scroll internally.
 */
export function PromqlHelper({ tenantId, value, onChange }: Props): JSX.Element {
  const [recipes, setRecipes] = useState<PromqlRecipe[]>([]);
  const [metricNames, setMetricNames] = useState<string[]>([]);
  const [labelValues, setLabelValues] = useState<Record<string, string[]>>({});
  const [showHelper, setShowHelper] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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
    // Inside a label selector? {metric{lab…  → suggest label names/values.
    const inSelector = /\{[^}]*$/.test(cursorPrefix);
    // Partial word being typed right now.
    const wordMatch = /([a-zA-Z_:][a-zA-Z0-9_:]*)$/.exec(cursorPrefix);
    const partial = wordMatch?.[1] ?? "";

    // The metric a selector belongs to (…metric{...).
    const selectorMetric = /([a-zA-Z_:][a-zA-Z0-9_:]*)\{[^}]*$/.exec(cursorPrefix)?.[1] ?? null;

    if (inSelector) {
      // After `label=` or `label=~` suggest matching VALUES.
      const afterEquals = /= ?~? ?"([^"]*)$/.exec(cursorPrefix);
      if (afterEquals !== null && selectorMetric !== null) {
        return { mode: "labelValue" as const, partial: afterEquals[1], selectorMetric };
      }
      const labelPartial = /([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(cursorPrefix.replace(/= ?~? ?"[^"]*$/, ""))?.[1] ?? "";
      return { mode: "labelName" as const, partial: labelPartial, selectorMetric };
    }

    // Which functions make sense: after an aggregation opener or anywhere.
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
        .slice(0, 4)
        .map((m) => ({ kind: "metric" as const, text: m, hint: "metric on this upstream" }));
      const fnHits = FUNCTIONS.filter((f) => f.name.toLowerCase().startsWith(p))
        .slice(0, 2)
        .map((f) => ({ kind: "function" as const, text: f.name, hint: f.hint }));
      // Rank: exact-prefix matches first, metrics before functions.
      return [...metricHits, ...fnHits];
    }
    if (prediction.mode === "labelName") {
      return LABEL_NAMES.map((l) => ({ kind: "label" as const, text: l, hint: "label name" }));
    }
    if (prediction.mode === "labelValue" && activeMetric !== null) {
      return (labelValues[activeMetric] ?? [])
        .slice(0, 6)
        .map((v) => ({ kind: "value" as const, text: v, hint: "value on this upstream" }));
    }
    return [];
  }, [prediction, metricNames, labelValues, activeMetric]);

  function applySuggestion(text: string): void {
    if (prediction.mode === "labelName") {
      onChange(`${value.replace(/([a-zA-Z_][a-zA-Z0-9_]*)$/, "")}${text}`);
    } else if (prediction.mode === "labelValue") {
      onChange(`${value.replace(/"[^"]*$/, "")}"${text}"`);
    } else {
      onChange(`${value.replace(/([a-zA-Z_:][a-zA-Z0-9_:]*)$/, "")}${text}`);
    }
    inputRef.current?.focus();
    setDismissed(false);
  }

  function applyRecipe(recipe: PromqlRecipe): void {
    onChange(recipe.promql);
    setShowHelper(false);
    setDismissed(false);
  }

  const showInline =
    !dismissed && suggestions.length > 0 && (prediction.mode === "word" || prediction.mode === "labelName" || prediction.mode === "labelValue");

  const inlineShown = suggestions.slice(0, MAX_INLINE_SUGGESTIONS);

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] text-emerald-400 transition hover:text-emerald-300"
        onClick={() => setShowHelper(true)}
      >
        <Sparkles className="h-3 w-3" aria-hidden />
        PromQL helper
      </button>

      {/* Predictive inline suggestions as you type — anchored to the input,
          width/height capped and wrapping internally so they can never spill
          outside the card/panel bounds. */}
      {showInline ? (
        <div
          className="absolute left-0 top-full z-30 mt-1 flex max-h-16 w-full min-w-0 flex-wrap items-start gap-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/95 p-1.5 shadow-xl"
          data-testid="promql-suggestions"
        >
          {inlineShown.map((s, i) => (
            <button
              key={`${s.kind}-${s.text}-${i}`}
              type="button"
              title={s.hint}
              onClick={() => applySuggestion(s.text)}
              className={`max-w-full truncate rounded px-1.5 py-0.5 font-mono text-[10px] transition ${
                s.kind === "metric"
                  ? "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                  : s.kind === "function"
                    ? "bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"
                    : s.kind === "label"
                      ? "bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              {s.text}
            </button>
          ))}
          {suggestions.length > inlineShown.length ? (
            <button
              type="button"
              title="Open the helper to browse all matches"
              onClick={() => setShowHelper(true)}
              className="rounded px-1.5 py-0.5 text-[10px] text-emerald-400 hover:text-emerald-300"
            >
              +{suggestions.length - inlineShown.length} more…
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss suggestions"
            className="ml-auto rounded px-1 text-[10px] text-zinc-600 hover:text-zinc-400"
            onClick={() => setDismissed(true)}
          >
            ✕
          </button>
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
                        inputRef.current?.focus();
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
