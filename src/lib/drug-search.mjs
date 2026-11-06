/**
 * Drug-name search that forgives typing.
 *
 * What was wrong with the old search
 * ----------------------------------
 * `searchMedicines()` matched only exact prefixes and substrings, so
 * "Augmentn", "pantocid", "azithral 500mg " or "amoxycillin" found nothing —
 * and a doctor writing twelve prescriptions before lunch stops using a field
 * that says "no match" for the drug in front of them.
 *
 * How this file fixes it, without a server
 * ----------------------------------------
 * Three layers, cheapest first. All of them run in the browser, so the drug
 * field behaves the same on a clinic laptop with no internet:
 *
 *   1. exact / prefix / word-start tiers — what a fast typist expects
 *   2. trigram similarity (the same idea as Postgres' pg_trgm, Dice
 *      coefficient over padded 3-grams) — catches one wrong letter, a missing
 *      letter, or letters swapped
 *   3. a multi-word rule: every token in the query must land somewhere in
 *      brand + composition + keywords ("pantoprazole 40")
 *
 * Ranking is deterministic: the tiers above are weights, ties break on
 * alphabetical brand so the same query always offers the same order. There is
 * no randomness and no "learning" — a doctor must be able to predict the list.
 *
 * The directory (schema 14) uses the *same* ranking idea in SQL, so a result
 * that arrives from Postgres slots into the same list without re-sorting.
 */

/** A one-letter query matches half the alphabet; two is the shortest useful search. */
export const MIN_QUERY_LENGTH = 2;

/** Nobody reads further than this in a dropdown while a patient is waiting. */
export const MAX_RESULTS = 8;

/** Below this Dice similarity the match is a coincidence, not a typo. */
export const FUZZY_FLOOR = 0.34;

/** Shorter than this, a "typo" is just a shorter word: three letters minimum. */
export const FUZZY_MIN_LENGTH = 3;

/**
 * Weight table. Kept as named constants so the ordering can be argued about
 * and tested rather than buried in an if-chain.
 */
export const TIERS = {
  brandExact: 1000,
  brandPrefix: 900,
  brandWordStart: 860,
  saltExact: 830,
  saltPrefix: 800,
  saltWordStart: 740,
  brandContains: 700,
  saltContains: 660,
  strengthMatch: 560,
  keywordStart: 520,
  keywordContains: 460,
  /** Fuzzy band: floor + similarity × spread, i.e. 300…560. */
  fuzzyFloor: 300,
  fuzzySpread: 260,
  /** Applied to the weakest token of a multi-word query, then a small bonus. */
  allTokensBonus: 30,
  /** A medicine this clinic has actually prescribed recently. */
  historyBonus: 40,
  directoryPenalty: 10,
};

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normaliseDrugText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Strongths are written "500 mg", "500mg", "0.5 mg/2 ml", "100 mcg" — the query
 * may or may not carry a space. Fold digit+unit pairs so "dolo 650mg" and
 * "dolo 650 mg" are the same query.
 */
export function foldDoseUnits(text) {
  return normaliseDrugText(text).replace(/(\d)\s+(mg|mcg|ml|gm|g|iu|%)\b/g, '$1$2');
}

/** Padded 3-grams of a string, as pg_trgm does it ("do" → "  d", " do", "do "). */
export function trigrams(text) {
  const plain = normaliseDrugText(text);
  const out = new Set();
  if (!plain) return out;
  const padded = `  ${plain} `;
  for (let i = 0; i < padded.length - 2; i += 1) out.add(padded.slice(i, i + 3));
  return out;
}

