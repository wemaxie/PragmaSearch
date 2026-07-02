import type { IndexItem, ResolvedAttribute } from "./types.js";
import { DEFAULT_SEARCHABLE, fieldText } from "./searchable.js";

/**
 * Self-contained keyword (BM25) layer for hybrid search — zero dependencies,
 * pure JS, runs in Node and the browser. This is the "exact words" half that
 * vector search fumbles (SKUs, brand names, model numbers). We fuse its ranking
 * with the vector ranking via RRF.
 *
 * Why hand-rolled instead of a search library: PragmaSearch's whole pitch is
 * local-first / own-your-stack / minimal, and product titles are short, so a
 * compact BM25 over an in-memory inverted index is more than enough.
 */

// A small, conservative stopword list. We keep meaning-bearing words like
// "home", "work", "office" — only drop true glue words.
const STOPWORDS = new Set([
  "a", "an", "the", "of", "for", "and", "or", "to", "in", "on", "at", "with",
  "by", "is", "are", "be", "it", "this", "that", "as", "from", "your", "you",
  "i", "my", "me", "some", "any", "something", "anything", "want", "need",
]);

/** Light stemmer: normalize common English plurals so "headphones" matches "headphone". */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y"; // batteries -> battery
  // Strip a plural 's', but skip common singular endings so we don't mangle
  // analysis/bias/status/focus/atlas/wireless into nonsense.
  if (t.length > 3 && t.endsWith("s") && !/(ss|us|is|os|as)$/.test(t)) {
    return t.slice(0, -1); // cards -> card, machines -> machine
  }
  return t;
}

/** Tokenize: lowercase, split on non-alphanumeric, drop stopwords, stem. Digits kept (e.g. "4070"). */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

const K1 = 1.5;
const B = 0.75;

/**
 * Typo tolerance config. When a query word isn't found exactly, we match
 * indexed words within an edit distance that scales with word length (the same
 * shape Algolia uses), and down-weight those fuzzy matches so exact hits win.
 */
export interface TypoOptions {
  /** Master switch. Default true. */
  enabled?: boolean;
  /** Words with length >= this may absorb 1 typo. Default 4. */
  minLength?: number;
  /** Words with length >= this may absorb 2 typos. Default 8. */
  secondTypoLength?: number;
  /** Score multiplier per edit-distance unit for a fuzzy match (penalty^distance). Default 0.5. */
  penalty?: number;
}

export const DEFAULT_TYPO: Required<TypoOptions> = {
  enabled: true,
  minLength: 4,
  secondTypoLength: 8,
  penalty: 0.5,
};

/** Normalize the loose `typo` option into a full config. */
export function resolveTypo(t: boolean | TypoOptions | undefined): Required<TypoOptions> {
  if (t === false) return { ...DEFAULT_TYPO, enabled: false };
  if (t === true || t == null) return { ...DEFAULT_TYPO };
  return { ...DEFAULT_TYPO, ...t };
}

/** How many typos a word of this length may absorb under the given policy. */
function maxTyposFor(term: string, o: Required<TypoOptions>): number {
  if (!o.enabled) return 0;
  if (term.length >= o.secondTypoLength) return 2;
  if (term.length >= o.minLength) return 1;
  return 0;
}

/** Levenshtein distance with an early-exit ceiling (returns max+1 once exceeded). */
function boundedLevenshtein(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[lb];
}

export interface KeywordHit {
  id: string;
  score: number;
}

/**
 * Expands a tokenized query into weighted search terms (base terms at weight 1,
 * synonym-derived terms lower). Produced by `buildSynonyms`; see ./synonyms.
 */
export type SynonymExpander = (queryTokens: string[]) => Array<[string, number]>;

export interface KeywordIndex {
  /**
   * Return product ids (with BM25 scores) ranked best-first. Typo tolerance is on
   * by default. Pass a `synonyms` expander to also match query-equivalent terms.
   */
  search(
    query: string,
    limit: number,
    typo?: boolean | TypoOptions,
    synonyms?: SynonymExpander,
  ): KeywordHit[];
}

/**
 * Build an in-memory BM25 index from indexed items. Each searchable attribute's
 * text is tokenized and added with its weight (a weight-2 field counts terms
 * double). Defaults to the standard title^2 / description / category / tags.
 */
