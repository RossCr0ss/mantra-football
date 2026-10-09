import { beforeEach, describe, expect, it, vi } from 'vitest';

const overrides: Record<string, unknown>[] = [];
let squadPlayer: Record<string, unknown> | null = null;

vi.mock('./mongodb', () => ({
  getDb: async () => ({
    collection: (name: string) => ({
      findOne: async (f: { playerId?: number }) =>
        name === 'player_injuries'
          ? overrides.find((o) => o.playerId === f.playerId) ?? null
          : squadPlayer ? { players: [squadPlayer] } : null,
      find: (f: { playerId: { $in: number[] } }) => ({
        toArray: async () => overrides.filter((o) => f.playerId.$in.includes(o.playerId as number)),
      }),
    }),
  }),
}));
vi.mock('./mongoCache', () => ({ deleteCache: vi.fn() }));
vi.mock('./fotmobCache', () => ({ getTeamPlayersCached: vi.fn() }));

import { getTeamPlayersCached } from './fotmobCache';
import { getPlayerInjury, getPlayerInjuriesBatch, fetchPlayerInjuryFresh } from './injuries';

const team = vi.mocked(getTeamPlayersCached);
const fm = (id: number, injured: boolean) => ({ id, injured }) as never;

beforeEach(() => {
  overrides.length = 0; squadPlayer = null; vi.clearAllMocks();
});

describe('getPlayerInjury', () => {
  it('prefers a manual override over live FotMob data', async () => {
    overrides.push({ playerId: 1, name: 'Hamstring', expectedReturnDate: '2026-11-01', lastUpdated: 'x' });
    squadPlayer = { teamId: 9, teamName: 'T' };
    team.mockResolvedValue([fm(1, false)]);
    expect(await getPlayerInjury(1)).toMatchObject({ name: 'Hamstring', expectedReturnDate: '2026-11-01', overridden: true });
    expect(team).not.toHaveBeenCalled();
  });

  it('a "cleared" override suppresses a live injury', async () => {
    overrides.push({ playerId: 1, cleared: true, lastUpdated: 'L' });
    squadPlayer = { teamId: 9, teamName: 'T' };
    team.mockResolvedValue([fm(1, true)]);
    expect(await getPlayerInjury(1)).toMatchObject({ name: 'Manually healed', cleared: true, overridden: true, lastUpdated: 'L' });
  });

  it('falls back to live team data (injured flag) and returns null when healthy or unknown', async () => {
    squadPlayer = { teamId: 9, teamName: 'T' };
    team.mockResolvedValue([fm(1, true), fm(2, false)]);
    expect(await getPlayerInjury(1)).toMatchObject({ name: 'Injured' });
    expect(await getPlayerInjury(2)).toBeNull();
    expect(await getPlayerInjury(3)).toBeNull();      // not in team list
    squadPlayer = null;
    expect(await getPlayerInjury(1)).toBeNull();      // not in any squad
  });

  it('treats a failing team fetch as "no injury"', async () => {
    squadPlayer = { teamId: 9, teamName: 'T' };
    team.mockRejectedValue(new Error('down'));
    expect(await getPlayerInjury(1)).toBeNull();
  });
});

describe('getPlayerInjuriesBatch', () => {
  it('returns {} for no players', async () => {
    expect(await getPlayerInjuriesBatch([])).toEqual({});
  });

  it('applies overrides, fetches each team once and skips teams whose players all have overrides', async () => {
    overrides.push({ playerId: 1, name: 'Knee' }, { playerId: 4, cleared: true });
    team.mockImplementation(async (teamId: number) => (teamId === 10 ? [fm(2, true), fm(3, false)] : []));

    const r = await getPlayerInjuriesBatch([
      { id: 1, teamId: 10, teamName: 'A' },
      { id: 2, teamId: 10, teamName: 'A' },
      { id: 3, teamId: 10, teamName: 'A' },
      { id: 4, teamId: 20, teamName: 'B' },
    ]);

    expect(r[1]).toMatchObject({ name: 'Knee', overridden: true });
    expect(r[2]).toMatchObject({ name: 'Injured' });
    expect(r[3]).toBeNull();
    expect(r[4]).toMatchObject({ cleared: true });
    expect(team).toHaveBeenCalledTimes(1);          // team 20 skipped: its only player has an override
    expect(team).toHaveBeenCalledWith(10, 'A');
  });

  it('a failing team fetch yields nulls instead of throwing', async () => {
    team.mockRejectedValue(new Error('down'));
    const r = await getPlayerInjuriesBatch([{ id: 1, teamId: 10, teamName: 'A' }]);
    expect(r[1]).toBeNull();
  });
});

describe('fetchPlayerInjuryFresh', () => {
  it('ignores overrides and reads live data', async () => {
    overrides.push({ playerId: 1, cleared: true });
    squadPlayer = { teamId: 9, teamName: 'T' };
    team.mockResolvedValue([fm(1, true)]);
    expect(await fetchPlayerInjuryFresh(1)).toMatchObject({ name: 'Injured' });
  });
});
