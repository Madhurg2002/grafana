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

/**
 * PromQL helper for the panel builder: a curated recipe picker plus live
 * autocomplete of metric names (from the connected upstream) and label
 * values (instance/job/etc.) as the user types.
 */
export function PromqlHelper({ tenantId, value, onChange }: Props): JSX.Element {
  const [recipes, setRecipes] = useState<PromqlRecipe[]>([]);
  const [metricNames, setMetricNames] = useState<string[]>([]);
  const [labelValues, setLabelValues] = useState<Record<string, string[]>>({});
  const [showHelper, setShowHelper] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        // Tenant-aware recipes: flagged by what THIS upstream actually has,
        // plus auto-generated rate() panels for its own counters.
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

  // Detect the metric currently under the cursor; when it's a known node_/
  // http_ metric, opportunistically fetch instance/job label values.
  const activeMetric = useMemo(() => {
    const match = /([a-zA-Z_:][a-zA-Z0-9_:]*)\s*\{/.exec(value);
    return match?.[1] ?? null;
  }, [value]);

  useEffect(() => {
    if (activeMetric === null) {
      return;
    }
    if (labelValues[activeMetric] !== undefined) {
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
          break; // first successful label is enough for suggestions
        } catch {
          // try next label
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeMetric, tenantId, labelValues]);

  const matchingMetrics = useMemo(() => {
    // Suggest metrics that appear after the last selector-opening brace context.
    const wordMatch = /([a-zA-Z_:][a-zA-Z0-9_:]*)$/.exec(value);
    if (wordMatch === null || metricNames.length === 0) {
      return [];
    }
    const prefix = wordMatch[1].toLowerCase();
    return metricNames
      .filter((name) => name.toLowerCase().includes(prefix) && name !== wordMatch[1])
      .slice(0, 6);
  }, [value, metricNames]);

  function appendMetric(name: string): void {
    onChange(`${value.replace(/([a-zA-Z_:][a-zA-Z0-9_:]*)$/, "")}${name}`);
    inputRef.current?.focus();
  }

  function applyRecipe(recipe: PromqlRecipe): void {
    onChange(recipe.promql);
    setShowHelper(false);
  }

  const suggestions = labelValues[activeMetric ?? ""] ?? [];

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

      {showHelper ? (
        <div
          className="absolute left-0 z-20 mt-1 w-96 max-w-[90vw] rounded-xl border border-zinc-800 bg-zinc-950 p-3 shadow-2xl"
          data-testid="promql-helper"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Starter queries
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
            {matchingMetrics.length > 0
              ? matchingMetrics.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 hover:bg-emerald-500/10"
                    onClick={() => appendMetric(name)}
                  >
                    {name}
                  </button>
                ))
              : metricNames.slice(0, 20).map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                    onClick={() => appendMetric(name)}
                  >
                    {name}
                  </button>
                ))}
          </div>
          {activeMetric !== null && suggestions.length > 0 ? (
            <>
              <p className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                {activeMetric} instances
              </p>
              <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                {suggestions.slice(0, 12).map((instance) => (
                  <span
                    key={instance}
                    className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                  >
                    {instance}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
