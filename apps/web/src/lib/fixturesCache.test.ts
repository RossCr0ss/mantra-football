import { beforeEach, describe, expect, it, vi } from 'vitest';

type Doc = { data: unknown; cachedAt: Date; [k: string]: unknown };
let doc: Doc | null = null;
const col = {
  findOne: vi.fn(async () => doc),
  updateOne: vi.fn(async (_f: unknown, u: { $set: Doc }) => { doc = u.$set; }),
};
vi.mock('./mongodb', () => ({ getDb: async () => ({ collection: () => col }) })); // no MONGODB_URI needed
vi.mock('./fotmob', () => ({ fetchLeagueData: vi.fn() }));

import { fetchLeagueData } from './fotmob';
import { buildTeamFixtures, getLeagueFixturesCached } from './fixturesCache';
import { MIN_FORCE_REFRESH_MS } from './mongoCache';
import { makeMatch } from './testUtils';

// 20-team table: team id N sits at position N
const positions = new Map<number, number>(Array.from({ length: 20 }, (_, i) => [i + 1, i + 1]));

describe('buildTeamFixtures', () => {
  it('computes difficulty from opponent table position (1 = hardest … 5 = easiest)', () => {
    const matches = [
      makeMatch({ matchId: 'a', homeId: 10, awayId: 1 }),   // opponent top → 1
      makeMatch({ matchId: 'b', homeId: 11, awayId: 20 }),  // opponent bottom → 5
    ];
    expect(buildTeamFixtures(10, matches, positions, '1')[0]).toMatchObject({ isHome: true, difficulty: 1 });
    expect(buildTeamFixtures(11, matches, positions, '1')[0].difficulty).toBe(5);
  });

  it('marks away fixtures and returns null difficulty for unknown opponents', () => {
    const matches = [makeMatch({ matchId: 'a', homeId: 99, awayId: 10 })];
    const f = buildTeamFixtures(10, matches, positions, '1')[0];
    expect(f.isHome).toBe(false);
    expect(f.opponent.id).toBe(99);
    expect(f.difficulty).toBeNull();
  });

  it('skips finished matches and falls back to the next unfinished one when the round has none', () => {
    const matches = [
      makeMatch({ matchId: 'old', homeId: 10, awayId: 2, finished: true, round: '1' }),
      makeMatch({ matchId: 'next', homeId: 10, awayId: 3, round: '5', date: '2026-02-01T15:00:00Z' }),
      makeMatch({ matchId: 'later', homeId: 4, awayId: 10, round: '6', date: '2026-03-01T15:00:00Z' }),
    ];
    expect(buildTeamFixtures(10, matches, positions, '1')[0].matchId).toBe('next');
    expect(buildTeamFixtures(10, matches, positions, null, 2).map((f) => f.matchId)).toEqual(['next', 'later']);
  });
});

describe('getLeagueFixturesCached', () => {
  const fetchMock = vi.mocked(fetchLeagueData);
  const league = () => ({
    tablePositions: new Map([[1, 1], [2, 2]]),
    matches: [makeMatch({ matchId: 'a', homeId: 1, awayId: 2 })],
    currentRound: '7',
  });

  beforeEach(() => { doc = null; vi.clearAllMocks(); });

  it('fetches on a miss, stores a Mongo-safe doc and returns a Map of table positions with cachedAt', async () => {
    fetchMock.mockResolvedValue(league());
    const r = await getLeagueFixturesCached(47);
    expect(r.tablePositions).toEqual(new Map([[1, 1], [2, 2]]));
    expect(r.matches).toHaveLength(1);
    expect(r.currentRound).toBe('7');
    expect(r.cachedAt).toBeInstanceOf(Date);
    expect((doc!.data as { tablePositions: unknown }).tablePositions).toEqual({ '1': 1, '2': 2 });
  });

  it('serves a fresh cache without fetching again', async () => {
    fetchMock.mockResolvedValue(league());
    await getLeagueFixturesCached(47);
    await getLeagueFixturesCached(47);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throttles forceRefresh right after a refresh, but honours it once the doc is older', async () => {
    fetchMock.mockResolvedValue(league());
    await getLeagueFixturesCached(47);
    await getLeagueFixturesCached(47, { forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);                       // throttled

    doc!.cachedAt = new Date(Date.now() - MIN_FORCE_REFRESH_MS - 1000);
    await getLeagueFixturesCached(47, { forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);                       // allowed
  });

  it('returns an empty result (no throw) when FotMob fails and nothing is cached', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    expect(await getLeagueFixturesCached(47)).toEqual({ matches: [], tablePositions: new Map(), currentRound: null, cachedAt: null });
  });

  it('never caches an empty FotMob answer (HTTP error looks like empty data)', async () => {
    fetchMock.mockResolvedValue({ tablePositions: new Map(), matches: [], currentRound: null });
    expect((await getLeagueFixturesCached(47)).matches).toEqual([]);
    expect(doc).toBeNull();
  });

  it('serves stale data when a refresh fails', async () => {
    fetchMock.mockResolvedValue(league());
    await getLeagueFixturesCached(47);
    doc!.cachedAt = new Date(Date.now() - 24 * 3_600_000);            // older than staleMs
    fetchMock.mockRejectedValue(new Error('down'));
    expect((await getLeagueFixturesCached(47)).matches).toHaveLength(1);
  });
});
