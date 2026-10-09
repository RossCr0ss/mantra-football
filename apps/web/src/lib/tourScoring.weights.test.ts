import { describe, expect, it } from 'vitest';
import { calcScore, computeTeamForm } from './tourScoring';
import { makePlayer, makeForm } from './testUtils';
import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';
import type { FixtureOdds, TeamFixture } from '@/lib/fotmob';
import type { MantraPosition, PositionGroup } from '@/types/squad';

/**
 * Pins the numeric weights documented in docs/scoring.md. Expected values are computed by hand
 * from the documented formulas — if you change a weight on purpose, update the doc AND these numbers.
 */

const noForm = computeTeamForm([]);
const analytics = (o: Record<string, unknown> = {}) =>
  ({ playerId: 1, matchesPlayed: 10, minutesPlayed: 900, positionGroup: 'MID', ...o }) as unknown as PlayerAnalytics;
const fixture = (difficulty: number | null = 3, isHome = true) =>
  ({ matchId: 'f1', difficulty, isHome }) as unknown as TeamFixture;
const player = (positions: MantraPosition[], group: PositionGroup, extra: object = {}) =>
  makePlayer({ id: 1, mantraPositions: positions, positionGroup: group, ...extra });

const score = (
  a: PlayerAnalytics | null,
  opts: { fix?: TeamFixture | null; odds?: FixtureOdds | null; form?: ReturnType<typeof makeForm>[]; teamForm?: ReturnType<typeof computeTeamForm>; p?: ReturnType<typeof player> } = {},
) => calcScore(opts.p ?? player(['CM'], 'MID'), a, opts.fix === undefined ? fixture() : opts.fix, opts.odds ?? null, opts.form ?? [], opts.teamForm ?? noForm);

describe('rating component: max(0, (rating − 6) × 15)', () => {
  it.each([[7.0, 15], [7.5, 22.5], [6.0, 0], [5.0, 0]])('rating %f → %f', (r, expected) => {
    expect(score(analytics({ rating: r })).rating).toBeCloseTo(expected);
  });

  it('defaults to 6.0 (0 points) with no rating data', () => {
    expect(score(null).rating).toBe(0);
    expect(score(null).baseRating).toBe(6);
  });

  it('blends 60% season + 40% recent form when ≥3 rated appearances exist', () => {
    const form = [8, 8, 8].map((rating) => makeForm({ rating }));
    // (7×0.6 + 8×0.4 − 6) × 15 = 21
    expect(score(analytics({ rating: 7 }), { form }).rating).toBeCloseTo(21);
  });
});

describe('early-season blending with the previous season', () => {
  it('uses only the prior season when no matches were played yet (wConf = 0)', () => {
    const a = analytics({ matchesPlayed: 0, rating: null, priorSeason: { rating: 7.2, matchesPlayed: 30 } });
    expect(score(a).rating).toBeCloseTo((7.2 - 6) * 15);
  });

  it('weights current vs prior by matchesPlayed/4 (2 matches → 50/50)', () => {
    const a = analytics({ matchesPlayed: 2, rating: 6.0, priorSeason: { rating: 7.0, matchesPlayed: 30 } });
    expect(score(a).rating).toBeCloseTo(7.5); // 6.5 → 0.5 × 15
  });

  it('uses only current data from 4 matches on', () => {
    const a = analytics({ matchesPlayed: 4, rating: 7.0, priorSeason: { rating: 9.0, matchesPlayed: 30 } });
    expect(score(a).rating).toBeCloseTo(15);
  });
});

describe('fixture component: (difficulty − 1) × 4', () => {
  it.each([[1, 0], [3, 8], [5, 16]])('difficulty %i → %i', (d, expected) => {
    expect(score(null, { fix: fixture(d) }).fixture).toBe(expected);
  });

  it('no fixture: difficulty defaults to 3 for the component but total takes a −25 penalty (floored at 0)', () => {
    const withFix = score(analytics({ rating: 9 }), { fix: fixture(3) });
    const without = score(analytics({ rating: 9 }), { fix: null });
    expect(without.fixture).toBe(8);
    expect(without.total).toBeCloseTo(Math.max(0, withFix.total - 25));
  });
});

describe('odds component: win probability × 15', () => {
  it('uses home odds at home and away odds away', () => {
    const odds = { home: 2.0, draw: 3.5, away: 4.0 };
    expect(score(null, { odds, fix: fixture(3, true) }).odds).toBeCloseTo(7.5);
    expect(score(null, { odds, fix: fixture(3, false) }).odds).toBeCloseTo(15 / 4);
  });

  it('ignores missing or ≤1 odds', () => {
    expect(score(null, { odds: { home: null, draw: 3, away: 3 } }).odds).toBe(0);
    expect(score(null, { odds: { home: 1.0, draw: 3, away: 3 } }).odds).toBe(0);
    expect(score(null).odds).toBe(0);
  });
});

describe('minutes component: round(min(10, avg/90 × 12))', () => {
  it.each([[900, 10], [450, 6], [675, 9], [0, 0]])('%i minutes over 10 matches → %i', (minutes, expected) => {
    expect(score(analytics({ minutesPlayed: minutes })).minutes).toBe(expected);
  });
  it('is 0 without any data', () => expect(score(null).minutes).toBe(0));
});

