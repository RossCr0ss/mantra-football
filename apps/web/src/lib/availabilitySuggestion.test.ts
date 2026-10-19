import { describe, expect, it } from 'vitest';
import { planAvailabilityReset, suggestAvailabilityPct, summarizeRecentForm } from './availabilitySuggestion';
import { makeForm } from './testUtils';

describe('suggestAvailabilityPct', () => {
  it('returns null without data', () => {
    expect(suggestAvailabilityPct([])).toBeNull();
  });

  it('is 100 for a full-90 starter and 0 for a player who never featured', () => {
    expect(suggestAvailabilityPct([makeForm(), makeForm(), makeForm()])).toBe(100);
    expect(suggestAvailabilityPct([makeForm({ started: false, minutesPlayed: 0 }), makeForm({ started: false, minutesPlayed: null })])).toBe(0);
  });

  it('weights start rate and minutes equally and rounds to 5', () => {
    // 1/2 started (0.5), minutes 45/180... = (90+0)/(2*90)=0.5 → 50
    expect(suggestAvailabilityPct([makeForm(), makeForm({ started: false, minutesPlayed: 0 })])).toBe(50);
    // sub who played 30': start 0, minutes 30/90=0.333 → 16.7 → 15
    expect(suggestAvailabilityPct([makeForm({ started: false, minutesPlayed: 30 })])).toBe(15);
  });
});

describe('summarizeRecentForm', () => {
  const matches = [
    makeForm({ goals: 1, assists: 0, goalsAgainst: 0, started: true }),
    makeForm({ goals: 0, assists: 2, goalsAgainst: 0, started: false }),
    makeForm({ goals: 2, assists: 1, goalsAgainst: 1, started: true }),
  ];

  it('sums goals and assists', () => {
    expect(summarizeRecentForm(matches, 'FWD')).toEqual({ goalsRecent: 3, assistsRecent: 3, cleanSheetsRecent: 0 });
  });

  it('counts clean sheets only for goalkeepers and only started matches', () => {
    expect(summarizeRecentForm(matches, 'GK').cleanSheetsRecent).toBe(1);
  });
});

describe('planAvailabilityReset', () => {
  it('suggests for manual players with a suggestion, clears those without, skips the rest', () => {
    const plan = planAvailabilityReset(
      [
        { id: 1, availabilityPctSource: 'manual' },
        { id: 2, availabilityPctSource: 'manual' },
        { id: 3, availabilityPctSource: 'suggested' },
        { id: 4 },
      ],
      { 1: 80, 2: null, 3: 50, 4: 50 },
    );
    expect(plan).toEqual([
      { playerId: 1, action: 'suggest', pct: 80 },
      { playerId: 2, action: 'clear' },
    ]);
  });
  it('keeps a suggested 0 instead of clearing it', () => {
    expect(planAvailabilityReset([{ id: 1, availabilityPctSource: 'manual' }], { 1: 0 })).toEqual([
      { playerId: 1, action: 'suggest', pct: 0 },
    ]);
  });
});
