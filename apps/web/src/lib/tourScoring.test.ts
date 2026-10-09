import { describe, expect, it } from 'vitest';
import { calcScore, computeTeamForm, recentFormRating, isBlocked, goalBonus } from './tourScoring';
import { makePlayer, makeForm } from './testUtils';

const noForm = computeTeamForm([]);

describe('computeTeamForm / recentFormRating', () => {
  it('counts W/D/L and clean sheets over the last 5 results', () => {
    const f = computeTeamForm([
      makeForm({ result: 'W', goalsAgainst: 0 }),
      makeForm({ result: 'D', goalsAgainst: 1 }),
      makeForm({ result: 'L', goalsAgainst: 2 }),
    ]);
    expect(f).toMatchObject({ wins: 1, draws: 1, losses: 1, matches: 3 });
    expect(f.csRate).toBeCloseTo(1 / 3);
  });

  it('needs at least 3 rated appearances (>30 min) for form rating', () => {
    expect(recentFormRating([makeForm(), makeForm()])).toBeNull();
    expect(recentFormRating([makeForm({ rating: 6 }), makeForm({ rating: 7 }), makeForm({ rating: 8 })])).toBe(7);
    expect(recentFormRating([makeForm(), makeForm(), makeForm({ minutesPlayed: 10 })])).toBeNull();
  });
});

describe('calcScore', () => {
  it('blocks injured/suspended players entirely', () => {
    const p = makePlayer({ id: 1, lineupStatus: 'injured' });
    expect(isBlocked(p)).toBe(true);
    expect(calcScore(p, null, null, null, [], noForm).total).toBe(-999);
  });

  it('availabilityPct 0 yields a zero score, 50 halves it', () => {
    const base = makePlayer({ id: 1 });
    const full = calcScore(base, null, null, null, [], noForm).total;
    const half = calcScore({ ...base, availabilityPct: 50 }, null, null, null, [], noForm).total;
    const none = calcScore({ ...base, availabilityPct: 0 }, null, null, null, [], noForm).total;
    expect(none).toBe(0);
    expect(half).toBeCloseTo(full / 2);
  });

  it('never returns a negative total for unblocked players (no-fixture penalty is floored)', () => {
    const s = calcScore(makePlayer({ id: 1 }), null, null, null, [], noForm);
    expect(s.total).toBeGreaterThanOrEqual(0);
  });
});

describe('goalBonus', () => {
  it('is lower for strikers than for non-forwards', () => {
    expect(goalBonus(['ST'])).toBeLessThan(goalBonus(['CB']));
  });
});
