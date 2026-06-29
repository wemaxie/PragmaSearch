import { tokenize } from "./hybrid.js";
import type { Product } from "./types.js";

/**
 * Result highlighting — wrap the query-matching words in a field's text, à la
 * Algolia's `_highlightResult`. The text is HTML-escaped first and only the
 * highlight tags are raw, so the returned value is safe to render as HTML.
 */

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

export interface HighlightOptions {
  /** Payload fields to highlight. Default ["title", "description"]. */
  fields?: string[];
  /** Opening tag. Default "<mark>". */
  pre?: string;
  /** Closing tag. Default "</mark>". */
  post?: string;
}

/**
 * Highlight words in `text` whose stem matches one of the query stems. Matching
 * uses the same tokenizer/stemmer as search, so "headphones" highlights for a
 * query of "headphone". Returns HTML-safe markup.
 */
export function highlightField(
  text: string,
  queryStems: Set<string>,
  pre = "<mark>",
  post = "</mark>",
): string {
  return escapeHtml(text).replace(/[\p{L}\p{N}]+/gu, (word) => {
    const stem = tokenize(word)[0];
    return stem && queryStems.has(stem) ? pre + word + post : word;
  });
}

/** Build a `{ field: highlightedHtml }` map for a product over the requested fields. */
export function highlightProduct(
  product: Product,
  query: string,
  opts: HighlightOptions = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  const queryStems = new Set(tokenize(query));
  if (!queryStems.size) return out;
  const fields = opts.fields ?? ["title", "description"];
  const pre = opts.pre ?? "<mark>";
  const post = opts.post ?? "</mark>";
  for (const field of fields) {
    const v = product[field];
    if (typeof v === "string" && v) out[field] = highlightField(v, queryStems, pre, post);
  }
  return out;
}
