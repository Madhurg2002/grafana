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

/**
 * PromQL helper for the panel builder: curated recipes (filtered to what the
 * upstream actually has) plus PREDICTIVE inline autocomplete — as the user
 * types, ranked suggestions for metrics, functions, and labels appear based
 * on the cursor context (metric vs function vs label-selector position).
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
        .slice(0, 6)
        .map((m) => ({ kind: "metric" as const, text: m, hint: "metric on this upstream" }));
      const fnHits = FUNCTIONS.filter((f) => f.name.toLowerCase().startsWith(p))
        .slice(0, 4)
        .map((f) => ({ kind: "function" as const, text: f.name, hint: f.hint }));
      // Rank: exact-prefix matches first, metrics before functions.
      return [...metricHits, ...fnHits];
    }
    if (prediction.mode === "labelName") {
      return LABEL_NAMES.map((l) => ({ kind: "label" as const, text: l, hint: "label name" }));
    }
    if (prediction.mode === "labelValue" && activeMetric !== null) {
      return (labelValues[activeMetric] ?? [])
        .slice(0, 8)
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

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] text-emerald-400 transition hover:text-emerald-300"
        onClick={() => setShowHelper((v) => !v)}
      >
        <Sparkles className="h-3 w-3" aria-hidden />
        {showHelper ? "Hide helper" : "PromQL helper"}
      </button>

      {/* Predictive inline suggestions as you type */}
      {showInline ? (
        <div
          className="absolute left-0 z-20 mt-1 flex max-w-full flex-wrap gap-1 rounded-lg border border-zinc-800 bg-zinc-950/95 p-1.5 shadow-xl"
          data-testid="promql-suggestions"
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.kind}-${s.text}-${i}`}
              type="button"
              title={s.hint}
              onClick={() => applySuggestion(s.text)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition ${
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
          <button
            type="button"
            aria-label="Dismiss suggestions"
            className="rounded px-1 text-[10px] text-zinc-600 hover:text-zinc-400"
            onClick={() => setDismissed(true)}
          >
            ✕
          </button>
        </div>
      ) : null}

      {showHelper ? (
        <div
          className="absolute left-0 z-20 mt-1 w-96 max-w-[90vw] rounded-xl border border-zinc-800 bg-zinc-950 p-3 shadow-2xl"
          data-testid="promql-helper"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Starter queries (checked against your upstream)
            </p>
            <button
              type="button"
              aria-label="Close helper"
              onClick={() => setShowHelper(false)}
              className="rounded p-0.5 text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
          <ul className="mb-3 flex max-h-48 flex-col gap-1 overflow-y-auto">
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
                        : undefined
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
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Metrics on this upstream ({metricNames.length})
          </p>
          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
            {metricNames.slice(0, 20).map((name) => (
              <button
                key={name}
                type="button"
                className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                onClick={() => {
                  onChange(`${value}${value.length > 0 && !/\s$/.test(value) ? " " : ""}${name}`);
                  inputRef.current?.focus();
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
