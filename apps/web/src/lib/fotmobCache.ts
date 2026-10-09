/**
 * MongoDB SWR-cached wrappers for all FotMob API calls.
 * Use these in API routes — never call fotmob.ts raw functions directly from routes.
 *
 * All functions accept an optional `opts.forceRefresh` flag which bypasses the
 * TTL and fetches synchronously from FotMob.  Pass it when the user explicitly
 * requests a data refresh.
 *
 * Collection layout:
 *   fotmob_teams           { leagueId, data: FotMobTeam[], cachedAt }
 *   fotmob_players         { teamId,   data: FotMobPlayer[], cachedAt }
 *   fotmob_stats           { teamId,   data: PlayerSeasonStats[], cachedAt }
 *   fotmob_ratings         { leagueId, seasonId, data: RatingEntry[], cachedAt }
 *   fotmob_season          { leagueId, data: string | null, cachedAt }
 *   fotmob_odds            { matchId,  data: FixtureOdds | null, cachedAt }
 *   fotmob_stat_list       { leagueId, seasonId, statKey, data: StatListEntry[], cachedAt }
 *   fotmob_all_stats       { leagueId, seasonId, data: AllStatEntry[], cachedAt }
 */

import {
  fetchLeagueTeams,
  fetchTeamPlayers,
  fetchTeamPlayerStats,
  fetchLeagueRatingStats,
  fetchLeagueSeasonId,
  fetchLeaguePreviousSeasonId,
  fetchMatchOdds,
  fetchLeagueAllPlayerStats,
  fetchPlayerRecentMatches,
  fetchPlayerRichStats,
  fetchPlayerCurrentTeam,
  fetchMatchCardEvents,
  searchFotMobPlayer,
  fetchPlayerPrimaryPosition,
  type FotMobTeam,
  type FotMobPlayer,
  type PlayerSeasonStats,
  type FixtureOdds,
  type PlayerRecentMatch,
  type PlayerRichStats,
  type PlayerCurrentTeam,
  type FotMobSearchResult,
  type MatchCardEvent,
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
  rating: number | null;
}

export async function getLeagueRatingStatsCached(
  leagueId: number,
  seasonId: string,
  opts?: Opts,
): Promise<Map<number, { leagueRank: number; matchesPlayed: number; minutesPlayed: number; rating: number | null }>> {
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

// Previous season's tournamentId never changes once the current season is under
// way, so it's safe to reuse the same long TTL as the current-season id.
export function getLeaguePreviousSeasonIdCached(
  leagueId: number,
  opts?: Opts,
): Promise<string | null> {
  return withCache(
    'fotmob_prev_season',
    { leagueId },
    CACHE_TTL.SEASON,
    () => fetchLeaguePreviousSeasonId(leagueId),
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

export function getPlayerCurrentTeamCached(
  playerId: number,
  opts?: Opts,
): Promise<PlayerCurrentTeam | null> {
  return withCache(
    'fotmob_player_team',
    { playerId },
    CACHE_TTL.PLAYER_TEAM,
    () => fetchPlayerCurrentTeam(playerId),
    opts,
  );
}

// ─── Player search (fallback when a team's own squad list is incomplete) ──────

// Wrapped in an object for the same reason as getPlayerFormCached — a name with
// no results is a valid, common outcome that must stay cached rather than
// re-querying FotMob on every request.
export function searchFotMobPlayerCached(
  term: string,
  opts?: Opts,
): Promise<FotMobSearchResult[]> {
  return withCache<{ results: FotMobSearchResult[] }>(
    'fotmob_search',
    { term },
    CACHE_TTL.PLAYER_TEAM,
    async () => ({ results: await searchFotMobPlayer(term) }),
    opts,
  ).then((r) => (Array.isArray(r) ? (r as unknown as FotMobSearchResult[]) : r.results ?? []));
}

export function getPlayerPrimaryPositionCached(
  playerId: number,
  opts?: Opts,
): Promise<{ label: string; group: 'GK' | 'DEF' | 'MID' | 'FWD' } | null> {
  return withCache(
    'fotmob_player_position',
    { playerId },
    CACHE_TTL.PLAYER_TEAM,
    () => fetchPlayerPrimaryPosition(playerId),
    opts,
  );
}

// ─── Match card events (season-long suspension tracking) ──────────────────────

// Wrapped in an object — a finished match with zero cards is common and must
// stay cached, but withCache's isEmptyArr guard would otherwise re-fetch it forever.
export function getMatchCardEventsCached(
  matchId: string,
  opts?: Opts,
): Promise<MatchCardEvent[]> {
  return withCache<{ cards: MatchCardEvent[] }>(
    'fotmob_match_cards',
    { matchId },
    CACHE_TTL.MATCH_CARDS,
    async () => ({ cards: await fetchMatchCardEvents(matchId) }),
    opts,
  ).then((r) => (Array.isArray(r) ? (r as unknown as MatchCardEvent[]) : r.cards ?? []));
}

// ─── Player form (recent 5 matches) ──────────────────────────────────────────

// Wrapped in an object so the cache layer treats an empty result the same as a
// populated one — without this, withCache's isEmptyArr check skips empty arrays
// and re-fetches on every request (e.g. a player who hasn't played this season yet).
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

// ─── Per-player rich stats (statsSection with percentile ranks) ───────────────

export function getPlayerRichStatsCached(
  playerId: number,
  opts?: Opts,
): Promise<PlayerRichStats | null> {
  return withCache<PlayerRichStats | null>(
    'fotmob_rich_stats',
    { playerId },
    CACHE_TTL.PLAYERS,
    () => fetchPlayerRichStats(playerId),
    opts,
  );
}

// ─── League stat lists (single key) ──────────────────────────────────────────

interface AllStatEntry { playerId: number; stats: Partial<PlayerSeasonStats> }

export async function getLeagueAllPlayerStatsCached(
  leagueId: number,
  seasonId: string,
  opts?: Opts,
): Promise<Map<number, Partial<PlayerSeasonStats>>> {
  const rows = await withCache<AllStatEntry[]>(
    'fotmob_all_stats',
    { leagueId, seasonId },
    CACHE_TTL.RATINGS,
    async () => {
      const map = await fetchLeagueAllPlayerStats(leagueId, seasonId);
      return Array.from(map.entries()).map(([playerId, stats]) => ({ playerId, stats }));
    },
    opts,
  );
  return new Map(rows.map(({ playerId, stats }) => [playerId, stats]));
}
