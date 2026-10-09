import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchCardEvent } from '@/lib/fotmob';

vi.mock('@/lib/fixturesCache', () => ({ getLeagueFixturesCached: vi.fn() }));
vi.mock('@/lib/fotmobCache', () => ({ getMatchCardEventsCached: vi.fn() }));

import { getLeagueFixturesCached } from '@/lib/fixturesCache';
import { getMatchCardEventsCached } from '@/lib/fotmobCache';
import { getLeagueSuspensionInfo } from './suspensionCheck';
import { makeMatch } from './testUtils';

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const card = (playerId: number, c: MatchCardEvent['card']): MatchCardEvent => ({ playerId, playerName: `P${playerId}`, card: c, minute: 50 });

function setup(matches: ReturnType<typeof makeMatch>[], cards: Record<string, MatchCardEvent[]>) {
  vi.mocked(getLeagueFixturesCached).mockResolvedValue({ matches } as never);
  vi.mocked(getMatchCardEventsCached).mockImplementation(async (id: string) => cards[id] ?? []);
}

beforeEach(() => vi.clearAllMocks());

describe('getLeagueSuspensionInfo', () => {
  it('flags a red card in a recent match and counts only finished matches', async () => {
    setup(
      [
        makeMatch({ matchId: 'a', homeId: 1, awayId: 2, finished: true, date: daysAgo(3) }),
        makeMatch({ matchId: 'future', homeId: 1, awayId: 2, finished: false, date: daysAgo(-3) }),
      ],
      { a: [card(10, 'Red')], future: [card(10, 'Yellow')] },
    );
    const info = await getLeagueSuspensionInfo(47);
    expect(info.get(10)).toMatchObject({ redCardLastMatch: true, seasonYellowCards: 0 });
    expect(getMatchCardEventsCached).toHaveBeenCalledTimes(1);
  });

  it('treats a second yellow as a sending-off, but not outside the ~12 day window', async () => {
    setup(
      [
        makeMatch({ matchId: 'a', homeId: 1, awayId: 2, finished: true, date: daysAgo(2) }),
        makeMatch({ matchId: 'old', homeId: 1, awayId: 2, finished: true, date: daysAgo(30) }),
      ],
      { a: [card(10, 'YellowRed')], old: [card(11, 'Red')] },
    );
    const info = await getLeagueSuspensionInfo(47);
    expect(info.get(10)?.redCardLastMatch).toBe(true);
    expect(info.get(11)?.redCardLastMatch).toBe(false);
  });

  it('accumulates season yellows across matches and tracks the last carded match date', async () => {
    const d1 = daysAgo(40), d2 = daysAgo(20), d3 = daysAgo(5);
    setup(
      [
        makeMatch({ matchId: 'm3', homeId: 1, awayId: 2, finished: true, date: d3 }),   // deliberately unsorted
        makeMatch({ matchId: 'm1', homeId: 1, awayId: 2, finished: true, date: d1 }),
        makeMatch({ matchId: 'm2', homeId: 1, awayId: 2, finished: true, date: d2 }),
      ],
      { m1: [card(10, 'Yellow')], m2: [card(10, 'Yellow')], m3: [card(10, 'Yellow')] },
    );
    const e = (await getLeagueSuspensionInfo(47)).get(10)!;
    expect(e.seasonYellowCards).toBe(3);
    expect(e.lastCardedMatchDate).toBe(d3);
  });

  it('a red followed by a later carded match no longer counts as "last match"', async () => {
    setup(
      [
        makeMatch({ matchId: 'r', homeId: 1, awayId: 2, finished: true, date: daysAgo(8) }),
        makeMatch({ matchId: 'y', homeId: 1, awayId: 2, finished: true, date: daysAgo(1) }),
      ],
      { r: [card(10, 'Red')], y: [card(10, 'Yellow')] },
    );
    expect((await getLeagueSuspensionInfo(47)).get(10)?.redCardLastMatch).toBe(false);
  });

  it('returns an empty map when nobody was carded', async () => {
    setup([makeMatch({ matchId: 'a', homeId: 1, awayId: 2, finished: true })], {});
    expect((await getLeagueSuspensionInfo(47)).size).toBe(0);
  });
});
