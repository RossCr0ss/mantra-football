import { describe, expect, it, vi } from 'vitest';

vi.mock('./mongodb', () => ({ getDb: vi.fn() })); // importing fixturesCache must not need MONGODB_URI

import { buildTeamFixtures } from './fixturesCache';
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
