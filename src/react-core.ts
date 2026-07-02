import type { SearchResult, FacetValue } from "./types.js";

/**
 * Framework-free core for the React adapter — URL building, the /api/search
 * fetch, and refinement helpers. Kept React-free so it's unit-testable without a
 * DOM and reusable from any framework wrapper.
 */

export type SearchMode = "hybrid" | "vector" | "keyword";

/** The inputs that map onto the `/api/search` query string. */
export interface SearchQuery {
  query: string;
  hitsPerPage?: number;
  offset?: number;
  mode?: SearchMode;
  typo?: boolean;
  facets?: string[];
  filter?: Record<string, unknown>;
  highlight?: boolean;
}

/** The JSON shape the PragmaSearch server's `/api/search` returns. */
export interface SearchApiResponse {
  query: string;
  mode: SearchMode;
  ms: number;
  count: number;
  total: number;
  offset: number;
  results: SearchResult[];
  facets?: Record<string, FacetValue[]>;
}

/** Build the `/api/search` query string from a {@link SearchQuery}. Omits defaults. */
export function buildSearchParams(input: SearchQuery): string {
  const p = new URLSearchParams();
  p.set("q", input.query ?? "");
  if (input.hitsPerPage != null) p.set("k", String(input.hitsPerPage));
  if (input.offset) p.set("offset", String(input.offset));
  if (input.mode && input.mode !== "hybrid") p.set("mode", input.mode);
  if (input.typo === false) p.set("typo", "off");
  if (input.facets?.length) p.set("facets", input.facets.join(","));
  if (input.filter && Object.keys(input.filter).length) p.set("filter", JSON.stringify(input.filter));
  if (input.highlight) p.set("highlight", "on");
  return p.toString();
}

/** Join an endpoint base with the `/api/search` path + params. `""` = same origin. */
export function searchUrl(endpoint: string, input: SearchQuery): string {
  const base = (endpoint ?? "").replace(/\/$/, "");
  return `${base}/api/search?${buildSearchParams(input)}`;
}

/** Run a search against a PragmaSearch server. Throws on a non-2xx response. */
export async function fetchSearch(
  endpoint: string,
  input: SearchQuery,
  signal?: AbortSignal,
): Promise<SearchApiResponse> {
  const res = await fetch(searchUrl(endpoint, input), { signal });
  if (!res.ok) throw new Error(`PragmaSearch: /api/search returned ${res.status}`);
  return (await res.json()) as SearchApiResponse;
}

/** Build a search filter from value refinements (field → selected values) + optional numeric ranges. */
export function buildFilter(
  refinements: Record<string, string[]>,
  ranges?: Record<string, { gte?: number; lte?: number }>,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  for (const [field, vals] of Object.entries(refinements)) {
    if (vals && vals.length) filter[field] = vals.length === 1 ? vals[0] : vals;
  }
  for (const [field, r] of Object.entries(ranges ?? {})) {
    if (r && (r.gte != null || r.lte != null)) filter[field] = r;
  }
  return filter;
}

/** Toggle a value in a field's refinement list. Pure — returns a new object. */
export function toggleRefinement(
  refinements: Record<string, string[]>,
  field: string,
  value: string,
): Record<string, string[]> {
  const cur = refinements[field] ?? [];
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  const out = { ...refinements };
  if (next.length) out[field] = next;
  else delete out[field];
  return out;
}
