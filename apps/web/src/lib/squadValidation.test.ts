import { describe, expect, it } from 'vitest';
import { sanitizeSquadPlayer, validateSquadPayload } from './squadValidation';
import { makePlayer } from './testUtils';

const squad = (n = 26, gks = 3) =>
  Array.from({ length: n }, (_, i) =>
    i < gks
      ? makePlayer({ id: i + 1, position: 'GK', positionGroup: 'GK', mantraPositions: ['GK'] })
      : makePlayer({ id: i + 1 }),
  );

describe('sanitizeSquadPlayer', () => {
  it('accepts a valid player and drops unknown / $-prefixed keys', () => {
    const p = sanitizeSquadPlayer({ ...makePlayer({ id: 1 }), $set: { x: 1 }, evil: true });
    expect(p).not.toBeNull();
    expect(p).not.toHaveProperty('$set');
    expect(p).not.toHaveProperty('evil');
  });

  it.each([
    ['non-object', 'x'],
    ['bad id', { ...makePlayer({ id: 1 }), id: '1' }],
    ['unknown group', { ...makePlayer({ id: 1 }), positionGroup: 'ST' }],
    ['unknown mantra position', { ...makePlayer({ id: 1 }), mantraPositions: ['XX'] }],
    ['availability out of range', { ...makePlayer({ id: 1 }), availabilityPct: 150 }],
    ['bad lineupStatus', { ...makePlayer({ id: 1 }), lineupStatus: 'banana' }],
  ])('rejects %s', (_n, raw) => {
    expect(sanitizeSquadPlayer(raw)).toBeNull();
  });

  it('keeps optional availability fields', () => {
    expect(sanitizeSquadPlayer({ ...makePlayer({ id: 1 }), availabilityPct: 50, lineupStatus: 'injured' }))
      .toMatchObject({ availabilityPct: 50, lineupStatus: 'injured' });
  });
});

describe('validateSquadPayload', () => {
  it('accepts exactly 26 players with 3 goalkeepers', () => {
    const r = validateSquadPayload(squad());
    expect('players' in r && r.players).toHaveLength(26);
  });

  it('rejects wrong size, wrong GK count, duplicates and non-arrays', () => {
    expect(validateSquadPayload(squad(25))).toHaveProperty('error');
    expect(validateSquadPayload(squad(26, 2))).toHaveProperty('error');
    const dup = squad(); dup[5] = { ...dup[5], id: dup[6].id };
    expect(validateSquadPayload(dup)).toEqual({ error: 'Duplicate players in squad' });
    expect(validateSquadPayload({})).toHaveProperty('error');
  });
});
