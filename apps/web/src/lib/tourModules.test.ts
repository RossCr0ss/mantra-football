import { describe, expect, it } from 'vitest';
import { MODULES, getSlotPenalty, assignModule, effectiveScore, type EnrichedPlayer } from './tourModules';
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
