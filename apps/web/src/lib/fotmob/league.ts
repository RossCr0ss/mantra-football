import { fotmobFetch } from './http';
import { fetchLeagueTeams } from './teams';
import type { LeagueMatch } from './types';

/**
 * Returns the primarySeasonId for a league by fetching any team from it.
 * Result cached via Next.js fetch cache.
 */
export async function fetchLeagueSeasonId(leagueId: number): Promise<string | null> {
  // Use the league table to find a team, then get season from that team's stats
  try {
    const teams = await fetchLeagueTeams(leagueId);
    if (!teams.length) return null;
    const res = await fotmobFetch(`https://www.fotmob.com/api/data/teams?id=${teams[0].id}`);
    if (!res.ok) return null;
    const data = await res.json();
    const seasonId: string | null = data?.stats?.primarySeasonId ?? null;
    return seasonId ? String(seasonId) : null;
  } catch {
    return null;
  }
}

/**
 * Returns the tournamentId of the season immediately before the current one for a
 * league — used as a fallback data source early in a new season, when every squad
 * player's current-season stats are still 0/null and the auto-select scoring would
 * otherwise treat every player as identical. Reads `stats.tournamentSeasons` off any
 * team in the league (same response `fetchLeagueSeasonId` uses), which lists every
 * season the team has competed in across all competitions, newest first; filters to
 * this league only and takes the entry right after the current `primarySeasonId`.
 */
export async function fetchLeaguePreviousSeasonId(leagueId: number): Promise<string | null> {
  try {
    const teams = await fetchLeagueTeams(leagueId);
    if (!teams.length) return null;
    const res = await fotmobFetch(`https://www.fotmob.com/api/data/teams?id=${teams[0].id}`);
    if (!res.ok) return null;
    const data = await res.json();
    const primarySeasonId: string | null = data?.stats?.primarySeasonId != null
      ? String(data.stats.primarySeasonId) : null;
    const seasons = (data?.stats?.tournamentSeasons as
      { tournamentId?: string | number; parentLeagueId?: string | number }[] | undefined) ?? [];
    const ownLeagueSeasons = seasons
      .filter((s) => String(s.parentLeagueId) === String(leagueId))
      .map((s) => String(s.tournamentId));
    const idx = ownLeagueSeasons.findIndex((id) => id === primarySeasonId);
    if (idx === -1 || idx + 1 >= ownLeagueSeasons.length) return null;
    return ownLeagueSeasons[idx + 1];
  } catch {
    return null;
  }
}

/**
 * Extracts team rows from a FotMob league table data block.
 *
 * FotMob uses two different shapes depending on the league:
 *   - Standard (e.g. PL, Serie A): data.table.all
 *   - Playoff/group (e.g. Belgian Pro League): data.tables[].table.all
 *
 * Returns a deduplicated, ordered list of rows with at least { id, name, shortName }.
 */
export function extractTableRows(
  data: Record<string, unknown> | undefined | null,
): { id: number; name: string; shortName: string }[] {
  if (!data) return [];

  // Standard shape
  const single = data.table as { all?: { id: number; name: string; shortName: string }[] } | null;
  if (Array.isArray(single?.all) && single!.all!.length > 0) {
    return single!.all!;
  }

  // Playoff/group shape (e.g. Belgium) — aggregate unique teams from all sub-tables
  const subTables = data.tables as { table?: { all?: { id: number; name: string; shortName: string }[] } }[] | null;
  if (!Array.isArray(subTables)) return [];

  const seen = new Set<number>();
  const rows: { id: number; name: string; shortName: string }[] = [];
  for (const sub of subTables) {
    for (const row of sub.table?.all ?? []) {
      const id = Number(row.id);
      if (!seen.has(id)) {
        seen.add(id);
        rows.push(row);
      }
    }
  }
  return rows;
}

