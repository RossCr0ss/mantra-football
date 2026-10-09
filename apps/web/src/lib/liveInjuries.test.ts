import { describe, expect, it } from 'vitest';
import { applyLiveInjuries } from './liveInjuries';
import { isInjuryActive } from './injuryDate';
import { calcScore, computeTeamForm } from './tourScoring';
import { makePlayer } from './testUtils';
import type { PlayerInjuryInfo } from '@/lib/fotmob';

const NOW = new Date(2026, 9, 9, 15, 30);                    // 9 Oct 2026, local time
const info = (o: Partial<PlayerInjuryInfo> = {}): PlayerInjuryInfo =>
  ({ name: 'Injured', expectedReturn: null, expectedReturnDate: null, lastUpdated: null, ...o });

describe('isInjuryActive', () => {
  it('is active for a live FotMob flag (no date) and for a future return date', () => {
    expect(isInjuryActive(info(), NOW)).toBe(true);
    expect(isInjuryActive(info({ expectedReturnDate: '2026-10-10' }), NOW)).toBe(true);
    expect(isInjuryActive(info({ expectedReturnDate: 'not-a-date' }), NOW)).toBe(true);
  });

  it('is over when healed, or when the return date is today or in the past', () => {
    expect(isInjuryActive(info({ cleared: true, overridden: true }), NOW)).toBe(false);
    expect(isInjuryActive(info({ expectedReturnDate: '2026-10-09' }), NOW)).toBe(false);
    expect(isInjuryActive(info({ expectedReturnDate: '2026-09-01' }), NOW)).toBe(false);
  });

  it('is not active without a record', () => {
    expect(isInjuryActive(null, NOW)).toBe(false);
    expect(isInjuryActive(undefined, NOW)).toBe(false);
  });
});

describe('applyLiveInjuries', () => {
  const squad = [makePlayer({ id: 1 }), makePlayer({ id: 2 }), makePlayer({ id: 3 }), makePlayer({ id: 4, lineupStatus: 'suspended' })];

  it('marks players with an active injury as injured (source auto) and leaves the rest alone', () => {
    const out = applyLiveInjuries(squad, { 1: info(), 2: info({ cleared: true }), 4: info() }, NOW);
    expect(out[0]).toMatchObject({ id: 1, lineupStatus: 'injured', lineupStatusSource: 'auto' });
    expect(out[1].lineupStatus).toBeUndefined();            // healed
    expect(out[2]).toBe(squad[2]);                            // no record → same object
    expect(out[3].lineupStatus).toBe('suspended');            // manual status wins
  });

  it('does not mutate the input squad', () => {
    applyLiveInjuries(squad, { 1: info() }, NOW);
    expect(squad[0].lineupStatus).toBeUndefined();
  });

  it('a live-injured player is excluded from scoring (−999) like a manual injury', () => {
    const [p] = applyLiveInjuries([makePlayer({ id: 1 })], { 1: info() }, NOW);
    expect(calcScore(p, null, null, null, [], computeTeamForm([])).total).toBe(-999);
  });
});
