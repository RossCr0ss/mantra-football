import { fotmobFetch } from './http';
import { extractTableRows } from './league';
import type { FotMobPlayer, FotMobTeam, PlayerSeasonStats } from './types';

/**
 * Returns a map of playerId → stats for all players currently in the team squad.
 * Only the team endpoint is used here (playerData is Cloudflare-blocked server-side).
 * Detailed positional stats are overlaid by the analytics route from CDN stat lists.
 */
export async function fetchTeamPlayerStats(
  teamId: number,
  teamName: string,
): Promise<Map<number, PlayerSeasonStats>> {
  const players = await fetchTeamPlayers(teamId, teamName);
  const map = new Map<number, PlayerSeasonStats>();
  for (const p of players) {
    map.set(p.id, {
      playerId:              p.id,
      rating:                p.seasonRating,
      goals:                 p.goals,
      assists:               p.assists,
      yellowCards:           p.yellowCards,
      redCards:              p.redCards,
      leagueRank:            null,
      matchesPlayed:         null,
      minutesPlayed:         null,
      cleanSheets:           null,
      saves:                 null,
      goalsConceded:         null,
      savePercentage:        null,
      goalsPrevented:        null,
      penaltySaves:          null,
      actedSweeper:          null,
      highClaims:            null,
      errorLeadToGoal:       null,
      tackles:               null,
      interceptions:         null,
      clearances:            null,
      blockedShots:          null,
      aerialsWon:            null,
      foulsCommitted:        null,
      possessionWonFinal3rd: null,
      dribbledPast:          null,
      expectedGoals:         null,
      shots:                 null,
      chancesCreated:        null,
      successfulDribbles:    null,
      bigChancesCreated:     null,
      bigChancesMissed:      null,
    });
  }
  return map;
}

const SQUAD_GROUP_TO_POSITION: Record<string, FotMobPlayer['position']> = {
  keepers: 'GK',
  defenders: 'DEF',
  midfielders: 'MID',
  attackers: 'FWD',
};

export async function fetchLeagueTeams(leagueId: number): Promise<FotMobTeam[]> {
  let res: Response;
  try {
    res = await fotmobFetch(`https://www.fotmob.com/api/data/leagues?id=${leagueId}`);
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json();

  const tableGroups = (data?.table as { data: Record<string, unknown> }[]) ?? [];
  const rows = extractTableRows(tableGroups[0]?.data);

  return rows.map((t) => ({
    id: Number(t.id),
    name: t.name,
    shortName: t.shortName,
    logoUrl: `https://images.fotmob.com/image_resources/logo/teamlogo/${Number(t.id)}.png`,
  }));
}

export async function fetchTeamPlayers(teamId: number, teamName: string): Promise<FotMobPlayer[]> {
  const res = await fotmobFetch(`https://www.fotmob.com/api/data/teams?id=${teamId}`);
  if (!res.ok) throw new Error(`FotMob teams error: ${res.status}`);
  const data = await res.json();

  const squadGroups: { title: string; members: Record<string, unknown>[] }[] | null =
    data?.squad?.squad ?? null;

  // For leagues where FotMob lacks full squad coverage (e.g. smaller Ukrainian clubs),
  // squad.squad is null. Fall back to the last-match lineup from overview.lastLineupStats.
  if (!squadGroups) {
    return fetchTeamPlayersFromLineup(teamId, teamName, data);
  }

  const players: FotMobPlayer[] = [];

  for (const group of squadGroups) {
    const position = SQUAD_GROUP_TO_POSITION[group.title];
    if (!position) continue;

    for (const m of group.members) {
      players.push({
        id: m.id as number,
        name: m.name as string,
        shirtNumber: (m.shirtNumber as number) ?? null,
        position,
        positionLabel: (m.positionIdsDesc as string) ?? group.title,
        nationality: (m.cname as string) ?? '',
        age: (m.age as number) ?? null,
        injured: (m.injured as boolean) ?? false,
        imageUrl: `https://images.fotmob.com/image_resources/playerimages/${m.id}.png`,
        teamName,
        teamId,
        seasonRating: (m.rating as number) ?? null,
        goals: (m.goals as number) ?? 0,
        assists: (m.assists as number) ?? 0,
        yellowCards: (m.ycards as number) ?? 0,
        redCards: (m.rcards as number) ?? 0,
      });
    }
  }

  return players;
}

/**
 * Fallback for teams where FotMob's squad endpoint returns null (e.g. smaller Ukrainian clubs).
 * Extracts starters + subs from overview.lastLineupStats — the most recent match lineup.
 * usualPlayingPositionId: 0=GK, 1=DEF, 2=MID, 3=FWD.
 */
function fetchTeamPlayersFromLineup(
  teamId: number,
  teamName: string,
  data: Record<string, unknown>,
): FotMobPlayer[] {
  const USUAL_POS: Record<number, FotMobPlayer['position']> = {
    0: 'GK', 1: 'DEF', 2: 'MID', 3: 'FWD',
  };

  type LineupEntry = {
    id?: number;
    name?: string;
    age?: number;
    shirtNumber?: string | number;
    countryName?: string;
    positionId?: number;
    usualPlayingPositionId?: number;
  };

  const lineup = (data?.overview as Record<string, unknown> | null)
    ?.lastLineupStats as { starters?: LineupEntry[]; subs?: LineupEntry[] } | null;

  if (!lineup) return [];

  const all: LineupEntry[] = [...(lineup.starters ?? []), ...(lineup.subs ?? [])];
  const seen = new Set<number>();
  const players: FotMobPlayer[] = [];

  for (const p of all) {
    if (!p.id) continue;
    const id = Number(p.id);
    if (seen.has(id)) continue;
    seen.add(id);

    // Prefer usualPlayingPositionId (general group) over positionId (formation slot)
    const groupNum = p.usualPlayingPositionId ?? (p.positionId === 11 ? 0 : undefined);
    const position: FotMobPlayer['position'] = USUAL_POS[groupNum ?? -1] ?? 'MID';

    players.push({
      id,
      name: p.name ?? '',
      shirtNumber: p.shirtNumber != null ? Number(p.shirtNumber) : null,
      position,
      positionLabel: position,
      nationality: p.countryName ?? '',
      age: p.age ?? null,
      injured: false,
      imageUrl: `https://images.fotmob.com/image_resources/playerimages/${id}.png`,
      teamName,
      teamId,
      seasonRating: null,
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
    });
  }

  return players;
}
