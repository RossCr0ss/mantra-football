import type { SquadPlayer, MantraPosition, PositionGroup } from '@/types/squad';
import type { TeamFixture, FixtureOdds, PlayerRecentMatch } from '@/lib/fotmob';
import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';
import { effectivePositionGroup } from '@/lib/positionGroups';

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Bonus for a scored goal, by the scorer's NATIVE positions (any of them, not just the first).
 * Official rule since 01.06.2026 (mantrafootball.org/rules): +2 if ST or FW; +2.5 if AM or W
 * (and no ST/FW); otherwise +3. Before that date FW was +2.5 and AM/W +3.
 */
export function goalBonus(mantraPositions: MantraPosition[]): number {
  if (mantraPositions.includes('ST') || mantraPositions.includes('FW')) return 2;
  if (mantraPositions.includes('AM') || mantraPositions.includes('W')) return 2.5;
  return 3;
}

export function csBonus(mantraPositions: MantraPosition[]): number {
  const primary = mantraPositions[0];
  if (primary === 'GK') return 1.5;
  if (primary === 'RB' || primary === 'CB' || primary === 'LB') return 1;
  if (primary === 'WB' || primary === 'DM') return 0.5;
  return 0;
}

/** One Mantra point (≈ one FotMob rating point) is worth this many score units. */
export const SCORE_UNITS_PER_MANTRA_POINT = 15;

/** Per-position-group weights of the expected-points model (see docs/scoring.md). */
export interface GroupWeights {
  /** Expected Mantra points of a typical starter before any other term. */
  intercept: number;
  /** × blended season/form rating. */
  rating: number;
  /** × team win probability (1 / decimal odds). */
  winProb: number;
  /** × opponent win probability — negative: a strong opponent costs points. */
  oppWinProb: number;
  /** × draw probability (draws mean clean sheets for defenders, fewer goals for attackers). */
  drawProb: number;
  /** × xG per match × goal bonus (xG falls back to goals per match). */
  xgGoalBonus: number;
  /** × assists per match. */
  assist: number;
  /** × chances created (key passes) per match. */
  chanceCreated: number;
  /** × big chances created per match. */
  bigChance: number;
  /** × clean-sheet bonus × win probability / opponent win probability (defenders). */
  csWin: number;
  csOppWin: number;
}

export const SCORE_WEIGHTS: {
  /** Points a replacement (bench) player is assumed to earn — the zero point of the score. */
  replacement: number;
  /** logistic start probability: intercept + share × minutes share + avgMinutes × (avg minutes / 90). */
  startProb: { intercept: number; share: number; avgMinutes: number; unknown: number; suggestedBlend: number };
  byGroup: Record<PositionGroup, GroupWeights>;
} = {
  replacement: 5.0,
  startProb: { intercept: -2.46, share: 3.67, avgMinutes: 0.89, unknown: 0.5, suggestedBlend: 0.4 },
  byGroup: {
    GK:  { intercept: 6.465, rating: 0.03, winProb: 1.03, oppWinProb: -1.33, drawProb: 1.906, xgGoalBonus: 0, assist: 0, chanceCreated: 0, bigChance: 0, csWin: 0, csOppWin: 0 },
    DEF: { intercept: 6.735, rating: 0.058, winProb: 0.518, oppWinProb: -0.578, drawProb: 0.6, xgGoalBonus: 0.42, assist: 0, chanceCreated: 0.168, bigChance: 0.166, csWin: 0.482, csOppWin: -0.475 },
    MID: { intercept: 6.202, rating: 0.144, winProb: 0.995, oppWinProb: -0.796, drawProb: -0.726, xgGoalBonus: 0.549, assist: 0.095, chanceCreated: 0.16, bigChance: 0.181, csWin: 0, csOppWin: 0 },
    FWD: { intercept: 6.275, rating: 0.169, winProb: 1.149, oppWinProb: -0.901, drawProb: -1.115, xgGoalBonus: 0.39, assist: 0, chanceCreated: 0.126, bigChance: 0.201, csWin: 0, csOppWin: 0 },
  },
};

/** Empirical averages of the 1X2 probabilities by fixture difficulty — used when odds are unavailable. */
const WIN_PROB_BY_DIFFICULTY: Record<number, number> = { 1: 0.244, 2: 0.348, 3: 0.411, 4: 0.448, 5: 0.503 };
const OPP_WIN_PROB_BY_DIFFICULTY: Record<number, number> = { 1: 0.587, 2: 0.455, 3: 0.381, 4: 0.342, 5: 0.296 };
const DEFAULT_DRAW_PROB = 0.28;
/** Games in a typical league season — scales last season's minutes into a minutes share. */
const PRIOR_SEASON_GAMES = 34;