/**
 * Fetches league table positions AND all matches in a single call to the
 * leagues endpoint. This replaces the former per-team fixture fetching:
 * one request covers every squad team instead of one request per team.
 *
 * data.matches.allMatches — full season schedule (past + upcoming)
 * data.matches.firstUnplayedMatch — pointer to the current active round
 * data.table[0].data.table.all — current standings (or data.table[0].data.tables for playoff leagues)
 */
export async function fetchLeagueData(leagueId: number): Promise<{
  tablePositions: Map<number, number>;
  matches: LeagueMatch[];
  currentRound: string | null;
}> {
  const res = await fotmobFetch(`https://www.fotmob.com/api/data/leagues?id=${leagueId}`);
  if (!res.ok) return { tablePositions: new Map(), matches: [], currentRound: null };
  const data = await res.json() as Record<string, unknown>;

  // Table positions — FotMob returns team IDs as numbers in the table
  const tableGroups: { data: { table: { all: { id: number }[] } } }[] =
    (data?.table as typeof tableGroups) ?? [];
  const rows = extractTableRows(tableGroups[0]?.data);
  const tablePositions = new Map<number, number>();
  rows.forEach((row, i) => tablePositions.set(Number(row.id), i + 1));

  // Matches — live at data.fixtures.allMatches (NOT data.matches)
  // NOTE: FotMob returns home.id / away.id as strings — always parse with Number()
  const matchesBlock = data?.fixtures as Record<string, unknown> | null;
  const raw = (matchesBlock?.allMatches as Record<string, unknown>[]) ?? [];

  const matches: LeagueMatch[] = raw
    .map((m): LeagueMatch | null => {
      const home = m.home as { id: string | number; name: string; score?: number | string | null } | null;
      const away = m.away as { id: string | number; name: string; score?: number | string | null } | null;
      const status = m.status as {
        utcTime?: string; finished?: boolean; started?: boolean; cancelled?: boolean;
        scoreStr?: string;
      } | null;
      if (!home?.id || !away?.id) return null;
      const homeId = Number(home.id);
      const awayId = Number(away.id);
      if (!homeId || !awayId) return null;
      const roundRaw = m.round ?? m.roundName;

      // FotMob stopped embedding score in home/away objects; it now lives in
      // status.scoreStr as "H - A" (e.g. "2 - 1"). Fall back to home.score if present.
      let homeScore: number | null = null;
      let awayScore: number | null = null;
      if (status?.scoreStr) {
        const parts = status.scoreStr.split('-');
        if (parts.length === 2) {
          const h = parseInt(parts[0].trim(), 10);
          const a = parseInt(parts[1].trim(), 10);
          if (!isNaN(h)) homeScore = h;
          if (!isNaN(a)) awayScore = a;
        }
      } else if (home.score != null) {
        homeScore = Number(home.score);
        awayScore = away?.score != null ? Number(away.score) : null;
      }

      return {
        matchId: String(m.id ?? ''),
        date: status?.utcTime ?? '',
        round: roundRaw != null ? String(roundRaw) : null,
        homeTeam: {
          id: homeId,
          name: home.name,
          logoUrl: `https://images.fotmob.com/image_resources/logo/teamlogo/${homeId}.png`,
        },
        awayTeam: {
          id: awayId,
          name: away.name,
          logoUrl: `https://images.fotmob.com/image_resources/logo/teamlogo/${awayId}.png`,
        },
        finished: status?.finished ?? false,
        homeScore,
        awayScore,
      };
    })
    .filter((m): m is LeagueMatch => m !== null);

  // Determine the current active round from firstUnplayedMatch.
  // Use matchId lookup (not index — firstUnplayedMatchIndex is 1-based in the API).
  const firstUnplayed = matchesBlock?.firstUnplayedMatch as
    { firstUnplayedMatchId?: string } | null;
  const firstUnplayedId = firstUnplayed?.firstUnplayedMatchId
    ? String(firstUnplayed.firstUnplayedMatchId)
    : null;
  const currentRound = firstUnplayedId
    ? (matches.find((m) => m.matchId === firstUnplayedId)?.round ?? null)
    : null;

  return { tablePositions, matches, currentRound };
}
