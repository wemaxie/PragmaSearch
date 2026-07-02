import { matchesFilter } from "./facets.js";
import type { Filter, Product, SearchSignal } from "./types.js";

/**
 * Ranking rules — merchandising on top of relevance.
 *
 * Applied as a post-fusion re-score, so they work in every mode (hybrid, vector,
 * keyword, browse):
 *  - `boost` / `bury` nudge the score of items matching a filter or id list.
 *    The amount `by` is expressed in units of the top result's score, so a value
 *    behaves the same regardless of the (very different) score scales across modes.
 *    `by: 1` ≈ "one top-result's worth"; `0.2` is a gentle nudge.
 *  - `pin` forces specific ids to the very top, in the given order, regardless of
 *    score — the hard promotion a homepage/category merchandiser wants.
 */

/** A boost/bury target: items matching this filter and/or appearing in `ids`. */
export interface RankingRule {
  /** Match items by field filter (same shape as a search filter). */
  filter?: Filter;
  /** Match items by explicit id. */
  ids?: (string | number)[];
  /** Amount to add (boost) or subtract (bury), in units of the top score. */
  by: number;
}

/** A set of merchandising rules applied after ranking. */
export interface RankingRules {
  /** Raise the score of matching items. */
  boost?: RankingRule[];
  /** Lower the score of matching items. */
  bury?: RankingRule[];
  /** Force these ids to the top, in this order. */
  pin?: (string | number)[];
}

interface CompiledRule {
  idSet?: Set<string>;
  filter?: Filter;
  by: number;
}

function compile(rules: RankingRule[] | undefined): CompiledRule[] {
  return (rules ?? []).map((r) => ({
    idSet: r.ids ? new Set(r.ids.map(String)) : undefined,
    filter: r.filter,
    by: r.by,
  }));
}

function ruleApplies(rule: CompiledRule, id: string, payload: Product | undefined): boolean {
  if (rule.idSet?.has(id)) return true;
  if (rule.filter && payload && matchesFilter(payload, rule.filter)) return true;
  return false;
}

/**
 * Re-score and reorder a ranked list in place per the given rules. `getPayload`
 * resolves an id to its product (for filter matching). Returns the reordered list.
 * No-op (returns the input) when `rules` is undefined/empty.
 */
export function applyRankingRules<
  T extends { id: string; score: number; signals?: SearchSignal[] },
>(
  ranked: T[],
  rules: RankingRules | undefined,
  getPayload: (id: string) => Product | undefined,
): T[] {
  if (!rules) return ranked;
  const boost = compile(rules.boost);
  const bury = compile(rules.bury);
  const pin = rules.pin ?? [];

  if (boost.length || bury.length) {
    // Express `by` relative to the top score so it behaves the same across modes
    // (RRF scores are ~0.01, cosine is 0–1, browse mode is 0 → unit falls back to 1).
    const unit = ranked.reduce((m, r) => Math.max(m, r.score), 0) || 1;
    for (const r of ranked) {
      const payload = getPayload(r.id);
      for (const rule of boost) if (ruleApplies(rule, r.id, payload)) r.score += rule.by * unit;
      for (const rule of bury) if (ruleApplies(rule, r.id, payload)) r.score -= rule.by * unit;
    }
    ranked = ranked.slice().sort((a, b) => b.score - a.score);
  }

  if (pin.length) {
    const order = new Map(pin.map((id, i) => [String(id), i] as const));
    const pinned: T[] = [];
    const rest: T[] = [];
    for (const r of ranked) (order.has(r.id) ? pinned : rest).push(r);
    pinned.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    for (const r of pinned) {
      if (!r.signals) r.signals = [];
      if (!r.signals.includes("pinned")) r.signals.push("pinned");
    }
    ranked = [...pinned, ...rest];
  }

  return ranked;
}
