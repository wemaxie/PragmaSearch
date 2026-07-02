import { tokenize, type SynonymExpander, type Tokenizer } from "./hybrid.js";

/**
 * Synonyms — query-time expansion for the keyword (BM25) layer.
 *
 * Vector search already handles a lot of "same meaning, different words", but the
 * keyword layer is literal: a shop that sells "trainers" won't surface for
 * "sneakers" on the exact-match side. Synonyms bridge that. They're applied as
 * query expansion: when a query contains a synonym phrase, the sibling phrases
 * are also searched, at a reduced weight so genuine matches still rank first.
 *
 * Two kinds, mirroring Algolia:
 *  - `groups`  — multi-way equivalences: any member expands to all the others
 *                (`["laptop", "notebook"]` → querying either matches both).
 *  - `oneWay`  — directional: querying `from` also matches `to`, but not the
 *                reverse (`{ from: "iphone", to: ["apple phone"] }`).
 */
export interface SynonymOptions {
  /** Groups of equivalent phrases; any member expands to all the others. */
  groups?: string[][];
  /** One-way expansions: querying `from` also matches each of `to` (not vice versa). */
  oneWay?: { from: string; to: string[] }[];
  /** Score multiplier for synonym-derived matches, so exact terms win. Default 0.6. */
  weight?: number;
}

const DEFAULT_SYNONYM_WEIGHT = 0.6;

/** A normalized rule: if `phrase` (stemmed tokens) appears in the query, add these `expansions`. */
interface Rule {
  phrase: string[];
  expansions: string[][];
}

/** True if `needle` occurs as a contiguous run inside `hay` (both are token arrays). */
function windowMatch(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Compile a synonym config into a query expander for {@link buildKeywordIndex}'s
 * `search`. Returns `undefined` when the config yields no usable rules, so callers
 * can skip the expansion path entirely. Phrases are tokenized/stemmed the same way
 * documents are, so "laptops" and "laptop" unify.
 */
export function buildSynonyms(
  opts: SynonymOptions | undefined,
  tokenizer: Tokenizer = tokenize,
): SynonymExpander | undefined {
  if (!opts) return undefined;
  const weight = opts.weight ?? DEFAULT_SYNONYM_WEIGHT;
  const rules: Rule[] = [];

  for (const group of opts.groups ?? []) {
    const phrases = group.map((p) => tokenizer(p)).filter((a) => a.length > 0);
    for (let i = 0; i < phrases.length; i++) {
      const expansions = phrases.filter((_, j) => j !== i);
      if (expansions.length) rules.push({ phrase: phrases[i], expansions });
    }
  }
  for (const ow of opts.oneWay ?? []) {
    const phrase = tokenizer(ow.from ?? "");
    const expansions = (ow.to ?? []).map((p) => tokenizer(p)).filter((a) => a.length > 0);
    if (phrase.length && expansions.length) rules.push({ phrase, expansions });
  }

  if (rules.length === 0) return undefined;

  return (queryTokens: string[]): Array<[string, number]> => {
    // Merge weights per unique token, keeping the max (a base query term at weight 1
    // always beats the same token arriving as a 0.6 synonym).
    const weights = new Map<string, number>();
    const bump = (tok: string, w: number): void => {
      const cur = weights.get(tok);
      if (cur === undefined || w > cur) weights.set(tok, w);
    };
    for (const t of queryTokens) bump(t, 1);
    for (const rule of rules) {
      if (windowMatch(queryTokens, rule.phrase)) {
        for (const exp of rule.expansions) for (const tok of exp) bump(tok, weight);
      }
    }
    return [...weights.entries()];
  };
}