export function buildKeywordIndex(
  items: IndexItem[],
  attrs: ResolvedAttribute[] = DEFAULT_SEARCHABLE,
): KeywordIndex {
  // postings: term -> (docId -> weighted term frequency)
  const postings = new Map<string, Map<string, number>>();
  const docLen = new Map<string, number>();
  let totalLen = 0;

  const addTokens = (docId: string, tokens: string[], weight: number) => {
    for (const term of tokens) {
      let docMap = postings.get(term);
      if (!docMap) postings.set(term, (docMap = new Map()));
      docMap.set(docId, (docMap.get(docId) ?? 0) + weight);
      docLen.set(docId, (docLen.get(docId) ?? 0) + weight);
      totalLen += weight;
    }
  };

  for (const it of items) {
    const id = String(it.id);
    for (const { field, weight } of attrs) {
      addTokens(id, tokenize(fieldText(it.payload, field)), weight);
    }
  }

  const N = docLen.size;
  const avgdl = N > 0 ? totalLen / N : 0;
  const vocab = [...postings.keys()];

  const idf = (term: string): number => {
    const df = postings.get(term)?.size ?? 0;
    if (df === 0) return 0;
    return Math.log(1 + (N - df + 0.5) / (df + 0.5));
  };

  /**
   * Map a query term to indexed terms with weights. An exact hit wins (weight 1);
   * if the term isn't in the vocabulary (likely a typo) we find indexed terms
   * within the allowed edit distance and weight them by penalty^distance.
   */
  function expandTerm(term: string, typo: Required<TypoOptions>): Array<[string, number]> {
    if (postings.has(term)) return [[term, 1]];
    const max = maxTyposFor(term, typo);
    if (max === 0) return [];
    const out: Array<[string, number]> = [];
    for (const cand of vocab) {
      if (Math.abs(cand.length - term.length) > max) continue;
      const d = boundedLevenshtein(term, cand, max);
      if (d <= max) out.push([cand, Math.pow(typo.penalty, d)]);
    }
    return out;
  }

  function search(
    query: string,
    limit: number,
    typoOpt?: boolean | TypoOptions,
    synonyms?: SynonymExpander,
  ): KeywordHit[] {
    const typo = resolveTypo(typoOpt);
    const terms = tokenize(query);
    if (terms.length === 0 || N === 0) return [];
    // Synonym expansion widens the query to equivalent terms (base terms at weight
    // 1, synonyms lower). Without it, each occurrence is searched at weight 1.
    const weightedTerms: Array<[string, number]> = synonyms
      ? synonyms(terms)
      : terms.map((t) => [t, 1]);
    const scores = new Map<string, number>();
    for (const [term, termWeight] of weightedTerms) {
      for (const [matchTerm, typoWeight] of expandTerm(term, typo)) {
        const docMap = postings.get(matchTerm);
        if (!docMap) continue;
        const termIdf = idf(matchTerm);
        for (const [docId, tf] of docMap) {
          const dl = docLen.get(docId) ?? 0;
          const denom = tf + K1 * (1 - B + (B * dl) / (avgdl || 1));
          const contribution = termIdf * ((tf * (K1 + 1)) / denom) * typoWeight * termWeight;
          scores.set(docId, (scores.get(docId) ?? 0) + contribution);
        }
      }
    }
    return [...scores.entries()]
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => ({ id, score }));
  }

  return { search };
}

/**
 * Reciprocal Rank Fusion. Combines several ranked id lists into one score map.
 * Rank-based, so it sidesteps the incompatible scales of cosine vs BM25 — no
 * normalization or weight tuning required. `k` damps the influence of low ranks.
 */
export function rrfFuse(rankings: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, idx) => {
      const rank = idx + 1;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    });
  }
  return scores;
}

/** Normalize text for substring matching: lowercase, collapse whitespace. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Exact-match boost. When the user's query appears verbatim in a product's
 * primary field (e.g. "RTX 4070", a brand, a SKU in the title), we bump it so
 * literal lookups win even when neither semantic nor BM25 ranks it first.
 * `field` defaults to "title" — pass the highest-weight searchable field.
 * Returns ids to boost.
 */
export function exactTitleMatches(
  query: string,
  items: IndexItem[],
  field = "title",
): Set<string> {
  const q = norm(query);
  const hits = new Set<string>();
  if (q.length < 2) return hits;
  for (const it of items) {
    const v = fieldText(it.payload, field);
    if (v && norm(v).includes(q)) hits.add(String(it.id));
  }
  return hits;
}
