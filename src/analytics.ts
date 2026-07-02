/**
 * Search analytics — a tiny, dependency-free recorder for what people search and
 * what comes back empty. The single most-requested "why is my search bad" signal
 * is the list of **zero-result queries**: those tell you exactly which synonyms,
 * ranking rules or catalog gaps to fix.
 *
 * It's an in-memory aggregate (bounded, so it can't grow without limit) that
 * serializes to plain JSON via {@link Analytics.toJSON}, so a server can persist
 * it to a file and reload it. Pure and side-effect-free apart from `Date.now()`
 * as the default timestamp (pass `ts` for deterministic use/tests).
 *
 * Privacy: it stores raw query text. That's the operator's own data on their own
 * box, but expose the summary behind auth (the demo server gates `/api/analytics`).
 */

/** One recorded search. `results` is the hit count returned to the user. */
export interface SearchEvent {
  query: string;
  results: number;
  /**
   * Whether this counts as a zero-result search. Defaults to `results === 0`, but
   * callers should set it explicitly for semantic search — vector/hybrid always
   * return the nearest items, so "no strong match" (top similarity below a floor)
   * is the meaningful signal, not a literal empty result set.
   */
  zero?: boolean;
  ms?: number;
  mode?: string;
  filtered?: boolean;
  ts?: number;
}

export interface AnalyticsOptions {
  /** Max distinct normalized queries to track (memory bound). Default 5000. */
  maxQueries?: number;
  /** Max latency samples kept for percentiles (ring buffer). Default 2000. */
  maxLatencySamples?: number;
  /** Max recent events kept. Default 50. */
  recentSize?: number;
}

interface QueryStat {
  q: string;
  count: number;
  totalResults: number;
  zero: number;
  lastTs: number;
}

/** Serializable analytics state (the return of {@link Analytics.toJSON}). */
export interface AnalyticsState {
  total: number;
  empty: number;
  zero: number;
  queries: Record<string, QueryStat>;
  latency: number[];
  recent: SearchEvent[];
  capped: boolean;
}

export interface TopQuery {
  query: string;
  count: number;
  avgResults: number;
  zeroRate: number;
}

export interface ZeroResultQuery {
  query: string;
  searches: number;
  zero: number;
  lastSeen: number;
}

export interface LatencyStats {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number;
}

export interface AnalyticsSummary {
  /** Searches with a non-empty query (browse/empty queries are excluded). */
  totalSearches: number;
  /** Empty-query (browse) requests seen — not counted as searches. */
  emptySearches: number;
  zeroResultSearches: number;
  /** zeroResultSearches / totalSearches, 0..1. */
  zeroResultRate: number;
  distinctQueries: number;
  /** True once the distinct-query cap was hit and some queries were dropped from the breakdown. */
  capped: boolean;
  topQueries: TopQuery[];
  /** Queries that returned nothing at least once — most-frequent first. The actionable list. */
  zeroResultQueries: ZeroResultQuery[];
  latency: LatencyStats;
}

export interface Analytics {
  /** Record one search. Empty/whitespace queries count as "browse", not zero-result. */
  record(event: SearchEvent): void;
  /** Aggregate view; `topN` bounds both lists (default 20). */
  summary(opts?: { topN?: number }): AnalyticsSummary;
  /** Clear all recorded data. */
  reset(): void;
  /** Serializable snapshot (persist this to a file). */
  toJSON(): AnalyticsState;
  /** Number of distinct queries currently tracked. */
  size(): number;
}

/** Normalize a query for grouping: trim, lowercase, collapse whitespace, cap length. */
export function normalizeQuery(q: string): string {
  return (q ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

function round(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

/** Nearest-rank percentile over an ascending-sorted array. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

function freshState(): AnalyticsState {
  return { total: 0, empty: 0, zero: 0, queries: {}, latency: [], recent: [], capped: false };
}

/**
 * Create an analytics recorder, optionally seeded from a previously serialized
 * state (e.g. loaded from disk).
 */
export function createAnalytics(opts: AnalyticsOptions = {}, initial?: AnalyticsState): Analytics {
  const maxQueries = opts.maxQueries ?? 5000;
  const maxLatency = opts.maxLatencySamples ?? 2000;
  const recentSize = opts.recentSize ?? 50;

  let state: AnalyticsState = initial
    ? { ...freshState(), ...initial, queries: { ...initial.queries }, latency: [...(initial.latency ?? [])], recent: [...(initial.recent ?? [])] }
    : freshState();

  function record(event: SearchEvent): void {
    const ts = event.ts ?? Date.now();
    const results = Number.isFinite(event.results) ? event.results : 0;
    const q = normalizeQuery(event.query);

    if (event.ms != null && Number.isFinite(event.ms)) {
      state.latency.push(event.ms);
      if (state.latency.length > maxLatency) state.latency.shift();
    }
    state.recent.push({ query: q, results, ms: event.ms, mode: event.mode, filtered: event.filtered, ts });
    if (state.recent.length > recentSize) state.recent.shift();

    if (q === "") {
      state.empty++;
      return; // browse / empty query is not a "search" and never a zero-result
    }

    state.total++;
    const zeroHit = event.zero ?? results === 0;
    if (zeroHit) state.zero++;

    let st = state.queries[q];
    if (!st) {
      if (Object.keys(state.queries).length >= maxQueries) {
        state.capped = true; // aggregate totals stay correct; just no per-query row for this one
        return;
      }
      st = { q, count: 0, totalResults: 0, zero: 0, lastTs: 0 };
      state.queries[q] = st;
    }
    st.count++;
    st.totalResults += results;
    if (zeroHit) st.zero++;
    st.lastTs = ts;
  }

  function summary(o: { topN?: number } = {}): AnalyticsSummary {
    const topN = o.topN ?? 20;
    const qs = Object.values(state.queries);

    const topQueries: TopQuery[] = qs
      .slice()
      .sort((a, b) => b.count - a.count || a.q.localeCompare(b.q))
      .slice(0, topN)
      .map((s) => ({
        query: s.q,
        count: s.count,
        avgResults: round(s.totalResults / s.count, 1),
        zeroRate: round(s.zero / s.count, 2),
      }));

    const zeroResultQueries: ZeroResultQuery[] = qs
      .filter((s) => s.zero > 0)
      .sort((a, b) => b.zero - a.zero || b.count - a.count || a.q.localeCompare(b.q))
      .slice(0, topN)
      .map((s) => ({ query: s.q, searches: s.count, zero: s.zero, lastSeen: s.lastTs }));

    const sorted = state.latency.slice().sort((a, b) => a - b);
    const avg = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
    const latency: LatencyStats = {
      avg: round(avg, 1),
      p50: round(percentile(sorted, 50), 1),
      p95: round(percentile(sorted, 95), 1),
      p99: round(percentile(sorted, 99), 1),
      samples: sorted.length,
    };

    return {
      totalSearches: state.total,
      emptySearches: state.empty,
      zeroResultSearches: state.zero,
      zeroResultRate: round(state.total ? state.zero / state.total : 0, 3),
      distinctQueries: qs.length,
      capped: state.capped,
      topQueries,
      zeroResultQueries,
      latency,
    };
  }

  return {
    record,
    summary,
    reset() {
      state = freshState();
    },
    toJSON() {
      return state;
    },
    size() {
      return Object.keys(state.queries).length;
    },
  };
}
