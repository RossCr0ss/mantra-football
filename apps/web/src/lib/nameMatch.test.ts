import { describe, expect, it } from 'vitest';
import { normalizeName, similarity, clubSimilarity, matchMantraPlayer } from './nameMatch';

describe('normalizeName', () => {
  it('strips diacritics, punctuation and case', () => {
    expect(normalizeName("  N'Golo  Kanté ")).toBe('n golo kante');
  });
});

describe('similarity', () => {
  it('is 1 for names equal after normalization and 0 for empty', () => {
    expect(similarity('Müller', 'muller')).toBe(1);
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('clubSimilarity', () => {
  it('treats substring club names as a strong match', () => {
    expect(clubSimilarity('Arsenal', 'Arsenal FC')).toBe(0.95);
  });
});

describe('matchMantraPlayer', () => {
  const candidates = [
    { fullName: 'Bukayo Saka', clubName: 'Arsenal' },
    { fullName: 'Martin Odegaard', clubName: 'Arsenal' },
    { fullName: 'Bukayo Saka', clubName: 'Chelsea' },
  ];

  it('picks the candidate with matching name and club', () => {
    const m = matchMantraPlayer({ name: 'Bukayo Saka', teamName: 'Arsenal' }, candidates);
    expect(m).toBe(candidates[0]);
  });

  it('matches accent/spelling variants', () => {
    const m = matchMantraPlayer({ name: 'Martin Ødegaard', teamName: 'Arsenal FC' }, candidates);
    expect(m?.fullName).toBe('Martin Odegaard');
  });

  it('returns null when nothing clears the threshold', () => {
    expect(matchMantraPlayer({ name: 'Zlatan Ibrahimovic', teamName: 'Milan' }, candidates)).toBeNull();
  });
});
