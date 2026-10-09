import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchMantraTournamentPlayers, fetchMantraTeamRoster, mantraLogin, MANTRA_TOURNAMENT_ID, MANTRA_TIMEOUT_MS,
} from './mantraFootball';

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset(); });

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);
const urlOf = (i: number) => String(fetchMock.mock.calls[i][0]);

describe('MANTRA_TOURNAMENT_ID', () => {
  it('is derived from LEAGUES', () => {
    expect(MANTRA_TOURNAMENT_ID).toMatchObject({ 47: 2, 55: 1, 40: 13, 441: 15, 87: 5 });
  });
});

describe('fetchMantraTournamentPlayers', () => {
  const row = (id: number, first: string | null, name: string, club = 'Arsenal', pos = ['CB']) =>
    ({ id, first_name: first, name, club: { name: club }, position_classic_arr: pos });

  it('resolves the league id, paginates and builds full names (null first name = mononym)', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: [{ id: 591 }] }))
      .mockResolvedValueOnce(json({ data: [row(1, 'Bukayo', 'Saka', 'Arsenal', ['W', 'FW'])], meta: { page: { total_pages: 2 } } }))
      .mockResolvedValueOnce(json({ data: [row(2, null, 'Eguinaldo')], meta: { page: { total_pages: 2 } } }));

    const players = await fetchMantraTournamentPlayers(2);
    expect(players).toEqual([
      { id: 1, fullName: 'Bukayo Saka', clubName: 'Arsenal', positions: ['W', 'FW'] },
      { id: 2, fullName: 'Eguinaldo', clubName: 'Arsenal', positions: ['CB'] },
    ]);
    expect(urlOf(0)).toContain('filter[tournament_id]=2');
    expect(urlOf(1)).toContain('filter[league_id]=591');
    expect(urlOf(2)).toContain('page[number]=2');
  });

  it('returns [] when no active league exists and stops (keeping earlier pages) on a failed page', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [] }));
    expect(await fetchMantraTournamentPlayers(2)).toEqual([]);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(json({ data: [{ id: 1 }] }))
      .mockResolvedValueOnce(json({ data: [row(1, 'A', 'B')], meta: { page: { total_pages: 3 } } }))
      .mockResolvedValueOnce(new Response('x', { status: 500 }));
    expect(await fetchMantraTournamentPlayers(2)).toHaveLength(1);
  });

  it('sends no-store and a timeout signal on every request', async () => {
    fetchMock.mockResolvedValue(json({ data: [] }));
    await fetchMantraTournamentPlayers(2);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(MANTRA_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

const rosterHtml = (season: string) => {
  const row = (id: string, first: string) => `
    <a href="/players/${id}">
      <span class="team-player-last-name">Last${id}</span>
      <span class="team-player-first-name">${first}</span>
      <div class="team-player-position"><span class="player-position">CB</span><span class="player-position">WB</span></div>
    </a>`;
  return `
  <div class="league-season">Season ${season} • Mantra</div>
  ${row('101', 'First101')}${row('102', 'First102')}${row('101', 'MOBILE-DUPLICATE')}
  <a href="/players/xyz"><span class="team-player-last-name">Bad</span></a>
  <a href="/other/1"><span class="team-player-last-name">Other</span></a>`;
};

describe('fetchMantraTeamRoster', () => {
  it('parses unique players (page renders rows twice) and flags the current season', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(rosterHtml('26-27')))
      .mockResolvedValueOnce(json({ data: [{ id: 1, start_year: 2025 }, { id: 2, start_year: 2026 }] }));

    const r = await fetchMantraTeamRoster(77, 'sess=1');
    expect(r.isCurrentSeason).toBe(true);
    expect(r.players).toEqual([
      { mantraId: 101, lastName: 'Last101', firstName: 'First101', positions: ['CB', 'WB'] },
      { mantraId: 102, lastName: 'Last102', firstName: 'First102', positions: ['CB', 'WB'] },
    ]);
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers.Cookie).toBe('sess=1');
  });

  it('marks a roster from an older season as not current', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(rosterHtml('25-26')))
      .mockResolvedValueOnce(json({ data: [{ id: 2, start_year: 2026 }] }));
    expect((await fetchMantraTeamRoster(77, 'c')).isCurrentSeason).toBe(false);
  });

  it('returns an empty roster on HTTP errors and network failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }));
    expect(await fetchMantraTeamRoster(1, 'c')).toEqual({ players: [], isCurrentSeason: false });
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(await fetchMantraTeamRoster(1, 'c')).toEqual({ players: [], isCurrentSeason: false });
  });
});

describe('mantraLogin', () => {
  const signIn = (cookies: string[]) => {
    const h = new Headers();
    cookies.forEach((c) => h.append('set-cookie', c));
    return new Response('<form><input name="authenticity_token" value="TOK"></form>', { headers: h });
  };

  it('posts the CSRF token + credentials and returns the session cookie on 302', async () => {
    fetchMock
      .mockResolvedValueOnce(signIn(['_csrf=abc; path=/']))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { 'set-cookie': '_session=xyz; HttpOnly' } }));

    expect(await mantraLogin('a@b.c', 'pw')).toBe('_session=xyz');
    const init = fetchMock.mock.calls[1][1] as { method: string; body: URLSearchParams; headers: Record<string, string>; redirect: string };
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.headers.Cookie).toBe('_csrf=abc');
    expect(init.body.get('authenticity_token')).toBe('TOK');
    expect(init.body.get('user[email]')).toBe('a@b.c');
  });

  it('returns null for wrong credentials (non-302), a missing token, or a network error', async () => {
    fetchMock.mockResolvedValueOnce(signIn([])).mockResolvedValueOnce(new Response('bad', { status: 200 }));
    expect(await mantraLogin('a', 'b')).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response('<html></html>'));
    expect(await mantraLogin('a', 'b')).toBeNull();

    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect(await mantraLogin('a', 'b')).toBeNull();
  });
});