export interface ScoreBreakdown {
  /** Score units: SCORE_UNITS_PER_MANTRA_POINT × startProb × (expectedPoints − replacement). −999 = blocked. */
  total: number;
  /** Blended season/form rating (unpenalised) — input of the team defence bonus. */
  baseRating: number;
  /** Expected Mantra points if the player starts. */
  expectedPoints: number;
  /** Probability of starting (0–1): availabilityPct when set, else estimated from minutes played. */
  startProb: number;
  /** Score units (already × startProb) contributed by the player's own quality (rating above 6). */
  rating: number;
  /** … by the match context: own/opponent win probability, draw probability, clean-sheet odds. */
  context: number;
  /** … by attacking output: xG × goal bonus, assists, chances created, big chances created. */
  attack: number;
  /** availabilityPct as used (0–100). */
  availability: number;
}

/** Average rating from the last ≥3 recent matches that had playing time. */
export function recentFormRating(form: PlayerRecentMatch[]): number | null {
  const rated = form
    .filter((m) => m.rating !== null && m.minutesPlayed !== null && m.minutesPlayed > 30)
    .slice(0, 5)
    .map((m) => m.rating as number);
  if (rated.length < 3) return null;
  return rated.reduce((s, r) => s + r, 0) / rated.length;
}

/** 1 / decimal odds when they are a usable price (> 1), else null. */
function impliedProb(odds: number | null | undefined): number | null {
  return odds != null && odds > 1 ? 1 / odds : null;
}

/**
 * Own win / opponent win / draw probability of the fixture from the 1X2 odds. Any missing price falls
 * back to the empirical average for the fixture difficulty (3 when the difficulty is unknown too).
 */
export function matchContext(fix: TeamFixture | null, odds: FixtureOdds | null) {
  const diff = Math.min(5, Math.max(1, Math.round(fix?.difficulty ?? 3)));
  const own = odds && fix ? impliedProb(fix.isHome ? odds.home : odds.away) : null;
  const opp = odds && fix ? impliedProb(fix.isHome ? odds.away : odds.home) : null;
  const draw = odds && fix ? impliedProb(odds.draw) : null;
  return {
    winProb: own ?? WIN_PROB_BY_DIFFICULTY[diff],
    oppWinProb: opp ?? OPP_WIN_PROB_BY_DIFFICULTY[diff],
    drawProb: draw ?? DEFAULT_DRAW_PROB,
  };
}

