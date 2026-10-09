import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLeagueTeams, fetchTeamPlayers } from './teams';

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset(); });
const respond = (body: unknown, status = 200) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('fetchLeagueTeams', () => {
  it('maps table rows to teams with logo urls', async () => {
    respond({ table: [{ data: { table: { all: [{ id: '8456', name: 'Man City', shortName: 'MCI' }] } } }] });
    expect(await fetchLeagueTeams(47)).toEqual([
      { id: 8456, name: 'Man City', shortName: 'MCI', logoUrl: 'https://images.fotmob.com/image_resources/logo/teamlogo/8456.png' },
    ]);
  });

  it('returns [] on network errors and HTTP errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect(await fetchLeagueTeams(47)).toEqual([]);
    respond({}, 503);
    expect(await fetchLeagueTeams(47)).toEqual([]);
  });
});

describe('fetchTeamPlayers', () => {
  it('maps squad groups to positions, ignoring non-player groups (coach)', async () => {
    respond({
      squad: {
        squad: [
          { title: 'coach', members: [{ id: 1, name: 'Boss' }] },
          { title: 'keepers', members: [{ id: 2, name: 'Keeper', shirtNumber: 1, injured: true, rating: 6.8, ycards: 1 }] },
          { title: 'attackers', members: [{ id: 3, name: 'Striker', goals: 7, rcards: 1, positionIdsDesc: 'ST' }] },
        ],
      },
    });
    const players = await fetchTeamPlayers(9, 'Team');
    expect(players.map((p) => [p.id, p.position])).toEqual([[2, 'GK'], [3, 'FWD']]);
    expect(players[0]).toMatchObject({ injured: true, seasonRating: 6.8, yellowCards: 1, shirtNumber: 1, teamId: 9, teamName: 'Team' });
    expect(players[1]).toMatchObject({ goals: 7, redCards: 1, positionLabel: 'ST', seasonRating: null, injured: false });
  });

  it('falls back to the last lineup when squad.squad is null (smaller Ukrainian clubs), deduplicating players', async () => {
    respond({
      squad: { squad: null },
      overview: {
        lastLineupStats: {
          starters: [
            { id: 1, name: 'GK', usualPlayingPositionId: 0, shirtNumber: '1' },
            { id: 2, name: 'Defender', usualPlayingPositionId: 1 },
          ],
          subs: [{ id: 2, name: 'Defender again' }, { id: 3, name: 'No group', positionId: 11 }, { name: 'no id' }],
        },
      },
    });
    const players = await fetchTeamPlayers(9, 'Team');
    expect(players.map((p) => [p.id, p.position])).toEqual([[1, 'GK'], [2, 'DEF'], [3, 'GK']]);
    expect(players[0].shirtNumber).toBe(1);
  });

  it('returns [] when neither a squad nor a lineup is available, and throws on HTTP errors', async () => {
    respond({ squad: { squad: null } });
    expect(await fetchTeamPlayers(9, 'T')).toEqual([]);
    respond({}, 500);
    await expect(fetchTeamPlayers(9, 'T')).rejects.toThrow('500');
  });
});
