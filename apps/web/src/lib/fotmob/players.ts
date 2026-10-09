import { fotmobFetch } from './http';
import type { FotMobSearchResult, PlayerCurrentTeam, PlayerRecentMatch, PlayerRichStats, PlayerStatGroup, PlayerStatItem } from './types';

/**
 * A saved squad's teamId/teamName is a snapshot from add/import time and never
 * updates on its own — a transfer leaves it stale. `primaryTeam` on the player
 * profile is the authoritative current club, unlike a team's own squad-list
 * endpoint (which can lag a transfer by a while on FotMob's side).
 */
export async function fetchPlayerCurrentTeam(playerId: number): Promise<PlayerCurrentTeam | null> {
  try {
    const res = await fotmobFetch(`https://www.fotmob.com/api/data/playerData?id=${playerId}`, 'player');
    if (!res.ok) return null;
    const data = await res.json();
    const team = data?.primaryTeam;
    if (!team?.teamId || !team?.teamName) return null;
    return { teamId: Number(team.teamId), teamName: String(team.teamName) };
  } catch {
    return null;
  }
}

/**
 * FotMob's own name search — bypasses a club's team-roster endpoint entirely,
 * which matters because that endpoint is frequently null for some clubs
 * (confirmed live: Shakhtar Donetsk's squad.squad was null, silently hiding
 * real squad members like Eguinaldo/Marlon Gomes from fetchTeamPlayers no
 * matter how good the name-matching against them would be). Only useful as
 * a fallback for a name mantrafootball.org already spells the FotMob way —
 * it is NOT fuzzy about nicknames itself (confirmed live: searching mantra's
 * stored "Nicolas Paz" does not surface FotMob's own "Nico Paz" at all), so
 * callers should still try the normal roster-based match first.
 */
export async function searchFotMobPlayer(term: string): Promise<FotMobSearchResult[]> {
  try {
    const res = await fotmobFetch(`https://www.fotmob.com/api/data/search/suggest?hits=10&lang=en&term=${encodeURIComponent(term)}`);
    if (!res.ok) return [];
    const groups = await res.json() as { title?: { key?: string }; suggestions?: Record<string, unknown>[] }[];
    const group = groups.find((g) => g.title?.key === 'players') ?? groups[0];
    const suggestions = group?.suggestions ?? [];
    return suggestions
      .filter((s) => s.type === 'player')
      .map((s) => ({
        id: Number(s.id),
        name: String(s.name ?? ''),
        teamId: Number(s.teamId ?? 0),
        teamName: String(s.teamName ?? ''),
      }));
  } catch {
    return [];
  }
}

const FOTMOB_SHORT_POS_TO_GROUP: Record<string, 'GK' | 'DEF' | 'MID' | 'FWD'> = {
  GK: 'GK',
  CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF',
  DM: 'MID', CM: 'MID', LM: 'MID', RM: 'MID', AM: 'MID',
  LW: 'FWD', RW: 'FWD', ST: 'FWD', CF: 'FWD', SS: 'FWD',
};

/** Primary real-world position (short label + broad group) — used to fill in a
 *  SquadPlayer built from search results, which don't carry position at all. */
export async function fetchPlayerPrimaryPosition(
  playerId: number,
): Promise<{ label: string; group: 'GK' | 'DEF' | 'MID' | 'FWD' } | null> {
  try {
    const res = await fotmobFetch(`https://www.fotmob.com/api/data/playerData?id=${playerId}`, 'player');
    if (!res.ok) return null;
    const data = await res.json();
    const label = data?.positionDescription?.primaryPosition?.label as string | undefined;
    const shortLabel = (data?.positionDescription?.positions as Record<string, unknown>[] | undefined)
      ?.find((p) => (p.strPos as Record<string, unknown> | undefined)?.label === label)
      ?.strPosShort as Record<string, unknown> | undefined;
    const short = String(shortLabel?.label ?? '').toUpperCase();
    if (!short) return null;
    return { label: short, group: FOTMOB_SHORT_POS_TO_GROUP[short] ?? 'MID' };
  } catch {
    return null;
  }
}


