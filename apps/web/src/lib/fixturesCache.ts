import { fetchLeagueData } from './fotmob';
import { CACHE_TTL, withCache, getCachedAt } from './mongoCache';
import type { LeagueMatch, TeamFixture } from './fotmob';

/** Collection for league schedule + table positions (shape differs from the old `fixtures_cache`). */
const FIXTURES_COLLECTION = 'fixtures_league';

/** What is stored (Mongo cannot store a Map, so table positions are a plain record). */
interface LeagueFixtureData {
  tablePositions: Record<string, number>;
  matches: LeagueMatch[];
  currentRound: string | null;
}

/**
 * Returns all league matches + table positions through the shared SWR cache (`withCache`,
 * `CACHE_TTL.FIXTURES`): fresh → served; stale → served + background refresh; too old → fetched.
 * `forceRefresh` is throttled by `withCache` (MIN_FORCE_REFRESH_MS). If FotMob fails and nothing is
 * cached, an empty result is returned instead of throwing; an empty FotMob answer is never cached.
 */
export async function getLeagueFixturesCached(
  leagueId: number,
  { forceRefresh = false }: { forceRefresh?: boolean } = {},
): Promise<{
  matches: LeagueMatch[];
  tablePositions: Map<number, number>;
  currentRound: string | null;
  cachedAt: Date | null;
}> {
  let data: LeagueFixtureData;
  try {
    data = await withCache<LeagueFixtureData>(
      FIXTURES_COLLECTION,
      { leagueId },
      CACHE_TTL.FIXTURES,
      async () => {
        const { tablePositions, matches, currentRound } = await fetchLeagueData(leagueId);
        // fetchLeagueData returns empty data on HTTP errors — don't let that overwrite/seed the cache.
        if (matches.length === 0 && tablePositions.size === 0) throw new Error('FotMob returned no league data');
        return { tablePositions: positionsToRecord(tablePositions), matches, currentRound };
      },
      { forceRefresh },
    );
  } catch {
    return { matches: [], tablePositions: new Map(), currentRound: null, cachedAt: null };
  }

  return {
    matches: data.matches,
    tablePositions: positionsFromRecord(data.tablePositions),
    currentRound: data.currentRound ?? null,
    cachedAt: await getCachedAt(FIXTURES_COLLECTION, { leagueId }),
  };
}

/**
 * Pure function — builds the TeamFixture for the current active round.
 * Falls back to the next unfinished match when currentRound is unavailable.
 */
export function buildTeamFixtures(
  teamId: number,
  matches: LeagueMatch[],
  tablePositions: Map<number, number>,
  currentRound: string | null,
  count = 1,
): TeamFixture[] {
  const totalTeams = tablePositions.size || 20;

  const nextUnfinished = () =>
    matches
      .filter(
        (m) =>
          !m.finished &&
          m.date &&
          (m.homeTeam.id === teamId || m.awayTeam.id === teamId),
      )
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, count);

  const roundMatches = currentRound
    ? matches.filter(
        (m) =>
          m.round === currentRound &&
          !m.finished &&
          (m.homeTeam.id === teamId || m.awayTeam.id === teamId),
      )
    : [];

  const teamMatches = roundMatches.length > 0 ? roundMatches : nextUnfinished();

  return teamMatches.slice(0, count).map((m): TeamFixture => {
    const isHome = m.homeTeam.id === teamId;
    const opponent = isHome ? m.awayTeam : m.homeTeam;
    const oppPos = tablePositions.get(opponent.id) ?? null;
    const difficulty =
      oppPos !== null
        ? Math.max(1, Math.min(5, Math.ceil((oppPos / totalTeams) * 5)))
        : null;

    return { ...m, isHome, opponent, difficulty, odds: null };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function positionsToRecord(map: Map<number, number>): Record<string, number> {
  const obj: Record<string, number> = {};
  map.forEach((v, k) => { obj[String(k)] = v; });
  return obj;
}

function positionsFromRecord(obj: Record<string, number> | null | undefined): Map<number, number> {
  if (!obj) return new Map();
  return new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]));
}
