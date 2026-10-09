/**
 * Fuzzy name matching used to reconcile players between FotMob and mantrafootball.org —
 * the two sites use unrelated numeric IDs, so players have to be matched by name + club.
 */

const COMBINING_MARKS_START = 0x0300;
const COMBINING_MARKS_END = 0x036f;

function stripCombiningMarks(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < COMBINING_MARKS_START || code > COMBINING_MARKS_END) out += ch;
  }
  return out;
}

export function normalizeName(s: string): string {
  return stripCombiningMarks(s.normalize('NFD'))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/** Normalized similarity ratio in [0, 1] — 1 means identical after normalization. */
export function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

/** Given-name similarity — a short-for-long prefix (Nico/Nicolas, Rob/Robert) counts as a strong match. */
function givenNameSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const isNicknamePrefix = (a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b));
  return isNicknamePrefix ? 0.95 : similarity(a, b);
}

/**
 * Player-name similarity — compares surname and given name separately, since
 * whole-string edit distance badly over-penalizes a nickname given name (FotMob
 * "Nico Paz" vs mantrafootball's "Nicolas Paz" — confirmed on real data: plain
 * similarity() lands just under the match threshold on this pair alone, purely
 * because "nico"→"nicolas" is a big edit relative to how short "nico paz" is).
 *
 * Also tries the swapped order and keeps whichever pairing scores higher —
 * mantrafootball.org's own first_name/name fields are occasionally reversed
 * relative to the given/surname convention FotMob uses for the same player
 * (confirmed on real data: "Alisson Santana" stored there as first_name
 * "Santana", name "Alisson"), so a rigid first-token/last-token pairing can
 * miss a player whose two name tokens are individually both fine matches.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = normalizeName(a).split(' ').filter(Boolean);
  const tb = normalizeName(b).split(' ').filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return 0;

  const lastA = ta[ta.length - 1];
  const firstA = ta[0];
  const lastB = tb[tb.length - 1];
  const firstB = tb[0];

  const straight = similarity(lastA, lastB) * 0.6 + givenNameSimilarity(firstA, firstB) * 0.4;
  const swapped = similarity(lastA, firstB) * 0.6 + givenNameSimilarity(firstA, lastB) * 0.4;

  return Math.max(straight, swapped);
}

/**
 * Club-name similarity — more lenient than plain edit distance because the two
 * sites often differ by a city suffix (FotMob "Polissya Zhytomyr" vs mantra's
 * "Polissya"). A short-name-contained-in-long-name match is treated as strong.
 */
export function clubSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.95;
  return similarity(a, b);
}

export interface MatchCandidate {
  fullName: string;
  clubName: string;
}

/** Best candidate by combined name + club similarity, or null if nothing clears the threshold. */
export function matchMantraPlayer<T extends MatchCandidate>(
  target: { name: string; teamName: string },
  candidates: T[],
  threshold = 0.85,
): T | null {
  let best: T | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const nameSim = nameSimilarity(target.name, candidate.fullName);
    const clubSim = clubSimilarity(target.teamName, candidate.clubName);
    const score = nameSim * 0.7 + clubSim * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore >= threshold ? best : null;
}
