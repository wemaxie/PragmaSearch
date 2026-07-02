import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchSearch,
  buildFilter,
  toggleRefinement as toggleRef,
  type SearchQuery,
  type SearchApiResponse,
  type SearchMode,
} from "./react-core.js";
import type { SearchResult, FacetValue } from "./types.js";

/**
 * React adapter for PragmaSearch — a headless `usePragmaSearch` hook plus thin,
 * composable components (`<PragmaSearch>`, `<SearchBox>`, `<Hits>`,
 * `<RefinementList>`, `<Pagination>`). Components emit the same `.ps-*` classes
 * as the vanilla widget, so `pragmasearch/widget/pragmasearch-widget.css` themes
 * both. Talks to the `/api/search` contract of a running PragmaSearch server.
 */

export type { SearchQuery, SearchApiResponse, SearchMode } from "./react-core.js";
export { buildSearchParams, searchUrl, fetchSearch } from "./react-core.js";

export interface UsePragmaSearchOptions {
  /** PragmaSearch server base URL. `""` (default) = same origin. */
  endpoint?: string;
  initialQuery?: string;
  hitsPerPage?: number;
  mode?: SearchMode;
  typo?: boolean;
  /** Facet fields to request (for `<RefinementList>`). */
  facets?: string[];
  /** Request `<mark>`-highlighted fields (default true). */
  highlight?: boolean;
  /** Debounce for query/refinement changes, ms (default 180). */
  debounceMs?: number;
}

/** Everything a search UI needs — the return of {@link usePragmaSearch}, also shared via context. */
export interface PragmaSearchState {
  query: string;
  setQuery: (q: string) => void;
  results: SearchResult[];
  total: number;
  facets: Record<string, FacetValue[]>;
  refinements: Record<string, string[]>;
  toggleRefinement: (field: string, value: string) => void;
  clearRefinements: () => void;
  isRefined: (field: string, value: string) => boolean;
  page: number;
  setPage: (p: number) => void;
  pageCount: number;
  hitsPerPage: number;
  loading: boolean;
  error: Error | null;
  ms: number;
  highlight: boolean;
}

/**
 * Headless search hook. Manages query, refinements and pagination, debounces, and
 * fetches `/api/search` (aborting stale requests). Use it directly for a custom UI,
 * or via `<PragmaSearch>` for the bundled components.
 */
