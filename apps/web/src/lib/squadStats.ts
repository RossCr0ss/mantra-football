import {
  getLeagueTeamsCached,
  getTeamPlayerStatsCached,
  getLeagueRatingStatsCached,
  getLeagueSeasonIdCached,
  getLeaguePreviousSeasonIdCached,
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

/**
 * Previous-completed-season stats for a squad — used only as an early-season
 * scoring fallback (see calcScore in lib/tourScoring.ts), never shown as this
 * season's numbers. Unlike getSquadSeasonStats this skips the team-endpoint
 * call entirely (it only ever reflects the *current* season, not an override),
 * so it's sourced purely from the two season-parameterized endpoints: rating.json
 * (rating/matchesPlayed/minutesPlayed) and the CDN stat lists (goals, assists,
 * xG, defensive stats, GK stats). Fields the team endpoint alone provides
 * (aerialsWon, dribbledPast, successfulDribbles, highClaims, etc.) are left
 * undefined for the prior season — an accepted gap, not a bug.
 */
export async function getSquadPriorSeasonStats(
  leagueId: number,
  players: SquadPlayer[],
  opts?: Opts,
): Promise<Map<number, Partial<PlayerSeasonStats>>> {
  if (players.length === 0) return new Map();

  const seasonId = await getLeaguePreviousSeasonIdCached(leagueId, opts);
  if (!seasonId) return new Map();

  const squadIds = new Set(players.map((p) => p.id));
  const stats = new Map<number, Partial<PlayerSeasonStats>>();

  const rankMap = await getLeagueRatingStatsCached(leagueId, seasonId, opts).catch(
    () => new Map<number, { leagueRank: number; matchesPlayed: number; minutesPlayed: number; rating: number | null }>(),
  );
  rankMap.forEach((rank, id) => {
    if (!squadIds.has(id)) return;
    stats.set(id, {
      playerId: id,
      rating: rank.rating,
      matchesPlayed: rank.matchesPlayed,
      minutesPlayed: rank.minutesPlayed,
    });
  });

  const cdnStats = await getLeagueAllPlayerStatsCached(leagueId, seasonId, opts).catch(
    () => new Map<number, Partial<PlayerSeasonStats>>(),
  );
  cdnStats.forEach((partial, id) => {
    if (!squadIds.has(id)) return;
    const existing = stats.get(id) ?? { playerId: id };
    stats.set(id, { ...existing, ...partial });
  });

  // rating.json only lists players who cleared some internal appearance
  // threshold — a squad-rotation player (confirmed live: a summer signing who
  // played ~11 matches for their previous club) can have real CDN counting
  // stats (tackles, minutes) with no rating.json entry at all, leaving
  // matchesPlayed unset. Without a match count the per-match blend in
  // calcScore can't turn those totals into a rate, so estimate it from minutes.
  stats.forEach((s) => {
    if (s.matchesPlayed == null && s.minutesPlayed != null && s.minutesPlayed > 0) {
      s.matchesPlayed = Math.max(1, Math.round(s.minutesPlayed / 90));
    }
  });

  return stats;
}
