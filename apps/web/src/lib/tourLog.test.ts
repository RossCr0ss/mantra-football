import { describe, expect, it } from 'vitest';
import { buildTourLogEntry } from './tourLog';
import { makePlayer } from './testUtils';
import type { EnrichedPlayer } from './tourModules';

const enriched = (id: number, over: Partial<EnrichedPlayer> = {}): EnrichedPlayer => ({
  ...makePlayer({ id }),
  nextFixture: null,
  analytics: null,
  odds: null,
  scoreBreakdown: { total: 42, baseRating: 6.8, expectedPoints: 7.1, startProb: 0.9, rating: 0, context: 0, attack: 0, availability: 90 },
  ...over,
});

describe('buildTourLogEntry', () => {
  it('snapshots scores, availability, fixture and odds per player', () => {
    const p = enriched(1, {
      availabilityPct: 80,
      availabilityPctSource: 'suggested',
      odds: { home: 1.8, draw: 3.6, away: 4.5 },
      nextFixture: { matchId: 'm1', isHome: true, difficulty: 2 } as never,
    });
    const entry = buildTourLogEntry([p, enriched(2)], { moduleName: '4-4-2', defenceBonus: 2, assignment: { ids: [1, 2], penalty: [0, -1.5] } }, '7');
    expect(entry).toMatchObject({ round: '7', formation: '4-4-2', defenceBonus: 2, slots: [1, 2], penalty: [0, -1.5] });
    expect(entry.players[0]).toMatchObject({
      id: 1, score: 42, startProb: 0.9, expectedPoints: 7.1, availabilityPct: 80, availabilityPctSource: 'suggested',
      matchId: 'm1', isHome: true, difficulty: 2, odds: { home: 1.8, draw: 3.6, away: 4.5 },
    });
    expect(entry.players[1]).toMatchObject({ availabilityPct: null, lineupStatus: null, matchId: null, odds: null });
  });
});