export function usePragmaSearch(opts: UsePragmaSearchOptions = {}): PragmaSearchState {
  const {
    endpoint = "",
    initialQuery = "",
    hitsPerPage = 12,
    mode = "hybrid",
    typo = true,
    facets,
    highlight = true,
    debounceMs = 180,
  } = opts;

  const [query, setQueryRaw] = useState(initialQuery);
  const [refinements, setRefinements] = useState<Record<string, string[]>>({});
  const [page, setPage] = useState(0);
  const [resp, setResp] = useState<SearchApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Any query/refinement change resets to the first page.
  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
    setPage(0);
  }, []);
  const toggleRefinement = useCallback((field: string, value: string) => {
    setRefinements((r) => toggleRef(r, field, value));
    setPage(0);
  }, []);
  const clearRefinements = useCallback(() => {
    setRefinements({});
    setPage(0);
  }, []);

  const filter = useMemo(() => buildFilter(refinements), [refinements]);
  // Serialize object/array inputs so the fetch effect has stable primitive deps.
  const filterKey = JSON.stringify(filter);
  const facetsKey = facets?.join(",") ?? "";

  useEffect(() => {
    const q = query.trim();
    // Browse mode: allow an empty query only when there are active refinements.
    if (!q && Object.keys(filter).length === 0) {
      setResp(null);
      setLoading(false);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const input: SearchQuery = {
      query: q,
      hitsPerPage,
      offset: page * hitsPerPage,
      mode,
      typo,
      facets,
      filter,
      highlight,
    };
    const t = setTimeout(() => {
      fetchSearch(endpoint, input, ctrl.signal)
        .then((r) => {
          setResp(r);
          setError(null);
        })
        .catch((e: unknown) => {
          if ((e as Error).name === "AbortError") return;
          setError(e as Error);
          setResp(null);
        })
        .finally(() => {
          // Only the request that actually completed clears `loading`; an aborted
          // request leaves it true so a superseding request keeps the spinner on.
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, debounceMs);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // filter/facets are tracked via filterKey/facetsKey (stable primitives).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, query, filterKey, facetsKey, page, hitsPerPage, mode, typo, highlight, debounceMs]);

  const total = resp?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / hitsPerPage));

  return {
    query,
    setQuery,
    results: resp?.results ?? [],
    total,
    facets: resp?.facets ?? {},
    refinements,
    toggleRefinement,
    clearRefinements,
    isRefined: (f, v) => (refinements[f] ?? []).includes(v),
    page,
    setPage,
    pageCount,
    hitsPerPage,
    loading,
    error,
    ms: resp?.ms ?? 0,
    highlight,
  };
}

const Ctx = createContext<PragmaSearchState | null>(null);

function useCtx(): PragmaSearchState {
  const c = useContext(Ctx);
  if (!c) throw new Error("PragmaSearch: <SearchBox>/<Hits>/… must be rendered inside <PragmaSearch>.");
  return c;
}

/** Access the shared search state from a descendant of `<PragmaSearch>`. */
export function usePragmaSearchContext(): PragmaSearchState {
  return useCtx();
}

export interface PragmaSearchProps extends UsePragmaSearchOptions {
  children: ReactNode;
  className?: string;
}

/** Provider + `.ps-root` wrapper. Owns the search state and shares it via context. */
export function PragmaSearch({ children, className, ...opts }: PragmaSearchProps) {
  const state = usePragmaSearch(opts);
  return (
    <div className={["ps-root", className].filter(Boolean).join(" ")}>
      <Ctx.Provider value={state}>{children}</Ctx.Provider>
    </div>
  );
}

export function SearchBox({
  placeholder = "Search…",
  autoFocus,
}: {
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { query, setQuery } = useCtx();
  return (
    <div className="ps-searchbar">
      <svg
        className="ps-icon"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        className="ps-input"
        type="text"
        value={query}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        aria-label="Search"
        onChange={(e) => setQuery(e.target.value)}
      />
    </div>
  );
}

function DefaultHit({ hit }: { hit: SearchResult }) {
  const p = hit.product as Record<string, unknown>;
  const titleHtml = hit.highlights?.title;
  return (
    <div className="ps-body">
      <div className="ps-title">
        {titleHtml ? (
          // Server output is HTML-escaped then <mark>-wrapped, so this is safe.
          <span dangerouslySetInnerHTML={{ __html: titleHtml }} />
        ) : (
          String(p.title ?? "")
        )}
      </div>
      <div className="ps-meta">
        {p.category != null ? <span className="ps-cat">{String(p.category)}</span> : null}
        {p.price != null ? <span className="ps-price">{String(p.price)}</span> : null}
      </div>
    </div>
  );
}

export function Hits({
  renderHit,
  emptyText = "No results.",
}: {
  renderHit?: (hit: SearchResult) => ReactNode;
  emptyText?: ReactNode;
}) {
  const { results, loading, query, total } = useCtx();
  if (!results.length) {
    return <div className="ps-empty">{loading || !query ? "" : total === 0 ? emptyText : ""}</div>;
  }
  return (
    <div className="ps-hits">
      {results.map((h) => (
        <div className="ps-hit" key={String(h.id)}>
          {renderHit ? renderHit(h) : <DefaultHit hit={h} />}
        </div>
      ))}
    </div>
  );
}

export function RefinementList({
  attribute,
  title,
}: {
  attribute: string;
  title?: ReactNode;
}) {
  const { facets, isRefined, toggleRefinement } = useCtx();
  const values = facets[attribute] ?? [];
  if (!values.length) return null;
  return (
    <div className="ps-fgroup">
      <h4>{title ?? attribute}</h4>
      {values.map((f) => (
        <label className="ps-fitem" key={f.value}>
          <input
            type="checkbox"
            checked={isRefined(attribute, f.value)}
            onChange={() => toggleRefinement(attribute, f.value)}
          />
          <span>{f.value}</span>
          <span className="ps-fc">{f.count}</span>
        </label>
      ))}
    </div>
  );
}

export function ClearRefinements({ children = "Clear filters" }: { children?: ReactNode }) {
  const { refinements, clearRefinements } = useCtx();
  if (!Object.keys(refinements).length) return null;
  return (
    <button className="ps-clear" type="button" onClick={clearRefinements}>
      {children}
    </button>
  );
}

export function Pagination() {
  const { page, setPage, pageCount, total, hitsPerPage } = useCtx();
  if (total <= hitsPerPage) return null;
  const from = page * hitsPerPage + 1;
  const to = Math.min(total, (page + 1) * hitsPerPage);
  return (
    <div className="ps-pager">
      <button className="ps-prev" type="button" disabled={page <= 0} onClick={() => setPage(Math.max(0, page - 1))}>
        ← Prev
      </button>
      <span className="ps-info">
        {from}–{to} of {total}
      </span>
      <button
        className="ps-next"
        type="button"
        disabled={page >= pageCount - 1}
        onClick={() => setPage(page + 1)}
      >
        Next →
      </button>
    </div>
  );
}

export function PoweredBy() {
  return (
    <div className="ps-poweredby">
      powered by{" "}
      <a href="https://github.com/wemaxie/PragmaSearch" target="_blank" rel="noopener noreferrer">
        PragmaSearch
      </a>
    </div>
  );
}
