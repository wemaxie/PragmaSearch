import { tokenize, type Tokenizer } from "./hybrid.js";
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
  /**
   * Return a ~N-word windowed excerpt around the first match (with `…` ellipsis)
   * instead of the whole field — Algolia's `_snippetResult`. Great for long
   * descriptions. Fields shorter than N words are returned in full.
   */
  snippet?: number;
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
  tok: Tokenizer = tokenize,
): string {
  return escapeHtml(text).replace(/[\p{L}\p{N}]+/gu, (word) => {
    const stem = tok(word)[0];
    return stem && queryStems.has(stem) ? pre + word + post : word;
  });
}

/**
 * Highlight a ~`words`-word window around the first match (with `…` ellipsis) —
 * a snippet for long text. Falls back to full highlighting when the text is short.
 */
export function snippetField(
  text: string,
  queryStems: Set<string>,
  words = 20,
  pre = "<mark>",
  post = "</mark>",
  tok: Tokenizer = tokenize,
): string {
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length <= words) return highlightField(text, queryStems, pre, post, tok);
  let matchIdx = parts.findIndex((w) => {
    const s = tok(w)[0];
    return s !== undefined && queryStems.has(s);
  });
  if (matchIdx < 0) matchIdx = 0; // no match in this field → show a lead-in
  const start = Math.max(0, Math.min(matchIdx - Math.floor(words / 2), parts.length - words));
  const end = Math.min(parts.length, start + words);
  const slice = parts.slice(start, end).join(" ");
  const lead = start > 0 ? "… " : "";
  const tail = end < parts.length ? " …" : "";
  return lead + highlightField(slice, queryStems, pre, post, tok) + tail;
}

/** Build a `{ field: highlightedHtml }` map for a product over the requested fields. */
export function highlightProduct(
  product: Product,
  query: string,
  opts: HighlightOptions = {},
  tok: Tokenizer = tokenize,
): Record<string, string> {
  const out: Record<string, string> = {};
  const queryStems = new Set(tok(query));
  if (!queryStems.size) return out;
  const fields = opts.fields ?? ["title", "description"];
  const pre = opts.pre ?? "<mark>";
  const post = opts.post ?? "</mark>";
  for (const field of fields) {
    const v = product[field];
    if (typeof v === "string" && v) {
      out[field] = opts.snippet
        ? snippetField(v, queryStems, opts.snippet, pre, post, tok)
        : highlightField(v, queryStems, pre, post, tok);
    }
  }
  return out;
}
