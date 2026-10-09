import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerSeasonStats } from '@/lib/fotmob';

vi.mock('@/lib/fotmobCache', () => ({
  getLeagueTeamsCached: vi.fn(),
  getTeamPlayerStatsCached: vi.fn(),
  getLeagueRatingStatsCached: vi.fn(),
  getLeagueSeasonIdCached: vi.fn(),
  getLeaguePreviousSeasonIdCached: vi.fn(),
  getLeagueAllPlayerStatsCached: vi.fn(),
}));

import * as cache from '@/lib/fotmobCache';
import { getSquadSeasonStats, getSquadPriorSeasonStats } from './squadStats';
import { makePlayer } from './testUtils';

const m = vi.mocked(cache);
const stats = (o: Partial<PlayerSeasonStats>) => ({ playerId: 1, rating: 6.5, goals: 1, ...o }) as PlayerSeasonStats;

beforeEach(() => vi.resetAllMocks());

describe('getSquadSeasonStats', () => {
  it('returns an empty map for an empty squad without hitting the cache', async () => {
    expect((await getSquadSeasonStats(47, [])).size).toBe(0);
    expect(m.getLeagueTeamsCached).not.toHaveBeenCalled();
  });

  it('merges team stats ← rating.json ← CDN stats, ignoring null CDN values', async () => {
    m.getLeagueTeamsCached.mockResolvedValue([]);
    m.getTeamPlayerStatsCached.mockResolvedValue(new Map([[1, stats({ goals: 1 })]]));
    m.getLeagueSeasonIdCached.mockResolvedValue('22889');
    m.getLeagueRatingStatsCached.mockResolvedValue(new Map([[1, { leagueRank: 3, matchesPlayed: 10, minutesPlayed: 800, rating: 7 }]]));
    m.getLeagueAllPlayerStatsCached.mockResolvedValue(new Map([[1, { goals: 5, assists: null as unknown as number, tackles: 12 }]]));

    const res = await getSquadSeasonStats(47, [makePlayer({ id: 1, teamId: 9 })]);
    expect(res.get(1)).toMatchObject({ leagueRank: 3, matchesPlayed: 10, minutesPlayed: 800, goals: 5, tackles: 12 });
    expect(res.get(1)?.assists).toBeUndefined();
  });

  it('survives a failing teams lookup', async () => {
    m.getLeagueTeamsCached.mockRejectedValue(new Error('boom'));
    m.getTeamPlayerStatsCached.mockResolvedValue(new Map());
    m.getLeagueSeasonIdCached.mockResolvedValue(null);
    await expect(getSquadSeasonStats(47, [makePlayer({ id: 1, teamId: 9 })])).resolves.toBeInstanceOf(Map);
  });
});

describe('getSquadPriorSeasonStats', () => {
  it('returns empty when no previous season exists', async () => {
    m.getLeaguePreviousSeasonIdCached.mockResolvedValue(null);
    expect((await getSquadPriorSeasonStats(47, [makePlayer({ id: 1 })])).size).toBe(0);
  });

  it('keeps only squad players and estimates matchesPlayed from minutes when rating.json lacks the player', async () => {
    m.getLeaguePreviousSeasonIdCached.mockResolvedValue('21000');
    m.getLeagueRatingStatsCached.mockResolvedValue(new Map([[2, { leagueRank: 1, matchesPlayed: 30, minutesPlayed: 2700, rating: 7.1 }]]));
    m.getLeagueAllPlayerStatsCached.mockResolvedValue(new Map<number, Partial<PlayerSeasonStats>>([
      [1, { minutesPlayed: 990, tackles: 20 }],
      [2, { goals: 4 }],
      [99, { goals: 9 }],
    ]));
    const res = await getSquadPriorSeasonStats(47, [makePlayer({ id: 1 }), makePlayer({ id: 2 })]);
    expect(res.has(99)).toBe(false);
    expect(res.get(1)?.matchesPlayed).toBe(11);      // round(990/90)
    expect(res.get(2)).toMatchObject({ matchesPlayed: 30, rating: 7.1, goals: 4 });
  });
});