/** Dice coefficient over two trigram sets, 0…1 — the same maths as similarity(). */
export function similarity(a, b) {
  const left = typeof a === 'string' ? trigrams(a) : a;
  const right = typeof b === 'string' ? trigrams(b) : b;
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

/**
 * Per-field grams are computed once per catalogue, not once per keystroke.
 * A WeakMap keyed by the array means a re-render costs nothing and a replaced
 * catalogue (import, test fixture) is collected with it.
 */
const gramCache = new WeakMap();

function gramsFor(med) {
  return {
    brand: trigrams(med.brand ?? ''),
    words: words(med.brand ?? '').filter((w) => w.length >= 3).map((w) => trigrams(w)),
    salt: trigrams(med.salt ?? ''),
    keywords: trigrams(`${med.brand ?? ''} ${med.salt ?? ''} ${med.strength ?? ''} ${med.keywords ?? ''}`),
  };
}

function cacheFor(list) {
  let cache = gramCache.get(list);
  if (!cache) {
    cache = new Map();
    gramCache.set(list, cache);
  }
  return cache;
}

function gramsOf(list, med) {
  const cache = cacheFor(list);
  const key = med.id ?? `${med.brand}|${med.salt}`;
  let grams = cache.get(key);
  if (!grams) {
    grams = gramsFor(med);
    cache.set(key, grams);
  }
  return grams;
}

const words = (text) => normaliseDrugText(text).split(' ').filter(Boolean);

/** Does `token` start a word inside `haystack`? ("advance" in "crocin advance") */
function startsWord(haystack, token) {
  return words(haystack).some((word) => word.startsWith(token));
}

/**
 * Score one token against one medicine. This is the whole ranking, in order of
 * how much a doctor meant it.
 */
export function tokenScore(token, med, grams) {
  const needle = foldDoseUnits(token);
  if (!needle) return 0;
  const brand = foldDoseUnits(med.brand ?? '');
  const salt = foldDoseUnits(med.salt ?? '');

  if (brand === needle) return TIERS.brandExact;
  if (brand.startsWith(needle)) {
    // "pan" → "Pan 40" beats "pan" → a much longer brand starting the same way.
    return TIERS.brandPrefix - Math.min(60, brand.length - needle.length);
  }
  if (startsWord(med.brand ?? '', token)) return TIERS.brandWordStart;
  if (salt === needle) return TIERS.saltExact;
  if (salt.startsWith(needle)) return TIERS.saltPrefix;
  if (startsWord(med.salt ?? '', token)) return TIERS.saltWordStart;
  if (brand.includes(needle)) return TIERS.brandContains;
  if (salt.includes(needle)) return TIERS.saltContains;
  // "azithral 500", "pan 40" — the strength is part of how a clinic says a drug.
  if (foldDoseUnits(med.strength ?? '').includes(needle)) return TIERS.strengthMatch;
  if (words(`${med.strength ?? ''} ${med.keywords ?? ''}`).some((word) => word.startsWith(needle))) return TIERS.keywordStart;
  if (String(med.keywords ?? '').includes(needle)) return TIERS.keywordContains;

  // --- typo territory -----------------------------------------------------
  // Two letters cannot be a typo of anything: fuzzing them returns half the
  // alphabet. Same for brand fragments like the "P" in "Zerodol-P".
  if (needle.length < FUZZY_MIN_LENGTH) return 0;
  // Compare against each word of the brand as well as the whole of it. A
  // directory of 242,000 brands contains "Augmentox", and a doctor typing
  // "augmentn" means "Augmentin 625" — whole-string similarity alone gives the
  // shorter wrong brand the higher score, because the fewer characters it has,
  // the less its extra characters cost.
  const needleGrams = tokenGrams(token);
  const brandWordList = words(med.brand ?? '').filter((w) => w.length >= FUZZY_MIN_LENGTH);
  const brandSim = similarity(grams?.brand ?? trigrams(med.brand ?? ''), needleGrams);
  const wordSims = grams?.words ?? brandWordList.map((w) => trigrams(w));
  let wordSim = 0;
  let closest = Number.POSITIVE_INFINITY;
  wordSims.forEach((set, i) => {
    wordSim = Math.max(wordSim, similarity(set, needleGrams));
    closest = Math.min(closest, editDistance(needle, brandWordList[i] ?? '', 2));
  });
  const saltSim = similarity(grams?.salt ?? trigrams(med.salt ?? ''), needleGrams);

  // One keystroke away is a typo; two is a guess; three is another drug.
  const keystrokes = closest === 1 ? 0.15 : closest === 2 ? 0.06 : 0;
  const best = Math.min(0.99, Math.max(brandSim, wordSim, saltSim * 0.92) + keystrokes);
  if (best < FUZZY_FLOOR) return 0;
  return Math.round(TIERS.fuzzyFloor + best * TIERS.fuzzySpread);
}

const tokenGramCache = new Map();
function tokenGrams(token) {
  const needle = foldDoseUnits(token);
  let grams = tokenGramCache.get(needle);
  if (!grams) {
    grams = trigrams(needle);
    if (tokenGramCache.size > 500) tokenGramCache.clear();
    tokenGramCache.set(needle, grams);
  }
  return grams;
}

/**
 * Score a whole query. A multi-word query only counts when *every* word is
 * accounted for, and then it is only as strong as its weakest word — that is
 * what stops "dolo 650" from matching "Dolo 650" and "Calpol 650" equally.
 */
export function scoreMedicine(med, query, list = null) {
  const q = foldDoseUnits(query);
  if (!q) return 0;
  const grams = list ? gramsOf(list, med) : gramsFor(med);

  const tokens = q.split(' ').filter(Boolean);
  const whole = tokenScore(q, med, grams);
  if (tokens.length < 2) return whole;

  const perToken = tokens.map((token) => tokenScore(token, med, grams));
  if (perToken.some((score) => score <= 0)) return Math.max(0, whole);
  const weakest = Math.min(...perToken);
  return Math.max(whole, weakest + TIERS.allTokensBonus);
}

/**
 * Levenshtein distance, capped: how many keystrokes separate two words.
 *
 * Trigram similarity cannot tell "Augmentin" from "Augmentox" for the query
 * "augmentn" — both share seven trigrams and score identically (Dice 0.737,
 * pg_trgm 0.583), which is exactly what a 242,000-row directory exposed: the
 * wrong brand won on alphabetical order. Edit distance settles it, because
 * "augmentn" is *one deletion* from "Augmentin" and two keystrokes from
 * "Augmentox". Capped so a long word does not cost a full matrix.
 */
export function editDistance(a, b, max = 3) {
  const s = String(a ?? '');
  const t = String(b ?? '');
  if (s === t) return 0;
  if (Math.abs(s.length - t.length) > max) return max + 1;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= t.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[t.length];
}

/**
 * Character ranges to wrap in <mark> when the dropdown renders the brand.
 * Only literal matches are highlighted — underlining half a word because it was
 * one letter off would look like a bug, so a fuzzy match shows plain.
 */
export function highlightRanges(text, query) {
  const haystack = String(text ?? '');
  const lower = haystack.toLowerCase();
  const tokens = normaliseDrugText(query).split(' ').filter((t) => t.length >= 2);
  const ranges = [];
  for (const token of tokens) {
    let from = lower.indexOf(token);
    while (from !== -1) {
      ranges.push([from, from + token.length]);
      from = lower.indexOf(token, from + token.length);
    }
  }
  if (!ranges.length) return [];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (const [start, end] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * The search itself: score, drop the zeros, sort, cut.
 *
 * `list` is any array of `{ id, brand, salt, strength, form, keywords, … }` —
 * the shipped formulary, the clinic's own history, or rows mapped from the
 * drug directory. `source` on each result says which of those it came from, so
 * the dropdown can label it without guessing.
 */
export function searchCatalogue(list, query, { limit = MAX_RESULTS, source = 'formulary', bonus = 0 } = {}) {
  const q = foldDoseUnits(query);
  if (q.length < MIN_QUERY_LENGTH) return [];
  const scored = [];
  for (const med of list) {
    const score = scoreMedicine(med, query, list);
    if (!score) continue;
    scored.push({
      ...med,
      source: med.source ?? source,
      score: score + bonus,
      highlight: highlightRanges(med.brand ?? '', query),
    });
  }
  return scored
    .sort((a, b) => b.score - a.score || String(a.brand).localeCompare(String(b.brand)))
    .slice(0, limit);
}

/**
 * Merge what the browser found with what the directory returned.
 *
 * The browser's list wins ties: it carries the clinic's dose defaults and the
 * clinic's own habits. A directory row that duplicates a brand + composition
 * already on screen is dropped rather than shown twice, and the merged list is
 * re-sorted on the raw score so a very close directory match can still lead.
 */
export function mergeSearchResults(local = [], remote = [], { limit = MAX_RESULTS } = {}) {
  const key = (med) => `${normaliseDrugText(med.brand)}|${normaliseDrugText(med.salt)}`;
  const seen = new Set(local.map(key));
  const merged = [...local];
  for (const med of remote) {
    const k = key(med);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(med);
  }
  return merged
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(a.brand).localeCompare(String(b.brand)))
    .slice(0, limit);
}
