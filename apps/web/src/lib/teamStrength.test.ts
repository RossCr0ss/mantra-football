import { describe, expect, it } from 'vitest';
import golden from './teamStrength.golden.json';
import { applyMatch, emptyRatingState, matchFeatures, predictOutcome } from './teamStrength';

describe('teamStrength — replays the python reference (scripts/weights-research/match_model.py)', () => {
  it('reproduces the pre-match Elo difference, expected goals and 1X2 probabilities', () => {
    const s = emptyRatingState();
    const byIndex = new Map(golden.expected.map((e) => [e.i, e]));
    let checked = 0;
    golden.matches.forEach((m, i) => {
      const e = byIndex.get(i);
      if (e) {
        const f = matchFeatures(s, m.h, m.a, m.season);
        expect(f.eloDiff).toBeCloseTo(e.elo_diff, 6);
        expect(f.lamHome).toBeCloseTo(e.lam_h, 6);
        expect(f.lamAway).toBeCloseTo(e.lam_a, 6);
        const p = predictOutcome(s, m.h, m.a, m.season);
        expect(p.home).toBeCloseTo(e.p[0], 3);
        expect(p.draw).toBeCloseTo(e.p[1], 3);
        expect(p.away).toBeCloseTo(e.p[2], 3);
        checked++;
      }
      applyMatch(s, { season: m.season, homeId: m.h, awayId: m.a, homeScore: m.hs, awayScore: m.as_, homeXg: m.hxg, awayXg: m.axg });
    });
    expect(checked).toBe(golden.expected.length);
  });
});

describe('teamStrength — behaviour', () => {
  const play = (s: ReturnType<typeof emptyRatingState>, h: number, a: number, hs: number, as_: number, season = '2026/2027') =>
    applyMatch(s, { season, homeId: h, awayId: a, homeScore: hs, awayScore: as_ });

  it('starts neutral with a home advantage', () => {
    const p = predictOutcome(emptyRatingState(), 1, 2, '2026/2027');
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 10);
    expect(p.home).toBeGreaterThan(p.away);
  });

  it('rates a team that keeps winning above its opponents', () => {
    const s = emptyRatingState();
    for (let i = 0; i < 6; i++) { play(s, 1, 2, 3, 0); play(s, 3, 1, 0, 2); }
    const strong = predictOutcome(s, 1, 4, '2026/2027');
    const weak = predictOutcome(s, 4, 1, '2026/2027');
    expect(strong.home).toBeGreaterThan(0.6);
    expect(weak.away).toBeGreaterThan(weak.home);
  });

  it('pulls ratings back towards 1500 in a new season without mutating the state on prediction', () => {
    const s = emptyRatingState();
    for (let i = 0; i < 8; i++) play(s, 1, 2, 3, 0, '2025/2026');
    const before = JSON.stringify(s);
    const sameSeason = matchFeatures(s, 1, 2, '2025/2026').eloDiff;
    const nextSeason = matchFeatures(s, 1, 2, '2026/2027').eloDiff;
    expect(Math.abs(nextSeason)).toBeLessThan(Math.abs(sameSeason));
    expect(JSON.stringify(s)).toBe(before);
  });

  it('falls back to goals when the xG of a match is unknown', () => {
    const a = emptyRatingState(); const b = emptyRatingState();
    applyMatch(a, { season: 's', homeId: 1, awayId: 2, homeScore: 2, awayScore: 1 });
    applyMatch(b, { season: 's', homeId: 1, awayId: 2, homeScore: 2, awayScore: 1, homeXg: 2, awayXg: 1 });
    expect(a).toEqual(b);
  });
});