/**
 * Fetches `firstSeasonStats.statsSection` from the FotMob playerData endpoint.
 * Returns structured stat groups with percentile rank data (vs positional peers).
 */
export async function fetchPlayerRichStats(playerId: number): Promise<PlayerRichStats | null> {
  try {
    const res = await fotmobFetch(`https://www.fotmob.com/api/data/playerData?id=${playerId}`, 'player');
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;

    const firstSeasonStats = data?.firstSeasonStats as Record<string, unknown> | null;
    const statsSection = firstSeasonStats?.statsSection as Record<string, unknown> | null;
    if (!statsSection) return null;

    const rawGroups = (statsSection.items ?? []) as Record<string, unknown>[];
    const groups: PlayerStatGroup[] = [];

    for (const rawGroup of rawGroups) {
      if (rawGroup.display !== 'stats-group') continue;
      const rawItems = (rawGroup.items ?? []) as Record<string, unknown>[];
      const items: PlayerStatItem[] = rawItems.map((gi) => ({
        title: String(gi.title ?? ''),
        localizedTitleId: String(gi.localizedTitleId ?? ''),
        statValue: String(gi.statValue ?? ''),
        per90: Number(gi.per90 ?? 0),
        percentileRank: Number(gi.percentileRank ?? 0),
        statFormat: (gi.statFormat as PlayerStatItem['statFormat']) ?? 'number',
      }));
      if (items.length > 0) {
        groups.push({
          title: String(rawGroup.title ?? ''),
          localizedTitleId: String(rawGroup.localizedTitleId ?? ''),
          items,
        });
      }
    }

    return groups.length > 0 ? { groups } : null;
  } catch {
    return null;
  }
}

// ── Player recent match form ───────────────────────────────────────────────────

/**
 * European club seasons run roughly July–June — using July 1 as the cutoff is
 * safely before any of our 5 leagues' opening matchday, so it can't clip the
 * current season while reliably dropping the previous one.
 */
function currentSeasonStart(): Date {
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1; // month 6 = July
  return new Date(year, 6, 1);
}

function parseMatchDate(m: Record<string, unknown>): Date {
  const md = m.matchDate as Record<string, unknown> | null;
  const raw = md?.utcTime ?? m.date ?? (m.status as Record<string, unknown> | null)?.utcTime ?? '';
  return new Date(String(raw));
}

/**
 * FotMob tags both club pre-season friendlies ("Club Friendlies", leagueId 489)
 * and international friendlies ("Friendlies", leagueId 114) with "Friendl" in
 * leagueName — matching on the name rather than a hardcoded ID list, since a
 * pre-season friendly for the player's own club would otherwise pass the
 * teamId filter below (confirmed on real data: Arsenal's Aug 2026 friendlies
 * vs Real Betis/Girona show up exactly like a competitive match otherwise).
 */
function isFriendly(m: Record<string, unknown>): boolean {
  return /friendl/i.test(String(m.leagueName ?? ''));
}

/**
 * Last 5 appearances this season for the player's own club, in an official
 * club competition (domestic league, domestic cups, continental) — recentMatches
 * mixes in international caps, friendlies, and prior-season matches, none of
 * which belong in a "recent form" read: international duty and friendlies
 * aren't competitive club form, and a player who hasn't played yet this
 * season showing 10-month-old cards/minutes as if current is actively
 * misleading (confirmed on real data — see docs/fotmob-api.md).
 *
 * The player's club is read from `primaryTeam` on this same response (also
 * used by fetchPlayerCurrentTeam) rather than inferred from which teamId
 * appears most often in the window — during a summer tournament (confirmed
 * live against real World Cup 2026 call-ups) a player's *entire* recent
 * window can be international duty, which would make the national team look
 * like "the most common team" and let a World Cup run straight through as
 * if it were club form.
 */
