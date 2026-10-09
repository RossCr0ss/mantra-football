import { describe, expect, it } from 'vitest';
import { calcScore, matchContext, SCORE_WEIGHTS } from './tourScoring';
import { makePlayer } from './testUtils';
import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';
import type { FixtureOdds, TeamFixture } from '@/lib/fotmob';
import type { MantraPosition, PositionGroup } from '@/types/squad';

/**
 * Pins the numeric weights documented in docs/scoring.md. Expected values are computed by hand from the
 * documented formula — if you change a weight on purpose (re-fit with scripts/weights-research), update the
 * doc AND these numbers.
 */

const analytics = (o: Record<string, unknown> = {}) =>
  ({ playerId: 1, matchesPlayed: 10, minutesPlayed: 900, positionGroup: 'MID', ...o }) as unknown as PlayerAnalytics;
const fixture = (difficulty: number | null = 3, isHome = true, round = '11') =>
  ({ matchId: 'f1', difficulty, isHome, round }) as unknown as TeamFixture;
const player = (positions: MantraPosition[], group: PositionGroup, extra: object = {}) =>
  makePlayer({ id: 1, mantraPositions: positions, positionGroup: group, availabilityPct: 100, ...extra });
const score = (a: PlayerAnalytics | null, p: ReturnType<typeof player>, fix: TeamFixture | null = fixture(), odds: FixtureOdds | null = null) =>
  calcScore(p, a, fix, odds, []);

describe('weights table (docs/scoring.md)', () => {
  it('pins the fitted per-position coefficients', () => {
    expect(SCORE_WEIGHTS.replacement).toBe(5);
    expect(SCORE_WEIGHTS.startProb).toEqual({ intercept: -2.46, share: 3.67, avgMinutes: 0.89, unknown: 0.5, suggestedBlend: 0.4 });
    expect(SCORE_WEIGHTS.byGroup.GK).toEqual({
      intercept: 6.465, rating: 0.03, winProb: 1.03, oppWinProb: -1.33, drawProb: 1.906,
      xgGoalBonus: 0, assist: 0, chanceCreated: 0, bigChance: 0, csWin: 0, csOppWin: 0,
    });
    expect(SCORE_WEIGHTS.byGroup.DEF).toEqual({
      intercept: 6.735, rating: 0.058, winProb: 0.518, oppWinProb: -0.578, drawProb: 0.6,
      xgGoalBonus: 0.42, assist: 0, chanceCreated: 0.168, bigChance: 0.166, csWin: 0.482, csOppWin: -0.475,
    });
    expect(SCORE_WEIGHTS.byGroup.MID).toEqual({
      intercept: 6.202, rating: 0.144, winProb: 0.995, oppWinProb: -0.796, drawProb: -0.726,
      xgGoalBonus: 0.549, assist: 0.095, chanceCreated: 0.16, bigChance: 0.181, csWin: 0, csOppWin: 0,
    });
    expect(SCORE_WEIGHTS.byGroup.FWD).toEqual({
      intercept: 6.275, rating: 0.169, winProb: 1.149, oppWinProb: -0.901, drawProb: -1.115,
      xgGoalBonus: 0.39, assist: 0, chanceCreated: 0.126, bigChance: 0.201, csWin: 0, csOppWin: 0,
    });
  });
});

describe('matchContext: win / opponent-win / draw probability', () => {
  const odds = { home: 2.0, draw: 4.0, away: 5.0 };

  it('is 1 / decimal odds, from the player\'s side', () => {
    expect(matchContext(fixture(3, true), odds)).toEqual({ winProb: 0.5, oppWinProb: 0.2, drawProb: 0.25 });
    expect(matchContext(fixture(3, false), odds)).toEqual({ winProb: 0.2, oppWinProb: 0.5, drawProb: 0.25 });
  });

  it('falls back to the empirical average for the difficulty when odds are missing or ≤ 1', () => {
    expect(matchContext(fixture(1), null)).toEqual({ winProb: 0.244, oppWinProb: 0.587, drawProb: 0.28 });
    expect(matchContext(fixture(5), { home: 1.0, draw: null, away: 3 })).toEqual({ winProb: 0.503, oppWinProb: 1 / 3, drawProb: 0.28 });
    expect(matchContext(null, null).winProb).toBe(0.411);        // difficulty unknown → 3
  });
});

