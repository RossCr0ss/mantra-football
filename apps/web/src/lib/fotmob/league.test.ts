import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractTableRows, fetchLeagueData } from './league';

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset(); });

const row = (id: number | string, name = `T${id}`) => ({ id, name, shortName: name.slice(0, 3) });
const respond = (body: unknown, status = 200) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('extractTableRows', () => {
  it('reads the standard single-table shape', () => {
    expect(extractTableRows({ table: { all: [row(1), row(2)] } }).map((r) => r.id)).toEqual([1, 2]);
  });

  it('aggregates unique teams from split tables (Belgium), even with string ids', () => {
    const rows = extractTableRows({
      tables: [{ table: { all: [row(1), row(2)] } }, { table: { all: [row('2'), row(3)] } }],
    });
    expect(rows.map((r) => Number(r.id))).toEqual([1, 2, 3]);
  });

  it('returns [] for missing / empty / malformed data', () => {
    expect(extractTableRows(null)).toEqual([]);
    expect(extractTableRows({ table: { all: [] } })).toEqual([]);
    expect(extractTableRows({ tables: 'x' })).toEqual([]);
  });
});

describe('fetchLeagueData', () => {
  const match = (over: Record<string, unknown>) => ({
    id: 'm1',
    round: 5,
    home: { id: '10', name: 'Home' },
    away: { id: '20', name: 'Away' },
    status: { utcTime: '2026-10-01T15:00:00Z', finished: true, scoreStr: '2 - 1' },
    ...over,
  });

  it('builds table positions, parses string ids and scoreStr, and finds the current round via firstUnplayedMatch', async () => {
    respond({
      table: [{ data: { table: { all: [row(10), row(20), row(30)] } } }],
      fixtures: {
        allMatches: [
          match({}),
          match({ id: 'm2', round: undefined, roundName: 'Final', status: { utcTime: '2026-11-01T15:00:00Z', finished: false } }),
        ],
        firstUnplayedMatch: { firstUnplayedMatchId: 'm2' },
      },
    });

    const r = await fetchLeagueData(47);
    expect(Array.from(r.tablePositions)).toEqual([[10, 1], [20, 2], [30, 3]]);
    expect(r.matches[0]).toMatchObject({
      matchId: 'm1', round: '5', finished: true, homeScore: 2, awayScore: 1,
      homeTeam: { id: 10, name: 'Home' }, awayTeam: { id: 20 },
    });
    expect(r.matches[1]).toMatchObject({ round: 'Final', finished: false, homeScore: null, awayScore: null });
    expect(r.currentRound).toBe('Final');
  });

  it('falls back to home.score/away.score and tolerates garbage scoreStr', async () => {
    respond({
      table: [],
      fixtures: {
        allMatches: [
          match({ id: 'a', status: { finished: true }, home: { id: 1, name: 'H', score: 3 }, away: { id: 2, name: 'A', score: '0' } }),
          match({ id: 'b', status: { finished: true, scoreStr: 'postponed' } }),
        ],
      },
    });
    const { matches, currentRound } = await fetchLeagueData(47);
    expect(matches[0]).toMatchObject({ homeScore: 3, awayScore: 0 });
    expect(matches[1]).toMatchObject({ homeScore: null, awayScore: null });
    expect(currentRound).toBeNull();
  });

  it('skips matches without usable team ids', async () => {
    respond({ table: [], fixtures: { allMatches: [match({ home: null }), match({ away: { id: '0', name: 'x' } }), match({ id: 'ok' })] } });
    expect((await fetchLeagueData(47)).matches.map((m) => m.matchId)).toEqual(['ok']);
  });

  it('returns an empty result on HTTP errors', async () => {
    respond({}, 500);
    expect(await fetchLeagueData(47)).toEqual({ tablePositions: new Map(), matches: [], currentRound: null });
  });
});
