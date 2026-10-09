import { describe, expect, it } from 'vitest';
import { suggestAvailabilityPct, summarizeRecentForm } from './availabilitySuggestion';
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
