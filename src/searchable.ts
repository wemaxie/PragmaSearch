import type { Product, SearchableAttribute, ResolvedAttribute } from "./types.js";

/**
 * Searchable attributes — which product fields feed search, and how heavily.
 *
 * A "weight" scales a field's contribution to the BM25 (keyword) layer, exactly
 * like the old hardcoded `TITLE_WEIGHT = 2` did — a term appearing in a weight-2
 * field counts as if it appeared twice. It does NOT re-weight the vector: a
 * product is embedded as ONE mean-pooled vector, so weights can't tilt it. Fields
 * are embedded once each, in declaration order (the leading field carries the
 * most semantic signal for short sentence models).
 */

/** The historical default: title counts double, then description, category, tags. */
export const DEFAULT_SEARCHABLE: ResolvedAttribute[] = [
  { field: "title", weight: 2 },
  { field: "description", weight: 1 },
  { field: "category", weight: 1 },
  { field: "tags", weight: 1 },
];

/** Parse one attribute: `"brand"`, `"title^3"`, or `{ field, weight }` → `{ field, weight }`. */
export function resolveAttribute(a: SearchableAttribute): ResolvedAttribute {
  if (typeof a === "string") {
    const m = a.match(/^(.+?)\^(\d+(?:\.\d+)?)$/);
    if (m) return { field: m[1], weight: Number(m[2]) };
    return { field: a, weight: 1 };
  }
  return { field: a.field, weight: a.weight ?? 1 };
}

/**
 * Normalize a `searchableAttributes` config into `{ field, weight }[]`. Drops
 * empty/zero-weight entries; falls back to {@link DEFAULT_SEARCHABLE} when the
 * config is absent or degenerate (so old indexes and empty configs keep working).
 */
export function resolveSearchable(attrs?: SearchableAttribute[]): ResolvedAttribute[] {
  if (!attrs || attrs.length === 0) return DEFAULT_SEARCHABLE;
  const out = attrs.map(resolveAttribute).filter((a) => a.field && a.weight > 0);
  return out.length ? out : DEFAULT_SEARCHABLE;
}

/**
 * Extract a field's searchable text from a product. Strings pass through; arrays
 * (e.g. `tags`) are space-joined; numbers/booleans are stringified. Anything else
 * (objects, null, undefined) contributes nothing.
 */
export function fieldText(p: Product, field: string): string {
  const v = (p as Record<string, unknown>)[field];
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.filter((x) => x != null).map(String).join(" ");
  return "";
}

/**
 * The text we actually embed for a product: each searchable field once, in
 * declaration order, joined with ". ". Empty fields are skipped. We DON'T just
 * embed the title — description, category and tags carry the meaning that makes
 * "for gaming" match an "RTX 5090".
 */
export function productText(
  p: Product,
  attrs: ResolvedAttribute[] = DEFAULT_SEARCHABLE,
): string {
  return attrs
    .map((a) => fieldText(p, a.field).trim())
    .filter((s) => s.length > 0)
    .join(". ");
}
