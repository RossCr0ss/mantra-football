import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPlayerRecentMatches, lastClubMatches } from './players';
import { suggestAvailabilityPct } from '../availabilitySuggestion';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); fetchMock.mockReset(); });

const CLUB = 9988;
const raw = (id: number, date: string, o: Record<string, unknown> = {}) => ({
  id, teamId: CLUB, leagueName: 'First Division A', matchDate: { utcTime: date }, isHomeTeam: true,
  homeScore: 1, awayScore: 0, minutesPlayed: 90, playedInMatch: true, onBench: false,
  ratingProps: { rating: '7.0' }, ...o,
});
const bench = { minutesPlayed: 0, playedInMatch: false, onBench: true, ratingProps: { rating: 0 } };

// Shape of the real playerData.recentMatches (Yuto Tsunashima, Oct 2026): newest first, sat out the last 4 matches.
const tsunashima = [
  raw(10, '2026-10-24T14:00:00.000Z', bench),
  raw(9, '2026-10-17T15:30:00.000Z', { ...bench, leagueName: 'Belgian Cup' }),
  raw(8, '2026-10-11T16:30:00.000Z', { minutesPlayed: 6, ratingProps: { rating: 0 } }),
  raw(7, '2026-09-20T11:30:00.000Z', bench),
  raw(6, '2026-09-13T11:30:00.000Z', { ratingProps: { rating: '6.2' } }),
  raw(5, '2026-09-05T18:45:00.000Z', { ratingProps: { rating: '7.4' } }),
  raw(4, '2026-08-30T14:00:00.000Z', { ratingProps: { rating: '5.4' } }),
  raw(3, '2026-08-22T18:45:00.000Z'),
  raw(2, '2026-08-09T17:15:00.000Z'),
  raw(1, '2026-07-04T09:00:00.000Z', { ...bench, leagueName: 'Club Friendlies' }),
  raw(0, '2026-05-23T18:45:00.000Z'),
];

describe('lastClubMatches', () => {
  const start = new Date(2026, 6, 1);

  it('takes the 5 NEWEST competitive club matches of the season, oldest first', () => {
    expect(lastClubMatches(tsunashima, CLUB, start).map((m) => m.id)).toEqual([6, 7, 8, 9, 10]);
  });

  it('does not depend on the order FotMob returns', () => {
    const shuffled = [...tsunashima].reverse();
    expect(lastClubMatches(shuffled, CLUB, start).map((m) => m.id)).toEqual([6, 7, 8, 9, 10]);
  });

  it('drops friendlies, last season and other teams (national team)', () => {
    const withNational = [raw(99, '2026-10-28T19:00:00.000Z', { teamId: 1, leagueName: 'World Cup Qualification' }), ...tsunashima];
    const ids = lastClubMatches(withNational, CLUB, start).map((m) => m.id);
    expect(ids).not.toContain(99);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(0);
  });
});

describe('fetchPlayerRecentMatches', () => {
  it('reads a player who has sat out recent matches as a rotation player, not an ever-present', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ primaryTeam: { teamId: CLUB }, recentMatches: tsunashima })));
    const matches = await fetchPlayerRecentMatches(1437306);
    expect(matches.map((m) => m.matchId)).toEqual(['6', '7', '8', '9', '10']);
    expect(matches.map((m) => m.started)).toEqual([true, false, false, false, false]); // the 6-minute cameo is a sub
    expect(matches.map((m) => m.rating)).toEqual([6.2, null, null, null, null]);
    // 1 start of 5, 96 of 450 minutes → (0.2 + 0.213) / 2 ≈ 20 %  (the buggy window of the 5 oldest matches gave 100 %)
    expect(suggestAvailabilityPct(matches)).toBe(20);
  });
});
