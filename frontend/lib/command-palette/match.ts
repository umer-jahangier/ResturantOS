/**
 * The command palette's matcher — prefix and word-boundary, and nothing else (UI-SPEC §10).
 *
 * <h3>The defect this file exists to delete</h3>
 *
 * The palette used `cmdk`'s built-in filter, which is `command-score`: a SUBSEQUENCE matcher. It
 * scores a candidate when the query's letters appear in order anywhere inside it, however far
 * apart. That is why the audit's headline measurement is what it is — typing `ord` returned
 * exactly one result, **Dashboard**, because d-a-s-h-b-**o**-a-**r**-**d** contains o, r and d in
 * that order. An order search returned a dashboard, and the one thing the palette is FOR — finding
 * a check by its number — was the one thing it could not do.
 *
 * Subsequence matching is not a tuning problem. In a product whose nouns are `ORD-20260811-0017`,
 * `Ingredients`, `Journal Entries` and `Purchase Orders`, almost every three-letter query is a
 * subsequence of almost every label, so the ranking is noise and the top hit is arbitrary. Two
 * rules replace it:
 *
 *   · **Prefix** — the whole field starts with the term. `ord` → `Orders`, `ORD-2026…`.
 *   · **Word boundary** — some word inside the field starts with the term. `ledger` →
 *     `General Ledger`; `0017` → `ORD-20260811-0017`.
 *
 * `Dashboard` is one word, and neither the field nor that word starts with `ord`, so it scores
 * zero. That case is asserted by name in the unit test because it is today's live defect.
 *
 * <h3>Why the scores are 3 and 2 and there is no third rule</h3>
 *
 * 38-11's "Out of scope" is explicit: *fuzzy ranking beyond prefix and word-boundary*. A wider
 * rule (acronyms, transpositions, edit distance) buys recall the product does not need and costs
 * the property that makes a keyboard navigator usable — that the same three keystrokes always
 * produce the same first row. Synonyms are handled as DATA instead: a command carries explicit
 * `keywords` (`gl` on General Ledger, `kds` on Kitchen Display), which is a list a reader can
 * audit rather than a heuristic they have to trust.
 *
 * Every term of a multi-word query must match — `purchase ord` finds `Purchase Orders` and not
 * every order. This is deliberately an AND: an OR turns the second word into a widener, which is
 * the opposite of what typing more is meant to do.
 */

/** Split on anything that is not a letter or a digit, so `ORD-2026-0017` yields three words. */
const NOT_WORD_CHARACTER = /[^\p{L}\p{N}]+/u;

/** The whole field starts with the term. The strongest signal a prefix matcher has. */
export const SCORE_PREFIX = 3;

/** Some word inside the field starts with the term. */
export const SCORE_WORD_PREFIX = 2;

export function words(text: string): string[] {
  return text.split(NOT_WORD_CHARACTER).filter((word) => word.length > 0);
}

/**
 * How well one already-lowercased term matches the best of `fields`.
 *
 * Returns `0` for "no match at all", which callers treat as a hard reject rather than a low
 * ranking — there is no threshold to tune and no long tail of near-misses.
 */
export function termScore(fields: readonly string[], term: string): number {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return 0;

  let best = 0;
  for (const field of fields) {
    const haystack = field.toLowerCase();
    if (haystack.length === 0) continue;
    if (haystack.startsWith(needle)) return SCORE_PREFIX;
    if (best < SCORE_WORD_PREFIX && words(haystack).some((word) => word.startsWith(needle))) {
      best = SCORE_WORD_PREFIX;
    }
  }
  return best;
}

/**
 * The score of a whole query against one candidate's searchable fields.
 *
 * `0` means "does not match" — every term must find a home, and a query of only whitespace
 * matches nothing rather than everything (an empty query is handled by the caller, which shows
 * recents and the full permitted list instead of running a search).
 */
export function matchScore(fields: readonly string[], query: string): number {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return 0;

  let total = 0;
  for (const term of terms) {
    const score = termScore(fields, term);
    if (score === 0) return 0;
    total += score;
  }
  return total;
}
