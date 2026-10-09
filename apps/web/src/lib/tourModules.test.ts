import { describe, expect, it } from 'vitest';
import {
  MODULES, getSlotPenalty, assignModule, effectiveScore, defenceBonusPoints, defenderSlotIndexes,
  assignmentDefenceBonus, assignmentScore, pickBestModule, SCORE_UNITS_PER_MANTRA_POINT, type EnrichedPlayer,
} from './tourModules';
import { makePlayer } from './testUtils';
import type { MantraPosition } from '@/types/squad';
import type { ScoreBreakdown } from './tourScoring';

const bd = (total: number): ScoreBreakdown => ({
  total, baseRating: 7, rating: 10, fixture: 0, odds: 0, position: 0, minutes: 0, form: 0, availability: 100,
});

function enriched(id: number, pos: MantraPosition, group: 'GK' | 'DEF' | 'MID' | 'FWD', total: number): EnrichedPlayer {
  return { ...makePlayer({ id, mantraPositions: [pos], positionGroup: group }), scoreBreakdown: bd(total) } as unknown as EnrichedPlayer;
}

describe('MODULES', () => {
  it('every formation has exactly 10 outfield slots', () => {
    for (const m of MODULES) expect(m.slots, m.name).toHaveLength(10);
  });
});

describe('getSlotPenalty', () => {
  it('is 0 for a native player, negative when out of position, undefined when incompatible', () => {
    expect(getSlotPenalty(['CB'], ['CB'])).toBe(0);
    expect(getSlotPenalty(['CB'], ['LB'])).toBe(-1.5);
    expect(getSlotPenalty(['CB'], ['ST'])).toBeUndefined();
  });

  it('takes the best penalty across accepted slot positions and player positions', () => {
    expect(getSlotPenalty(['DM', 'CM'], ['CM'])).toBe(0);
    expect(getSlotPenalty(['FW', 'ST'], ['AM', 'ST'])).toBe(0);
  });
});

describe('assignModule', () => {
  // A full 4-4-2-compatible squad plus an extra GK.
  const squad: EnrichedPlayer[] = [
    enriched(1, 'GK', 'GK', 50), enriched(2, 'GK', 'GK', 40),
    enriched(3, 'RB', 'DEF', 30), enriched(4, 'CB', 'DEF', 30), enriched(5, 'CB', 'DEF', 29), enriched(6, 'LB', 'DEF', 28),
    enriched(7, 'WB', 'DEF', 20), enriched(8, 'CM', 'MID', 35), enriched(9, 'DM', 'MID', 25), enriched(10, 'WB', 'DEF', 19),
    enriched(11, 'ST', 'FWD', 45), enriched(12, 'FW', 'FWD', 44),
  ];
  const m442 = MODULES.find((m) => m.name === '4-4-2')!;

  it('fills GK + 10 slots with unique players and picks the best GK', () => {
    const r = assignModule(squad, m442.slots)!;
    expect(r).not.toBeNull();
    expect(r.ids).toHaveLength(11);
    expect(r.ids[0]).toBe(1);
    expect(new Set(r.ids).size).toBe(11);
    expect(r.penalty).toHaveLength(11);
  });

  it('returns null when there is no goalkeeper or a slot cannot be filled', () => {
    expect(assignModule(squad.filter((p) => p.positionGroup !== 'GK'), m442.slots)).toBeNull();
    expect(assignModule(squad.filter((p) => p.mantraPositions[0] !== 'ST' && p.mantraPositions[0] !== 'FW'), m442.slots)).toBeNull();
  });
});

describe('effectiveScore', () => {
  it('does not change the score for pen = 0', () => {
    expect(effectiveScore(bd(42), 0)).toBe(42);
  });
  it('never raises the score for out-of-position penalties', () => {
    expect(effectiveScore(bd(42), -3)).toBeLessThanOrEqual(42);
  });
});

describe('defenceBonusPoints (tiers from the official rules)', () => {
  it.each([
    [6.0, 0], [6.99, 0], [7.0, 1], [7.24, 1], [7.25, 2], [7.49, 2], [7.5, 3], [7.74, 3], [7.75, 4], [7.99, 4], [8.0, 5], [9.5, 5],
  ])('average %f → %i', (avg, pts) => {
    expect(defenceBonusPoints(avg)).toBe(pts);
  });

  it("matches the rules page example: (6.4 + 8.1 + 7.8 + 7.2) / 4 = 7.375 → 2", () => {
    expect(defenceBonusPoints((6.4 + 8.1 + 7.8 + 7.2) / 4)).toBe(2);
  });
});

describe('defenderSlotIndexes', () => {
  const slotsOf = (name: string) => MODULES.find((m) => m.name === name)!.slots;

  it('counts the back line only: 4 in 4-x-x, 3 in 3-x-x (wing-backs excluded)', () => {
    expect(defenderSlotIndexes(slotsOf('4-3-3'))).toEqual([0, 1, 2, 3]);
    expect(defenderSlotIndexes(slotsOf('4-4-2'))).toEqual([0, 1, 2, 3]);
    expect(defenderSlotIndexes(slotsOf('3-4-3'))).toEqual([0, 1, 2]);
    expect(defenderSlotIndexes(slotsOf('3-5-2'))).toEqual([0, 1, 2]);
  });

  it('a slot that also accepts a non-defender is not a defender slot', () => {
    expect(defenderSlotIndexes([['CB'], ['CB', 'DM'], ['WB', 'W'], ['RB', 'CB']])).toEqual([0, 3]);
  });

  it('every formation has a 3- or 4-man back line', () => {
    for (const m of MODULES) expect([3, 4], m.name).toContain(defenderSlotIndexes(m.slots).length);
  });
});