describe('team form bonus: (W − L) / matches × 4, needs ≥3 results', () => {
  it('4W 1L → +2.4, 1W 4L → −2.4', () => {
    expect(score(null, { teamForm: { wins: 4, draws: 0, losses: 1, csRate: 0, matches: 5 } }).form).toBeCloseTo(2.4);
    expect(score(null, { teamForm: { wins: 1, draws: 0, losses: 4, csRate: 0, matches: 5 } }).form).toBeCloseTo(-2.4);
  });
  it('is 0 with fewer than 3 matches', () => {
    expect(score(null, { teamForm: { wins: 2, draws: 0, losses: 0, csRate: 0, matches: 2 } }).form).toBe(0);
  });
});

describe('position component (difficulty 3, no odds → winProb 0.25, csProb 0.2375)', () => {
  it('GK: CS prob blended with actual CS rate, saves, save %, goals prevented, claims, conceded', () => {
    const a = analytics({
      positionGroup: 'GK', cleanSheets: 4, saves: 30, savePercentage: 75, goalsPrevented: 2, highClaims: 10, goalsConceded: 12,
    });
    // effCs = 0.2375×0.4 + 0.4×0.6 = 0.335 → 0.335×1.5×12 = 6.03; +1.2 saves +1.0 sv% +1.0 prevented +0.4 claims −0.24 conceded
    expect(score(a, { p: player(['GK'], 'GK') }).position).toBeCloseTo(9.39);
  });

  it('DEF (CB): CS prob × 1.0 × 10 + goals × goalBonus × 6 + defensive actions', () => {
    const a = analytics({ positionGroup: 'DEF', goals: 1, assists: 0, tackles: 20, interceptions: 10 });
    // 2.375 + 0.1×3×6 (1.8) + 2×0.8 (1.6) + 1×1.0 (1.0)
    expect(score(a, { p: player(['CB'], 'DEF') }).position).toBeCloseTo(6.775);
  });

  it('ST: xG × 2 × 10 + assists, shots, chances, dribbles, aerials − big chances missed', () => {
    const a = analytics({
      positionGroup: 'FWD', expectedGoals: 8, assists: 2, shots: 30, bigChancesCreated: 2,
      successfulDribbles: 10, aerialsWon: 20, bigChancesMissed: 4,
    });
    // 16 + 1.0 + 0.75 + 0.4 + 0.4 + 0.6 − 0.8
    expect(score(a, { p: player(['ST'], 'FWD') }).position).toBeCloseTo(18.35);
  });

  describe('MID sub-roles and the winger forward (3 pts goal bonus; 10 matches)', () => {
    const base = {
      expectedGoals: 5, chancesCreated: 20, shots: 20, bigChancesCreated: 5, successfulDribbles: 10,
      tackles: 20, interceptions: 10, clearances: 10, assists: 3, bigChancesMissed: 4,
    };

    it('DM: defensive work weighted higher', () => {
      // 7.5 xG + 6 kp + 0.2 shots + 1.0 bcc + 0.2 dribbles + 1.6 tackles + 1.2 int + 0.3 clearances
      expect(score(analytics(base), { p: player(['DM'], 'MID') }).position).toBeCloseTo(18.0);
    });

    it('CM: balanced', () => {
      // 10.5 + 10 + 0.3 + 2.0 + 0.3 + 0.8 + 0.6
      expect(score(analytics(base), { p: player(['CM'], 'MID') }).position).toBeCloseTo(24.5);
    });

    it('AM and W: creativity weighted highest (same formula)', () => {
      // 13.5 + 14 + 0.4 + 2.5 + 0.5 + 0.3 + 0.2
      expect(score(analytics(base), { p: player(['AM'], 'MID') }).position).toBeCloseTo(31.4);
      expect(score(analytics(base), { p: player(['W'], 'MID') }).position).toBeCloseTo(31.4);
    });

    it('a DM who can also play AM uses the AM/W formula', () => {
      expect(score(analytics(base), { p: player(['DM', 'AM'], 'MID') }).position).toBeCloseTo(31.4);
    });

    it('FWD winger (W without ST/FW): xG, chances, assists, dribbles, minus missed big chances', () => {
      // 12 + 6 + 1.8 + 0.4 + 1.5 + 0.6 − 0.6
      expect(score(analytics({ ...base, positionGroup: 'FWD' }), { p: player(['W'], 'FWD') }).position).toBeCloseTo(21.7);
    });

    it('uses goals per match when xG is unavailable in both seasons', () => {
      const a = analytics({ positionGroup: 'FWD', goals: 5 });
      expect(score(a, { p: player(['ST'], 'FWD') }).position).toBeCloseTo(10); // 0.5 × 2 × 10
    });
  });

  it('falls back to the player\'s effective Mantra group when analytics has no positionGroup', () => {
    const a = analytics({ positionGroup: undefined, tackles: 20 });
    expect(score(a, { p: player(['CB'], 'MID') }).position).toBeGreaterThan(0); // CB → DEF branch (CS term)
  });
});

describe('total', () => {
  it('= max(0, sum of components − noFixturePenalty) × availability', () => {
    const a = analytics({ rating: 7, minutesPlayed: 900 });
    const full = score(a, { p: player(['CM'], 'MID', { availabilityPct: 100 }) });
    const sum = full.rating + full.fixture + full.odds + full.position + full.minutes + full.form;
    expect(full.total).toBeCloseTo(sum);
    expect(score(a, { p: player(['CM'], 'MID', { availabilityPct: 75 }) }).total).toBeCloseTo(sum * 0.75);
  });
});
