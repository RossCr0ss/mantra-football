/**
 * MongoDB SWR-cached wrappers for all FotMob API calls.
 * Use these in API routes — never call fotmob.ts raw functions directly from routes.
 *
 * All functions accept an optional `opts.forceRefresh` flag which bypasses the
 * TTL and fetches synchronously from FotMob.  Pass it when the user explicitly
 * requests a data refresh.
 *
 * Collection layout:
 *   fotmob_teams      { leagueId, data: FotMobTeam[], cachedAt }
 *   fotmob_players    { teamId,   data: FotMobPlayer[], cachedAt }
 *   fotmob_stats      { teamId,   data: PlayerSeasonStats[], cachedAt }
 *   fotmob_ratings    { leagueId, seasonId, data: RatingEntry[], cachedAt }
 *   fotmob_season     { leagueId, data: string | null, cachedAt }
 *   fotmob_odds       { matchId,  data: FixtureOdds | null, cachedAt }
 *   fotmob_stat_list  { leagueId, seasonId, statKey, data: StatListEntry[], cachedAt }
 */

import {
  fetchLeagueTeams,
  fetchTeamPlayers,
  fetchTeamPlayerStats,
  fetchLeagueRatingStats,
  fetchLeagueSeasonId,
  fetchMatchOdds,
  fetchLeagueStatsList,
  fetchPlayerRecentMatches,
  fetchPlayerSeasonStats,
  type FotMobTeam,
  type FotMobPlayer,
  type PlayerSeasonStats,
  type FixtureOdds,
  type PlayerRecentMatch,
} from './fotmob';
import { withCache, CACHE_TTL } from './mongoCache';

type Opts = { forceRefresh?: boolean };

// ─── Teams ────────────────────────────────────────────────────────────────────

export function getLeagueTeamsCached(
  leagueId: number,
  opts?: Opts,
): Promise<FotMobTeam[]> {
  return withCache(
    'fotmob_teams',
    { leagueId },
    CACHE_TTL.TEAMS,
    () => fetchLeagueTeams(leagueId),
    opts,
  );
}

// ─── Players ──────────────────────────────────────────────────────────────────

export function getTeamPlayersCached(
  teamId: number,
  teamName: string,
  opts?: Opts,
): Promise<FotMobPlayer[]> {
  return withCache(
    'fotmob_players',
    { teamId },
    CACHE_TTL.PLAYERS,
    () => fetchTeamPlayers(teamId, teamName),
    opts,
  );
}

// ─── Per-team season stats (Map serialised as array) ─────────────────────────

interface StoredStat extends PlayerSeasonStats {
  _id?: unknown;
}

export async function getTeamPlayerStatsCached(
  teamId: number,
  teamName: string,
  opts?: Opts,
): Promise<Map<number, PlayerSeasonStats>> {
  const rows = await withCache<StoredStat[]>(
    'fotmob_stats',
    { teamId },
    CACHE_TTL.PLAYERS,
    async () => {
      const map = await fetchTeamPlayerStats(teamId, teamName);
      return Array.from(map.values());
    },
    opts,
  );
  return new Map(rows.map((r) => [r.playerId, r]));
}

// ─── League-wide rating rankings (Map serialised as array) ───────────────────

interface RatingEntry {
  playerId: number;
  leagueRank: number;
  matchesPlayed: number;
  minutesPlayed: number;
}

export async function getLeagueRatingStatsCached(
  leagueId: number,
  seasonId: string,
  opts?: Opts,
): Promise<Map<number, { leagueRank: number; matchesPlayed: number; minutesPlayed: number }>> {
  const rows = await withCache<RatingEntry[]>(
    'fotmob_ratings',
    { leagueId, seasonId },
    CACHE_TTL.RATINGS,
    async () => {
      const map = await fetchLeagueRatingStats(leagueId, seasonId);
      return Array.from(map.entries()).map(([playerId, v]) => ({ playerId, ...v }));
    },
    opts,
  );
  return new Map(rows.map(({ playerId, ...v }) => [playerId, v]));
}

// ─── Primary season ID ────────────────────────────────────────────────────────

export function getLeagueSeasonIdCached(
  leagueId: number,
  opts?: Opts,
): Promise<string | null> {
  return withCache(
    'fotmob_season',
    { leagueId },
    CACHE_TTL.SEASON,
    () => fetchLeagueSeasonId(leagueId),
    opts,
  );
}

// ─── Match odds ───────────────────────────────────────────────────────────────

export function getMatchOddsCached(
  matchId: string,
  opts?: Opts,
): Promise<FixtureOdds | null> {
  return withCache(
    'fotmob_odds',
    { matchId },
    CACHE_TTL.ODDS,
    () => fetchMatchOdds(matchId),
    opts,
  );
}

// ─── Per-player season stats (from playerData endpoint) ──────────────────────

export function getPlayerSeasonStatsCached(
  playerId: number,
  opts?: Opts,
): Promise<Partial<PlayerSeasonStats>> {
  return withCache(
    'fotmob_player_stats',
    { playerId },
    CACHE_TTL.PLAYERS,
    () => fetchPlayerSeasonStats(playerId),
    opts,
  );
}

// ─── Player form (recent 5 matches) ──────────────────────────────────────────

// Wrapped in an object so the cache layer treats an empty result the same as a
// populated one — without this, withCache's isEmptyArr check skips empty arrays
// and re-fetches on every request, hammering the (currently broken) endpoint.
export function getPlayerFormCached(
  playerId: number,
  opts?: Opts,
): Promise<PlayerRecentMatch[]> {
  return withCache<{ matches: PlayerRecentMatch[] }>(
    'fotmob_form',
    { playerId },
    CACHE_TTL.INJURIES,
    async () => ({ matches: await fetchPlayerRecentMatches(playerId) }),
    opts,
  ).then((r) => {
    // Handle legacy cache entries that stored the array directly
    if (Array.isArray(r)) return r as unknown as PlayerRecentMatch[];
    return r.matches ?? [];
  });
}

// ─── League stat lists (cleansheet, saves, xG, etc.) ─────────────────────────

interface StatListEntry { playerId: number; value: number }

export async function getLeagueStatsListCached(
  leagueId: number,
  seasonId: string,
  statKey: string,
  opts?: Opts & { useSubStatValue?: boolean },
): Promise<Map<number, number>> {
  const useSubStatValue = opts?.useSubStatValue ?? false;
  const rows = await withCache<StatListEntry[]>(
    'fotmob_stat_list',
    { leagueId, seasonId, statKey, useSubStatValue },
    CACHE_TTL.RATINGS,
    async () => {
      const map = await fetchLeagueStatsList(leagueId, seasonId, statKey, useSubStatValue);
      return Array.from(map.entries()).map(([playerId, value]) => ({ playerId, value }));
    },
    opts,
  );
  return new Map(rows.map(({ playerId, value }) => [playerId, value]));
}
