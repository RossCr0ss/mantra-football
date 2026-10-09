import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMatchOdds, fetchMatchCardEvents } from './matches';

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetchMock.mockReset(); });
const respond = (body: unknown, status = 200) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

const market = (selections: { name: string; oddsDecimal: string }[]) => ({ odds: { matchfactMarkets: [{ selections }] } });

describe('fetchMatchOdds', () => {
  it('parses 1/X/2 decimal odds from the first market', async () => {
    respond(market([{ name: '1', oddsDecimal: '1.85' }, { name: 'X', oddsDecimal: '3.4' }, { name: '2', oddsDecimal: '4.2' }]));
    expect(await fetchMatchOdds('123')).toEqual({ home: 1.85, draw: 3.4, away: 4.2 });
  });

  it('uses the geo params from env (defaults to Ukraine)', async () => {
    respond(market([{ name: '1', oddsDecimal: '2' }]));
    await fetchMatchOdds('1');
    expect(String(fetchMock.mock.calls[0][0])).toContain('ccode3=UKR&bettingProvider=22Bet_Ukraine');

    vi.stubEnv('FOTMOB_CCODE3', 'GBR'); vi.stubEnv('FOTMOB_BETTING_PROVIDER', 'Bet365');
    await fetchMatchOdds('1');
    expect(String(fetchMock.mock.calls[1][0])).toContain('ccode3=GBR&bettingProvider=Bet365');
  });

  it('keeps partial odds and ignores unparsable values', async () => {
    respond(market([{ name: '1', oddsDecimal: 'n/a' }, { name: 'x', oddsDecimal: '3.1' }]));
    expect(await fetchMatchOdds('1')).toEqual({ home: null, draw: 3.1, away: null });
  });

  it('returns null for no markets, empty id, HTTP errors, 204 and network errors', async () => {
    respond({ odds: null });
    expect(await fetchMatchOdds('1')).toBeNull();
    expect(await fetchMatchOdds('')).toBeNull();
    respond({}, 404);
    expect(await fetchMatchOdds('1')).toBeNull();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await fetchMatchOdds('1')).toBeNull();
    fetchMock.mockRejectedValue(new Error('down'));
    expect(await fetchMatchOdds('1')).toBeNull();
  });
});

describe('fetchMatchCardEvents', () => {
  it('keeps only valid card events and tolerates alternative player fields', async () => {
    respond({
      content: { matchFacts: { events: { events: [
        { type: 'Goal', playerId: 1 },
        { type: 'Card', card: 'Yellow', playerId: 10, fullName: 'A B', time: 33 },
        { type: 'Card', card: 'YellowRed', player: { id: 11, name: 'C D' }, time: 80 },
        { type: 'Card', card: 'Green', playerId: 12 },
        { type: 'Card', card: 'Red' },
      ] } } },
    });
    expect(await fetchMatchCardEvents('m')).toEqual([
      { playerId: 10, playerName: 'A B', card: 'Yellow', minute: 33 },
      { playerId: 11, playerName: 'C D', card: 'YellowRed', minute: 80 },
    ]);
  });

  it('returns [] when events are missing, HTTP fails, or the request throws', async () => {
    respond({ content: {} });
    expect(await fetchMatchCardEvents('m')).toEqual([]);
    respond({}, 500);
    expect(await fetchMatchCardEvents('m')).toEqual([]);
    fetchMock.mockRejectedValue(new Error('x'));
    expect(await fetchMatchCardEvents('m')).toEqual([]);
  });
});
