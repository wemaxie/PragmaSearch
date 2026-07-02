import type { PragmaIndex, Product, IndexItem } from "./types.js";
import { productText, resolveSearchable } from "./searchable.js";

/**
 * Incremental index updates — the cheap path for live catalogs.
 *
 * The expensive part of indexing is the embedding pass. For fields that don't
 * change the searchable text (price, stock, availability), you can patch the
 * payload WITHOUT re-embedding. Only new or text-changed (e.g. renamed) products
 * need a vector. These helpers are pure (no model) except where embedding is
 * unavoidable — `patchPayload` and `removeItems` work offline (e.g. from a cron),
 * `Searcher.upsert` handles the embedding of the delta.
 */

/**
 * Patch payload fields on existing items in place, WITHOUT re-embedding. Use for
 * non-text fields (price, stock, ...). Returns the number of items patched.
 * Unknown ids are skipped. No model needed — safe to run from a cron.
 */
export function patchPayload(
  index: PragmaIndex,
  patches: { id: string | number; fields: Partial<Product> }[],
): number {
  const byId = new Map(index.items.map((it) => [String(it.id), it]));
  let patched = 0;
  for (const { id, fields } of patches) {
    const it = byId.get(String(id));
    if (!it) continue;
    // Never let a patch rewrite `id` — that would desync payload.id from the item id
    // and every id-keyed map. Patches are for mutable fields (price/stock/…).
    if ("id" in fields) {
      const { id: _ignored, ...rest } = fields;
      Object.assign(it.payload, rest);
    } else {
      Object.assign(it.payload, fields);
    }
    patched++;
  }
  return patched;
}

/** Remove items by id, in place. Returns the number removed. */
export function removeItems(index: PragmaIndex, ids: (string | number)[]): number {
  const drop = new Set(ids.map((id) => String(id)));
  const before = index.items.length;
  index.items = index.items.filter((it) => !drop.has(String(it.id)));
  index.meta.count = index.items.length;
  return before - index.items.length;
}

/**
 * Split an upsert batch into the products that need (re)embedding (new, or whose
 * searchable text changed) vs those that only need a payload swap (text unchanged,
 * so the existing vector is reused).
 */
export function planUpsert(
  index: PragmaIndex,
  products: Product[],
): { toEmbed: Product[]; toReuse: { item: IndexItem; product: Product }[] } {
  const attrs = resolveSearchable(index.meta.searchableAttributes);
  const byId = new Map(index.items.map((it) => [String(it.id), it]));
  const toEmbed: Product[] = [];
  const toReuse: { item: IndexItem; product: Product }[] = [];
  for (const p of products) {
    const existing = byId.get(String(p.id));
    if (existing && productText(existing.payload, attrs) === productText(p, attrs)) {
      toReuse.push({ item: existing, product: p });
    } else {
      toEmbed.push(p);
    }
  }
  return { toEmbed, toReuse };
}

/** Round to 4 decimals — keeps upserted vectors consistent with `buildIndex` output. */
export function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

/**
 * Merge freshly embedded items + reused-vector items into the index (replace by id,
 * or append if new). Updates `meta.count`. Returns counts.
 */
export function applyUpsert(
  index: PragmaIndex,
  embedded: IndexItem[],
  reused: { item: IndexItem; product: Product }[],
): { added: number; updated: number } {
  for (const { item, product } of reused) item.payload = product; // keep vector, swap payload

  const pos = new Map(index.items.map((it, i) => [String(it.id), i]));
  let added = 0;
  let updated = 0;
  for (const it of embedded) {
    const i = pos.get(String(it.id));
    if (i != null) {
      index.items[i] = it;
      updated++;
    } else {
      index.items.push(it);
      pos.set(String(it.id), index.items.length - 1);
      added++;
    }
  }
  index.meta.count = index.items.length;
  return { added, updated: updated + reused.length };
}