describe('expected points (start probability 1)', () => {
  const odds = { home: 2.0, draw: 4.0, away: 5.0 };

  it('MID (CM): intercept + rating + context + attack, hand-computed', () => {
    const a = analytics({ rating: 7, expectedGoals: 5, assists: 3, chancesCreated: 20, bigChancesCreated: 5 });
    const sb = score(a, player(['CM'], 'MID'), fixture(3, true), odds);
    const attack = 0.549 * 0.5 * 3 + 0.095 * 0.3 + 0.16 * 2 + 0.181 * 0.5;     // xG 0.5/match × goal bonus 3
    const expected = 6.202 + 0.144 * 7 + 0.995 * 0.5 - 0.796 * 0.2 - 0.726 * 0.25 + attack;
    expect(sb.expectedPoints).toBeCloseTo(expected, 6);
    expect(sb.total).toBeCloseTo((expected - 5) * 15, 6);
    expect(sb.rating).toBeCloseTo(0.144 * 1 * 15, 6);                           // quality term = weight × (rating − 6)
    expect(sb.attack).toBeCloseTo(attack * 15, 6);
  });

  it('DEF (CB): adds the clean-sheet interaction csBonus × (win − opponent win)', () => {
    const sb = score(analytics({ positionGroup: 'DEF', rating: 6.8 }), player(['CB'], 'DEF'), fixture(3, true), odds);
    const expected = 6.735 + 0.058 * 6.8 + 0.518 * 0.5 - 0.578 * 0.2 + 0.6 * 0.25 + 1 * (0.482 * 0.5 - 0.475 * 0.2);
    expect(sb.expectedPoints).toBeCloseTo(expected, 6);
  });

  it('GK: rating and context only (no attack terms)', () => {
    const sb = score(analytics({ positionGroup: 'GK', rating: 7, goals: 9, assists: 9 }), player(['GK'], 'GK'), fixture(3, true), odds);
    expect(sb.expectedPoints).toBeCloseTo(6.465 + 0.03 * 7 + 1.03 * 0.5 - 1.33 * 0.2 + 1.906 * 0.25, 6);
    expect(sb.attack).toBe(0);
  });

  it('uses goals per match when xG is unavailable in both seasons', () => {
    const base = { positionGroup: 'FWD', rating: 6 };
    const withXg = score(analytics({ ...base, expectedGoals: 5 }), player(['ST'], 'FWD'), fixture(), odds);
    const withGoals = score(analytics({ ...base, goals: 5 }), player(['ST'], 'FWD'), fixture(), odds);
    expect(withGoals.attack).toBeCloseTo(withXg.attack, 6);
  });

  it('a goal is worth more to a defender / DM than to a striker (goal bonus 3 vs 2)', () => {
    const a = analytics({ expectedGoals: 5 });
    const dm = score(a, player(['DM'], 'MID')).attack;
    const st = score(a, player(['ST'], 'MID')).attack;
    expect(dm / st).toBeCloseTo(3 / 2, 6);
  });

  it('blends current and prior season per-match stats by matchesPlayed / 4', () => {
    const a = analytics({ matchesPlayed: 2, minutesPlayed: 180, expectedGoals: 2, priorSeason: { matchesPlayed: 30, expectedGoals: 3, minutesPlayed: 2700 } });
    // current 1.0 xG/match, prior 0.1 → 50/50 → 0.55
    expect(score(a, player(['CM'], 'MID')).attack).toBeCloseTo(0.549 * 0.55 * 3 * 15, 6);
  });
});

describe('monotonicity', () => {
  const base = () => analytics({ rating: 7, expectedGoals: 3 });
  const total = (o: FixtureOdds | null, a = base()) => score(a, player(['CM'], 'MID'), fixture(3, true), o).total;

  it('a likelier own win raises the score, a likelier opponent win lowers it', () => {
    expect(total({ home: 1.5, draw: 4, away: 6 })).toBeGreaterThan(total({ home: 2.5, draw: 3.5, away: 3.0 }));
    expect(total({ home: 2.0, draw: 3.5, away: 8 })).toBeGreaterThan(total({ home: 2.0, draw: 3.5, away: 2.5 }));
  });

  it('better rating and more attacking output raise the score', () => {
    const o = { home: 2.0, draw: 3.5, away: 4 };
    expect(total(o, analytics({ rating: 7.5, expectedGoals: 3 }))).toBeGreaterThan(total(o));
    expect(total(o, analytics({ rating: 7, expectedGoals: 6 }))).toBeGreaterThan(total(o));
  });
});

describe('total = 15 × startProb × (expected points − replacement), floored at 0', () => {
  it('scales linearly with start probability', () => {
    const a = analytics({ rating: 7.2, expectedGoals: 4 });
    const full = score(a, player(['CM'], 'MID')).total;
    expect(score(a, player(['CM'], 'MID', { availabilityPct: 80 })).total).toBeCloseTo(full * 0.8, 6);
  });

  it('is 0 for a player expected to score below the replacement level', () => {
    const original = SCORE_WEIGHTS.replacement;
    SCORE_WEIGHTS.replacement = 10;                 // no fitted player is that bad, so raise the bar for the test
    try {
      expect(score(analytics({ rating: 7 }), player(['CM'], 'MID')).total).toBe(0);
    } finally {
      SCORE_WEIGHTS.replacement = original;
    }
  });
});
