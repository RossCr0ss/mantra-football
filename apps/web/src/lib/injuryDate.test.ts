import { describe, expect, it } from 'vitest';
import { isInjuryListed, isShownHealed } from './injuryDate';
import type { PlayerInjuryInfo } from '@/lib/fotmob';

const live: PlayerInjuryInfo = { name: 'Injured', expectedReturn: null, expectedReturnDate: null, lastUpdated: null };
const healed: PlayerInjuryInfo = { ...live, name: 'Manually healed', overridden: true, cleared: true };

describe('isInjuryListed', () => {
  it('lists an active injury record', () => {
    expect(isInjuryListed({}, live)).toBe(true);
  });
  it('does not list a healed player', () => {
    expect(isInjuryListed({}, healed)).toBe(false);
    expect(isInjuryListed({}, null)).toBe(false);
  });
  it('lists a manually injured player even when healed or without a record', () => {
    expect(isInjuryListed({ lineupStatus: 'injured' }, healed)).toBe(true);
    expect(isInjuryListed({ lineupStatus: 'injured' }, undefined)).toBe(true);
  });
  it('does not list a suspended player by itself', () => {
    expect(isInjuryListed({ lineupStatus: 'suspended' }, null)).toBe(false);
  });
});

describe('isShownHealed', () => {
  it('shows the badge for a healed, available player', () => {
    expect(isShownHealed({}, healed)).toBe(true);
  });
  it('hides it once the player is marked injured again', () => {
    expect(isShownHealed({ lineupStatus: 'injured' }, healed)).toBe(false);
  });
  it('hides it without a cleared record', () => {
    expect(isShownHealed({}, live)).toBe(false);
    expect(isShownHealed({}, null)).toBe(false);
  });
});
