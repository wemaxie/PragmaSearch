import type { Product, Filter, FacetValue } from "./types.js";

/** Coerce a product field to an array of primitive values (handles scalar + array fields like tags). */
function toValues(v: unknown): (string | number | boolean)[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x != null) as (string | number | boolean)[];
  return [v as string | number | boolean];
}

/**
 * Does a product satisfy the filter? AND across fields; for a field:
 *  - scalar  → exact match (against any of the product's values for that field)
 *  - array   → match if the product shares ANY value (OR)
 *  - {gte/lte} → numeric range
 */
export function matchesFilter(product: Product, filter: Filter): boolean {
  for (const field of Object.keys(filter)) {
    const cond = filter[field];
    const values = toValues(product[field]);

    if (Array.isArray(cond)) {
      if (!cond.some((c) => values.includes(c))) return false;
    } else if (cond !== null && typeof cond === "object") {
      const num = Number(values[0]);
      if (!Number.isFinite(num)) return false;
      if (cond.gte != null && !(num >= cond.gte)) return false;
      if (cond.lte != null && !(num <= cond.lte)) return false;
    } else {
      if (!values.includes(cond)) return false;
    }
  }
  return true;
}

/**
 * Count facet values over a set of products. Returns, per requested field, the
 * top `max` values by count — exactly what a refinement sidebar renders.
 */
export function computeFacets(
  products: Product[],
  fields: string[],
  max = 20,
): Record<string, FacetValue[]> {
  const out: Record<string, FacetValue[]> = {};
  for (const field of fields) {
    const counts = new Map<string, number>();
    for (const p of products) {
      for (const v of toValues(p[field])) {
        const key = String(v);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    out[field] = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, max)
      .map(([value, count]) => ({ value, count }));
  }
  return out;
}
