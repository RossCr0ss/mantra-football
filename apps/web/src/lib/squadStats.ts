import {
  getLeagueTeamsCached,
  getTeamPlayerStatsCached,
  getLeagueRatingStatsCached,
  getLeagueSeasonIdCached,
  getLeagueAllPlayerStatsCached,
} from '@/lib/fotmobCache';
import type { FotMobTeam, PlayerSeasonStats } from '@/lib/fotmob';
import type { SquadPlayer } from '@/types/squad';

type Opts = { forceRefresh?: boolean };

/**
 * Season aggregate stats (rating, goals/assists, saves/cleanSheets, etc.) for a saved
 * squad — same three-source merge (team endpoint → rating.json → CDN stat lists) used
 * by the analytics route, extracted here so the My Team page can show the same numbers.
 */
export async function getSquadSeasonStats(
  leagueId: number,
  players: SquadPlayer[],
  opts?: Opts,
): Promise<Map<number, PlayerSeasonStats>> {
  if (players.length === 0) return new Map();

  const leagueTeams = await getLeagueTeamsCached(leagueId, opts).catch((): FotMobTeam[] => []);
  const teamNameToId = new Map<string, number>(leagueTeams.map((t) => [t.name, t.id]));

  const byTeam = new Map<number, string>();
  for (const p of players) {
    const teamId = p.teamId || teamNameToId.get(p.teamName);
    if (teamId && !byTeam.has(teamId)) byTeam.set(teamId, p.teamName);
  }

  const teamStatMaps = await Promise.all(
    Array.from(byTeam.entries()).map(([teamId, teamName]) => getTeamPlayerStatsCached(teamId, teamName, opts)),
  );

  const allStats = new Map<number, PlayerSeasonStats>();
  for (const map of teamStatMaps) {
    map.forEach((stats, id) => allStats.set(id, stats));
  }

  const seasonId = await getLeagueSeasonIdCached(leagueId, opts);
  if (seasonId) {
    const rankMap = await getLeagueRatingStatsCached(leagueId, seasonId, opts);
    rankMap.forEach((rank, id) => {
      const s = allStats.get(id);
      if (s) {
        s.leagueRank    = rank.leagueRank;
        s.matchesPlayed = rank.matchesPlayed;
        s.minutesPlayed = rank.minutesPlayed;
      }
    });

    const cdnStats = await getLeagueAllPlayerStatsCached(leagueId, seasonId, opts);
    cdnStats.forEach((partial, id) => {
      const existing = allStats.get(id);
      if (!existing) return;
      for (const [k, v] of Object.entries(partial)) {
        if (v != null) (existing as unknown as Record<string, unknown>)[k] = v;
      }
    });
  }

  return allStats;
}