export function calcScore(
  player: SquadPlayer,
  analytics: PlayerAnalytics | null,
  fix: TeamFixture | null,
  odds: FixtureOdds | null,
  form: PlayerRecentMatch[],
): ScoreBreakdown {
  if (isBlocked(player)) {
    return { total: -999, baseRating: 6.0, expectedPoints: 0, startProb: 0, rating: 0, context: 0, attack: 0, availability: 0 };
  }

  const matchesPlayed = analytics?.matchesPlayed ?? 0;
  const prior = analytics?.priorSeason ?? null;
  const priorMatches = prior?.matchesPlayed ?? 0;
  // Confidence in current-season data ramps from 0 to full trust over its first
  // 4 matches, instead of a hard switch — early in a new season every player's
  // current-season stats are 0/null, which would make every player score identically.
  const wConf = Math.min(1, matchesPlayed / 4);

  // Blends a counting stat's per-match rate between current season (weighted by
  // wConf) and last season, so early-season players (new signings, players back
  // from injury, or just gameweek 1) aren't scored on zero signal alone.
  const pm = (curTotal: number | null | undefined, priorTotal: number | null | undefined): number => {
    const curRate = matchesPlayed > 0 && curTotal != null ? curTotal / matchesPlayed : null;
    const priorRate = priorMatches > 0 && priorTotal != null ? priorTotal / priorMatches : null;
    if (curRate == null) return priorRate ?? 0;
    if (priorRate == null) return curRate;
    return curRate * wConf + priorRate * (1 - wConf);
  };
  // Like pm(), but falls back to a proxy stat (e.g. goals/match) only when
  // neither season has real data for this stat at all.
  const pmOr = (
    curTotal: number | null | undefined, priorTotal: number | null | undefined, fallback: number,
  ): number => (curTotal != null || priorTotal != null ? pm(curTotal, priorTotal) : fallback);

  const curRating = analytics?.rating ?? null;
  const priorRating = prior?.rating ?? null;
  const seasonRating = curRating != null && priorRating != null
    ? curRating * wConf + priorRating * (1 - wConf)
    : curRating ?? priorRating ?? 6.0;
  const formRating = recentFormRating(form);
  // Blend: 60% season average + 40% recent form when enough form matches available
  const rating = formRating !== null ? seasonRating * 0.6 + formRating * 0.4 : seasonRating;

  const group = analytics?.positionGroup ?? effectivePositionGroup(player);
  const positions = player.mantraPositions ?? [];
  const w = SCORE_WEIGHTS.byGroup[group as PositionGroup] ?? SCORE_WEIGHTS.byGroup.MID;
  const ctx = matchContext(fix, odds);

  const gpg = pm(analytics?.goals, prior?.goals);
  const xgPerMatch = pmOr(analytics?.expectedGoals, prior?.expectedGoals, gpg);
  const csb = csBonus(positions);

  const quality = w.rating * (rating - 6.0);
  const context = w.winProb * ctx.winProb + w.oppWinProb * ctx.oppWinProb + w.drawProb * ctx.drawProb
    + csb * (w.csWin * ctx.winProb + w.csOppWin * ctx.oppWinProb);
  const attack = w.xgGoalBonus * xgPerMatch * goalBonus(positions)
    + w.assist * pm(analytics?.assists, prior?.assists)
    + w.chanceCreated * pm(analytics?.chancesCreated, prior?.chancesCreated)
    + w.bigChance * pm(analytics?.bigChancesCreated, prior?.bigChancesCreated);
  const expectedPoints = w.intercept + w.rating * 6.0 + quality + context + attack;

  let startProb = 0;
  if (fix) {
    const modelProb = estimateStartProb(analytics, fix);
    const pct = player.availabilityPct;
    // A hand-set availability is taken as is; an algorithm-suggested one (last-5-matches form) is
    // blended with the season-long minutes model, which is an independent signal of the same thing.
    const b = SCORE_WEIGHTS.startProb.suggestedBlend;
    startProb = pct == null ? modelProb
      : player.availabilityPctSource === 'suggested' ? (1 - b) * (pct / 100) + b * modelProb
      : pct / 100;
  }

  const k = SCORE_UNITS_PER_MANTRA_POINT * startProb;
  const total = Math.max(0, k * (expectedPoints - SCORE_WEIGHTS.replacement));

  return {
    total,
    baseRating: rating,
    expectedPoints,
    startProb,
    rating: k * quality,
    context: k * context,
    attack: k * attack,
    availability: startProb * 100,
  };
}

/**
 * Probability that the player starts the next match, from how much of his team's minutes he has played:
 * this season's share of (team matches so far × 90), blended with last season's share while the season
 * is young, plus his average minutes per appearance. No minutes data at all (e.g. Ukrainian league) → neutral.
 */
export function estimateStartProb(analytics: PlayerAnalytics | null, fix: TeamFixture | null): number {
  const cfg = SCORE_WEIGHTS.startProb;
  const prior = analytics?.priorSeason ?? null;
  const mp = analytics?.matchesPlayed ?? 0;
  const priorMp = prior?.matchesPlayed ?? 0;
  const minutes = analytics?.minutesPlayed ?? 0;
  const priorMinutes = prior?.minutesPlayed ?? 0;
  if (mp === 0 && priorMp === 0 && minutes === 0 && priorMinutes === 0) return cfg.unknown;

  // Matches the team has played so far ≈ round − 1; never fewer than his own appearances (rounds restart in playoffs).
  const round = fix?.round != null ? Number(fix.round) : NaN;
  const teamMatches = Math.max(mp, Number.isFinite(round) ? round - 1 : 0);
  const shareCur = teamMatches > 0 ? Math.min(1, minutes / (teamMatches * 90)) : null;
  const sharePrior = priorMinutes > 0 ? Math.min(1, priorMinutes / (PRIOR_SEASON_GAMES * 90)) : null;
  const wCur = Math.min(1, teamMatches / 6);
  const share = shareCur == null ? sharePrior ?? 0
    : sharePrior == null ? shareCur
    : shareCur * wCur + sharePrior * (1 - wCur);

  const wConf = Math.min(1, mp / 4);
  const curAvg = mp > 0 && minutes > 0 ? minutes / mp : null;
  const priorAvg = priorMp > 0 && priorMinutes > 0 ? priorMinutes / priorMp : null;
  const avgMin = curAvg != null && priorAvg != null ? curAvg * wConf + priorAvg * (1 - wConf) : curAvg ?? priorAvg ?? 0;

  const z = cfg.intercept + cfg.share * share + cfg.avgMinutes * (avgMin / 90);
  return 1 / (1 + Math.exp(-z));
}

export function isBlocked(player: SquadPlayer): boolean {
  return player.lineupStatus === 'injured' || player.lineupStatus === 'suspended';
}
