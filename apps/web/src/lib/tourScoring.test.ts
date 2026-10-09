import { describe, expect, it } from 'vitest';
import { calcScore, recentFormRating, isBlocked, goalBonus, estimateStartProb } from './tourScoring';
import { makePlayer, makeForm } from './testUtils';
import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';
import type { TeamFixture } from '@/lib/fotmob';

const analytics = (o: Record<string, unknown> = {}) =>
  ({ playerId: 1, matchesPlayed: 10, minutesPlayed: 900, rating: 7, positionGroup: 'MID', ...o }) as unknown as PlayerAnalytics;
const fixture = (o: Record<string, unknown> = {}) =>
  ({ matchId: 'f1', difficulty: 3, isHome: true, round: '11', ...o }) as unknown as TeamFixture;

describe('recentFormRating', () => {
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
    expect(calcScore(p, null, null, null, []).total).toBe(-999);
  });

  it('availabilityPct 0 yields a zero score, 50 halves it', () => {
    const run = (availabilityPct: number) =>
      calcScore(makePlayer({ id: 1, availabilityPct }), analytics(), fixture(), null, []).total;
    expect(run(0)).toBe(0);
    expect(run(50)).toBeCloseTo(run(100) / 2);
  });

  it('a player without an upcoming fixture (blank gameweek) scores 0', () => {
    expect(calcScore(makePlayer({ id: 1 }), analytics({ rating: 9 }), null, null, []).total).toBe(0);
  });

  it('never returns a negative total for unblocked players', () => {
    expect(calcScore(makePlayer({ id: 1 }), null, null, null, []).total).toBeGreaterThanOrEqual(0);
    expect(calcScore(makePlayer({ id: 1 }), analytics({ rating: 5 }), fixture(), null, []).total).toBeGreaterThanOrEqual(0);
  });

  it('blends 60% season + 40% recent form into the base rating when ≥3 rated appearances exist', () => {
    const form = [8, 8, 8].map((rating) => makeForm({ rating }));
    expect(calcScore(makePlayer({ id: 1 }), analytics({ rating: 7 }), fixture(), null, form).baseRating).toBeCloseTo(7.4);
  });

  it('exposes the blocks of the breakdown consistently (total = k × (expected − replacement) before the floor)', () => {
    const sb = calcScore(makePlayer({ id: 1, availabilityPct: 100 }), analytics(), fixture(), null, []);
    expect(sb.startProb).toBe(1);
    expect(sb.availability).toBe(100);
    expect(sb.total).toBeCloseTo((sb.expectedPoints - 5) * 15);
  });
});

describe('start probability', () => {
  const fix = fixture({ round: '11' });          // 10 matches played so far

  it('a hand-set availability is used as is', () => {
    const sb = calcScore(makePlayer({ id: 1, availabilityPct: 70, availabilityPctSource: 'manual' }), analytics(), fix, null, []);
    expect(sb.startProb).toBeCloseTo(0.7);
  });

  it('a suggested availability is blended 60/40 with the minutes model', () => {
    const model = estimateStartProb(analytics(), fix);
    const sb = calcScore(makePlayer({ id: 1, availabilityPct: 50, availabilityPctSource: 'suggested' }), analytics(), fix, null, []);
    expect(sb.startProb).toBeCloseTo(0.6 * 0.5 + 0.4 * model);
  });

  it('without an availability the minutes model decides: a regular starter is far likelier than a rarely used player', () => {
    const regular = estimateStartProb(analytics({ matchesPlayed: 10, minutesPlayed: 880 }), fix);
    const fringe = estimateStartProb(analytics({ matchesPlayed: 3, minutesPlayed: 90 }), fix);
    expect(regular).toBeGreaterThan(0.85);
    expect(fringe).toBeLessThan(0.25);
  });

  it('uses last season\'s minutes while the current season is young', () => {
    const early = fixture({ round: '2' });         // 1 match played
    const noHistory = estimateStartProb(analytics({ matchesPlayed: 0, minutesPlayed: 0 }), early);
    const withPrior = estimateStartProb(
      analytics({ matchesPlayed: 0, minutesPlayed: 0, priorSeason: { matchesPlayed: 34, minutesPlayed: 3000 } }), early,
    );
    expect(withPrior).toBeGreaterThan(0.7);
    expect(noHistory).toBe(0.5);                    // no minutes data at all → neutral
  });

  it('team matches are never fewer than the player\'s own appearances (rounds restart in playoffs)', () => {
    const playoff = fixture({ round: '1' });
    expect(estimateStartProb(analytics({ matchesPlayed: 30, minutesPlayed: 2700 }), playoff)).toBeGreaterThan(0.85);
  });
});

describe('goalBonus (official rule since 01.06.2026)', () => {
  // Examples taken from mantrafootball.org/rules
  it.each([
    ['Haaland (ST)', ['ST'], 2],
    ['Cunha (FW)', ['FW'], 2],
    ['Mbeumo (W, FW) — has FW', ['W', 'FW'], 2],
    ['Fernandes (AM)', ['AM'], 2.5],
    ['Saka (W)', ['W'], 2.5],
    ['Semenyo (WB, W) — has W', ['WB', 'W'], 2.5],
    ['Guimaraes (DM, CM)', ['DM', 'CM'], 3],
    ['defender / goalkeeper', ['CB'], 3],
  ] as const)('%s → +%f', (_name, positions, expected) => {
    expect(goalBonus([...positions])).toBe(expected);
  });
});
