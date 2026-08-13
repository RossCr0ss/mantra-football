import { load } from 'cheerio';
import type { MantraPosition } from '@/types/squad';

/**
 * mantrafootball.org wrapper — the source of truth for `mantraPositions`.
 * The site's `position_classic_arr` values are already the exact MantraPosition
 * code space (GK/RB/CB/LB/WB/DM/CM/W/AM/FW/ST), so no translation is needed.
 *
 * See docs/mantrafootball-api.md for endpoint shapes and quirks.
 */

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

/** The site 406s /api/ JSON requests against HTML-only routes (sign_in, /teams/{id}) — separate Accept header. */
const HTML_HEADERS = {
  'User-Agent': HEADERS['User-Agent'],
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/** Our FotMob LEAGUES id → mantrafootball.org tournament id (stable across seasons). */
export const MANTRA_TOURNAMENT_ID: Record<number, number> = {
  47: 2,   // Premier League → England
  55: 1,   // Serie A → Italy
  40: 13,  // First Division A → Belgium
  441: 15, // Ukrainian Premier League → Ukraine
  87: 5,   // LaLiga → Spain
};

export interface MantraPlayer {
  id: number;
  fullName: string;
  clubName: string;
  positions: MantraPosition[];
}

/**
 * league_id is a season-scoped fantasy-room id, not the stable tournament id —
 * it changes every season. Resolve any currently-active league for the tournament,
 * since /api/players filters by league_id but resolves to the whole tournament's pool.
 */
export async function resolveMantraLeagueId(tournamentId: number): Promise<number | null> {
  try {
    const res = await fetch(
      `https://mantrafootball.org/api/leagues?filter[tournament_id]=${tournamentId}&page[size]=1`,
      { headers: HEADERS, cache: 'no-store' },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

interface MantraPlayerRaw {
  id: number;
  name: string;
  first_name: string;
  club: { name: string };
  position_classic_arr: string[];
}

/** All real-world players for a tournament, with their official Mantra positions. */
export async function fetchMantraTournamentPlayers(tournamentId: number): Promise<MantraPlayer[]> {
  const leagueId = await resolveMantraLeagueId(tournamentId);
  if (leagueId == null) return [];

  const players: MantraPlayer[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    let res: Response;
    try {
      res = await fetch(
        `https://mantrafootball.org/api/players?filter[league_id]=${leagueId}&page[number]=${page}&page[size]=100`,
        { headers: HEADERS, cache: 'no-store' },
      );
    } catch {
      break;
    }
    if (!res.ok) break;

    const data = await res.json();
    const rows: MantraPlayerRaw[] = data?.data ?? [];
    for (const r of rows) {
      players.push({
        id: r.id,
        fullName: `${r.first_name} ${r.name}`.trim(),
        clubName: r.club?.name ?? '',
        positions: (r.position_classic_arr ?? []) as MantraPosition[],
      });
    }

    totalPages = data?.meta?.page?.total_pages ?? 1;
    page += 1;
  } while (page <= totalPages);

  return players;
}

// ─── Authenticated: import an existing squad ──────────────────────────────────

function cookieHeaderFrom(res: Response): string | null {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length === 0) return null;
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

/**
 * Logs into mantrafootball.org (Devise form auth) and returns a session cookie
 * header for reuse, or null on invalid credentials / unexpected response shape.
 * The cookie is not persisted anywhere by this function — the caller decides.
 */
export async function mantraLogin(email: string, password: string): Promise<string | null> {
  try {
    const signInRes = await fetch('https://mantrafootball.org/users/sign_in', {
      headers: HTML_HEADERS,
      cache: 'no-store',
    });
    const signInHtml = await signInRes.text();
    const token = load(signInHtml)('input[name="authenticity_token"]').attr('value');
    const initialCookie = cookieHeaderFrom(signInRes);
    if (!token) return null;

    const body = new URLSearchParams({
      authenticity_token: token,
      'user[email]': email,
      'user[password]': password,
      'user[remember_me]': '0',
    });

    const loginRes = await fetch('https://mantrafootball.org/users/sign_in', {
      method: 'POST',
      headers: {
        ...HTML_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(initialCookie ? { Cookie: initialCookie } : {}),
      },
      body,
      redirect: 'manual',
      cache: 'no-store',
    });

    if (loginRes.status !== 302) return null;
    return cookieHeaderFrom(loginRes);
  } catch {
    return null;
  }
}

export interface MantraRosterPlayer {
  mantraId: number;
  lastName: string;
  firstName: string;
  positions: MantraPosition[];
}

export interface MantraRoster {
  players: MantraRosterPlayer[];
  /** false when this team's roster belongs to an older season (not renewed for the current one). */
  isCurrentSeason: boolean;
}

/** Latest season's start year (e.g. 2026 for "26-27"), from /api/seasons — max `id`. */
async function fetchMantraCurrentSeasonStartYear(): Promise<number | null> {
  try {
    const res = await fetch('https://mantrafootball.org/api/seasons', { headers: HEADERS, cache: 'no-store' });
    if (!res.ok) return null;
    const seasons = ((await res.json())?.data ?? []) as { id: number; start_year: number }[];
    if (seasons.length === 0) return null;
    return seasons.reduce((latest, s) => (s.id > latest.id ? s : latest), seasons[0]).start_year;
  } catch {
    return null;
  }
}

/** Parses the server-rendered `/teams/{id}` roster page — no JSON API exists for this. */
export async function fetchMantraTeamRoster(
  teamId: number,
  sessionCookie: string,
): Promise<MantraRoster> {
  const empty: MantraRoster = { players: [], isCurrentSeason: false };
  try {
    const res = await fetch(`https://mantrafootball.org/teams/${teamId}`, {
      headers: { ...HTML_HEADERS, Cookie: sessionCookie },
      cache: 'no-store',
    });
    if (!res.ok) return empty;
    const html = await res.text();
    const $ = load(html);

    // The page shows "Season 26-27 • Mantra" for the season this team roster belongs to —
    // teams from a season the user hasn't renewed still exist and render fine, so this is
    // the only way to tell a stale roster from a current one.
    const seasonMatch = $('.league-season').first().text().match(/Season\s+(\d{2})-(\d{2})/);
    const rosterStartYear = seasonMatch ? 2000 + Number(seasonMatch[1]) : null;
    const currentStartYear = await fetchMantraCurrentSeasonStartYear();
    const isCurrentSeason =
      rosterStartYear != null && currentStartYear != null && rosterStartYear === currentStartYear;

    // The page renders each row twice (desktop + mobile layout) sharing the same
    // /players/{id} link — dedupe by mantraId, keeping the first occurrence.
    const players = new Map<number, MantraRosterPlayer>();
    $('a[href^="/players/"]').each((_, el) => {
      const row = $(el);
      const idMatch = (row.attr('href') ?? '').match(/^\/players\/(\d+)$/);
      const lastName = row.find('.team-player-last-name').first().text().trim();
      const firstName = row.find('.team-player-first-name').first().text().trim();
      if (!idMatch || !lastName) return;

      const mantraId = Number(idMatch[1]);
      if (players.has(mantraId)) return;

      const positions = row
        .find('.team-player-position .player-position')
        .map((_i, p) => $(p).text().trim())
        .get() as MantraPosition[];

      players.set(mantraId, { mantraId, lastName, firstName, positions });
    });

    return { players: Array.from(players.values()), isCurrentSeason };
  } catch {
    return empty;
  }
}
