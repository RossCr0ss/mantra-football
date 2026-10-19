import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeagueMatch, TeamFixture } from './fotmob';

let stored: Record<string, unknown> | null = null;
const updateOne = vi.fn(async (_f: unknown, u: { $set: Record<string, unknown> }) => { stored = { ...(stored ?? {}), ...u.$set }; });
vi.mock('./mongodb', () => ({ getDb: async () => ({ collection: () => ({ findOne: async () => stored, updateOne }) }) }));
vi.mock('./fotmob', () => ({ fetchLeagueSeasonData: vi.fn(), fetchMatchXg: vi.fn() }));

import { fetchLeagueSeasonData, fetchMatchXg } from './fotmob';
import { attachStrength, getTeamRatings, refreshTeamRatings } from './teamRatings';
import { emptyRatingState } from './teamStrength';

const season = vi.mocked(fetchLeagueSeasonData);
const xg = vi.mocked(fetchMatchXg);
const match = (id: string, date: string, h: number, a: number, hs: number | null, as_: number | null, finished = true): LeagueMatch => ({
  matchId: id, date, round: '1', finished, homeScore: hs, awayScore: as_,
  homeTeam: { id: h, name: `T${h}`, logoUrl: '' }, awayTeam: { id: a, name: `T${a}`, logoUrl: '' },
});

beforeEach(() => { stored = null; vi.clearAllMocks(); });

describe('refreshTeamRatings', () => {
  it('bootstraps from last season (goals only), then adds the current season with xG, oldest match first', async () => {
    season.mockImplementation(async (_id, s) => s
      ? { season: s, previousSeason: null, matches: [match('1', '2026-05-01T12:00:00Z', 1, 2, 2, 0)] }
      : { season: '2026/2027', previousSeason: '2025/2026', matches: [
          match('3', '2026-09-02T12:00:00Z', 2, 1, 1, 1), match('2', '2026-08-20T12:00:00Z', 1, 2, 3, 0), match('4', '2026-09-20T12:00:00Z', 1, 2, null, null, false)] });
    xg.mockResolvedValue({ home: 1.5, away: 0.5 });
    await refreshTeamRatings(47);
    expect(season).toHaveBeenCalledWith(47, '2025/2026');
    expect(xg.mock.calls.map((c) => c[0]).sort()).toEqual(['2', '3']);     // current season only, finished only
    expect((stored!.processed as string[]).sort()).toEqual(['1', '2', '3']);
    expect(stored!.season).toBe('2026/2027');
  });

  it('only processes new matches on later runs and never re-bootstraps', async () => {
    season.mockResolvedValue({ season: '2026/2027', previousSeason: '2025/2026', matches: [match('2', '2026-08-20T12:00:00Z', 1, 2, 3, 0)] });
    xg.mockResolvedValue({ home: null, away: null });
    await refreshTeamRatings(47);
    season.mockClear(); xg.mockClear();
    season.mockResolvedValue({ season: '2026/2027', previousSeason: '2025/2026', matches: [match('2', '2026-08-20T12:00:00Z', 1, 2, 3, 0), match('5', '2026-09-03T12:00:00Z', 2, 1, 0, 0)] });
    await refreshTeamRatings(47);
    expect(season).toHaveBeenCalledTimes(1);
    expect(xg.mock.calls.map((c) => c[0])).toEqual(['5']);
  });
});

describe('getTeamRatings / attachStrength', () => {
  it('returns null without stored ratings (and starts a background refresh)', async () => {
    season.mockResolvedValue({ season: null, previousSeason: null, matches: [] });
    expect(await getTeamRatings(40)).toBeNull();
  });

  it('adds probabilities from the team\'s point of view', () => {
    const f = { ...match('9', '2026-10-25T12:00:00Z', 1, 2, null, null, false), isHome: false, opponent: { id: 1, name: '', logoUrl: '' }, difficulty: 3, odds: null } as TeamFixture;
    const out = attachStrength({ 2: [f] }, { state: emptyRatingState(), season: '2026/2027' });
    const s = out[2][0].strength!;
    expect(s.win + s.draw + s.loss).toBeCloseTo(1, 10);
    expect(s.loss).toBeGreaterThan(s.win);          // away side without any rating loses the home advantage
    expect(attachStrength({ 2: [f] }, null)[2][0].strength).toBeUndefined();
  });
});