describe('assignment defence bonus and score', () => {
  const m433 = MODULES.find((m) => m.name === '4-3-3')!;
  const withRating = (id: number, pos: MantraPosition, group: 'GK' | 'DEF' | 'MID' | 'FWD', total: number, baseRating: number): EnrichedPlayer => {
    const p = enriched(id, pos, group, total);
    return { ...p, scoreBreakdown: { ...p.scoreBreakdown, baseRating } } as EnrichedPlayer;
  };

  // ids: GK, then slots RB CB CB LB | DM/CM CM DM | W/FW FW/ST W/FW
  const roster = (defRating: number) => [
    withRating(1, 'GK', 'GK', 50, 6.5),
    withRating(2, 'RB', 'DEF', 30, defRating), withRating(3, 'CB', 'DEF', 30, defRating),
    withRating(4, 'CB', 'DEF', 30, defRating), withRating(5, 'LB', 'DEF', 30, defRating),
    withRating(6, 'DM', 'MID', 30, 6.0), withRating(7, 'CM', 'MID', 30, 6.0), withRating(8, 'DM', 'MID', 30, 6.0),
    withRating(9, 'W', 'FWD', 30, 6.0), withRating(10, 'ST', 'FWD', 30, 6.0), withRating(11, 'FW', 'FWD', 30, 6.0),
  ];
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const assignment = { ids, penalty: new Array(11).fill(0) };

  it('uses the average base rating of the defenders (not the goalkeeper or other lines)', () => {
    const byId = new Map(roster(7.6).map((p) => [p.id, p]));
    expect(assignmentDefenceBonus(assignment, byId, m433.slots)).toBe(3);   // 7.6 → 7.50–7.74
    expect(assignmentDefenceBonus(assignment, new Map(roster(6.5).map((p) => [p.id, p])), m433.slots)).toBe(0);
  });

  it('ignores the out-of-position malus (only the base score counts)', () => {
    const byId = new Map(roster(7.6).map((p) => [p.id, p]));
    const penalised = { ids, penalty: [0, -3, -3, -3, -3, 0, 0, 0, 0, 0, 0] };
    expect(assignmentDefenceBonus(penalised, byId, m433.slots)).toBe(3);
  });

  it('adds the bonus to the total at SCORE_UNITS_PER_MANTRA_POINT per point', () => {
    const lo = new Map(roster(6.5).map((p) => [p.id, p]));
    const hi = new Map(roster(8.0).map((p) => [p.id, p]));
    expect(assignmentScore(assignment, hi, m433.slots) - assignmentScore(assignment, lo, m433.slots))
      .toBeCloseTo(5 * SCORE_UNITS_PER_MANTRA_POINT);
  });
});

describe('pickBestModule', () => {
  // Squad that can only fill 3-back formations: no full-back (RB/LB) at all.
  const threeBackSquad: EnrichedPlayer[] = [
    enriched(1, 'GK', 'GK', 50),
    enriched(2, 'CB', 'DEF', 30), enriched(3, 'CB', 'DEF', 30), enriched(4, 'CB', 'DEF', 30),
    enriched(5, 'WB', 'DEF', 25), enriched(6, 'WB', 'DEF', 25),
    enriched(7, 'DM', 'MID', 30), enriched(8, 'CM', 'MID', 30), enriched(9, 'CM', 'MID', 30),
    enriched(10, 'W', 'FWD', 30), enriched(11, 'ST', 'FWD', 40), enriched(12, 'FW', 'FWD', 35), enriched(13, 'AM', 'MID', 30),
  ];

  it('chooses among feasible formations only and fills GK + 10 unique slots', () => {
    const r = pickBestModule(threeBackSquad)!;
    expect(r.moduleName.startsWith('3-')).toBe(true);
    expect(new Set(r.assignment.ids).size).toBe(11);
    expect(r.defenceBonus).toBeGreaterThanOrEqual(0);
    expect(r.defenceBonus).toBeLessThanOrEqual(5);
  });

  it('honours a pinned formation, and returns null when it is infeasible', () => {
    expect(pickBestModule(threeBackSquad, '3-5-2')?.moduleName).toBe('3-5-2');
    expect(pickBestModule(threeBackSquad, 'no-such-module')).toBeNull();
    // no goalkeeper → nothing is feasible
    expect(pickBestModule(threeBackSquad.filter((p) => p.positionGroup !== 'GK'))).toBeNull();
  });

  it('includes the defence bonus of the chosen back line', () => {
    const withBackLineRating = (rating: number) => threeBackSquad.map((p) =>
      p.mantraPositions[0] === 'CB'
        ? ({ ...p, scoreBreakdown: { ...p.scoreBreakdown, baseRating: rating } } as EnrichedPlayer)
        : p);
    expect(pickBestModule(withBackLineRating(6.5))!.defenceBonus).toBe(0);
    expect(pickBestModule(withBackLineRating(7.3))!.defenceBonus).toBe(2);
    expect(pickBestModule(withBackLineRating(8.2))!.defenceBonus).toBe(5);
  });
});
