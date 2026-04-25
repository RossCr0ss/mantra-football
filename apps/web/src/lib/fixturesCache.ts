import { getDb } from './mongodb';
import { fetchLeagueData } from './fotmob';
import { CACHE_TTL } from './mongoCache';
import type { LeagueMatch, TeamFixture } from './fotmob';

interface LeagueCacheDoc {
  leagueId: number;
  tablePositions: Record<string, number>;
  matches: LeagueMatch[];
  currentRound: string | null;
  cachedAt: Date;
}

/**
 * Returns all league matches + table positions using a per-league MongoDB SWR cache.
 *
 * | Cache age          | Behaviour                                      |
 * |--------------------|------------------------------------------------|
 * | < 30 min (fresh)   | Serve immediately, no action                   |
 * | 30 min – 6 h       | Serve immediately + background refresh         |
 * | > 6 h or missing   | Synchronous fetch, then store & serve          |
 * | Fetch fails + stale| Return stale data (graceful degradation)       |
 *
 * Pass `forceRefresh: true` to skip TTL and always fetch from FotMob.
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
  const db = await getDb();
  const col = db.collection<LeagueCacheDoc>('fixtures_cache');

  if (!forceRefresh) {
    const cached = await col.findOne({ leagueId });

    if (cached?.matches && cached.tablePositions) {
      const ageMs = Date.now() - cached.cachedAt.getTime();

      if (ageMs < CACHE_TTL.FIXTURES.freshMs) {
        return {
          matches: cached.matches,
          tablePositions: positionsFromRecord(cached.tablePositions),
          currentRound: cached.currentRound ?? null,
          cachedAt: cached.cachedAt,
        };
      }

      if (ageMs < CACHE_TTL.FIXTURES.staleMs) {
        // Stale-while-revalidate: respond instantly, refresh in background
        void fetchLeagueData(leagueId)
          .then(({ tablePositions, matches, currentRound }) =>
            col.updateOne(
              { leagueId },
              {
                $set: {
                  leagueId,
                  tablePositions: positionsToRecord(tablePositions),
                  matches,
                  currentRound,
                  cachedAt: new Date(),
                },
              },
              { upsert: true },
            ),
          )
          .catch(() => { /* silent — stale data keeps serving */ });

        return {
          matches: cached.matches,
          tablePositions: positionsFromRecord(cached.tablePositions),
          currentRound: cached.currentRound ?? null,
          cachedAt: cached.cachedAt,
        };
      }
    }
  }

  // Too stale, missing, or forceRefresh — fetch synchronously.
  let result: Awaited<ReturnType<typeof fetchLeagueData>>;
  try {
    result = await fetchLeagueData(leagueId);
  } catch {
    // Graceful degradation
    const cached = await col.findOne({ leagueId });
    if (cached?.matches) {
      return {
        matches: cached.matches,
        tablePositions: positionsFromRecord(cached.tablePositions),
        currentRound: cached.currentRound ?? null,
        cachedAt: cached.cachedAt,
      };
    }
    return { matches: [], tablePositions: new Map(), currentRound: null, cachedAt: null };
  }

  const { tablePositions, matches, currentRound } = result;
  const cachedAt = new Date();
  await col.updateOne(
    { leagueId },
    {
      $set: {
        leagueId,
        tablePositions: positionsToRecord(tablePositions),
        matches,
        currentRound,
        cachedAt,
      },
    },
    { upsert: true },
  );

  return { matches, tablePositions, currentRound, cachedAt };
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