export async function fetchPlayerRecentMatches(playerId: number): Promise<PlayerRecentMatch[]> {
  try {
    const res = await fotmobFetch(`https://www.fotmob.com/api/data/playerData?id=${playerId}`, 'player');
    if (!res.ok) return [];
    const data = await res.json() as Record<string, unknown>;
    const raw = data?.recentMatches as Record<string, unknown>[] | null;
    if (!Array.isArray(raw)) return [];

    const myClubTeamId = Number((data?.primaryTeam as Record<string, unknown> | null)?.teamId ?? 0);
    const seasonStart = currentSeasonStart();

    return raw
      .filter((m) => parseMatchDate(m) >= seasonStart && !isFriendly(m) && Number(m.teamId ?? 0) === myClubTeamId)
      .slice(-5)
      .map((m): PlayerRecentMatch | null => {
        try {
          // Current FotMob shape: isHomeTeam, opponentTeamId/Name, matchDate.utcTime, ratingProps.rating
          // Legacy FotMob shape: home/away objects, date/status.utcTime, playerRating
          const home = (m.home as Record<string, unknown> | null) ?? {};
          const away = (m.away as Record<string, unknown> | null) ?? {};

          // isHome: prefer explicit flag, fall back to home.id === teamId
          const teamId = Number(m.teamId ?? 0);
          const homeId = Number(home.id ?? 0);
          const isHome = m.isHomeTeam != null
            ? Boolean(m.isHomeTeam)
            : (homeId > 0 && homeId === teamId);

          // Score: top-level homeScore/awayScore (both shapes)
          const hs = m.homeScore != null ? Number(m.homeScore)
            : home.score != null ? Number(home.score) : null;
          const as_ = m.awayScore != null ? Number(m.awayScore)
            : away.score != null ? Number(away.score) : null;

          const goalsFor     = isHome ? hs  : as_;
          const goalsAgainst = isHome ? as_ : hs;
          let result: 'W' | 'D' | 'L' | null = null;
          if (goalsFor != null && goalsAgainst != null) {
            result = goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
          }

          // Rating: ratingProps.rating (string) | playerRating | rating (plain/object)
          const ratingRaw = (m.ratingProps as Record<string, unknown> | null)?.rating
            ?? m.playerRating ?? m.rating;
          const ratingNum = ratingRaw == null ? null
            : typeof ratingRaw === 'object'
              ? Number((ratingRaw as Record<string, unknown>).num ?? null)
              : Number(ratingRaw);
          const rating = ratingNum != null && !isNaN(ratingNum) && ratingNum > 0 ? ratingNum : null;

          // Date: matchDate.utcTime | date | status.utcTime
          const matchDate = m.matchDate as Record<string, unknown> | null;
          const date = String(
            matchDate?.utcTime ?? m.date ?? (m.status as Record<string, unknown> | null)?.utcTime ?? '',
          );

          // Opponent: prefer opponentTeamId/Name; fall back to home/away objects
          const opponentId = m.opponentTeamId != null
            ? Number(m.opponentTeamId)
            : isHome ? Number(away.id ?? 0) : Number(home.id ?? 0);
          const opponentName = m.opponentTeamName != null
            ? String(m.opponentTeamName)
            : isHome ? String(away.name ?? '') : String(home.name ?? '');

          // Cards: yellowCards/redCards (numbers) or yellowCard/redCard (booleans)
          const yellowCard = m.yellowCards != null ? Number(m.yellowCards) > 0 : Boolean(m.yellowCard);
          const redCard    = m.redCards    != null ? Number(m.redCards)    > 0 : Boolean(m.redCard);
          const started = Boolean(m.playedInMatch) && !Boolean(m.onBench);

          return {
            matchId: String(m.id ?? ''),
            date,
            opponentName,
            opponentId,
            isHome,
            result,
            goalsFor,
            goalsAgainst,
            minutesPlayed: m.minutesPlayed != null ? Number(m.minutesPlayed) : null,
            rating,
            goals: Number(m.goals ?? 0),
            assists: Number(m.assists ?? 0),
            yellowCard,
            redCard,
            leagueId: Number(m.leagueId ?? 0),
            started,
          };
        } catch {
          return null;
        }
      })
      .filter((m): m is PlayerRecentMatch => m !== null);
  } catch {
    return [];
  }
}

// ============ Fixtures ============
