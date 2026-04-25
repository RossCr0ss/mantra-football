import { getDb } from './mongodb';
import { deleteCache } from './mongoCache';
import { getTeamPlayersCached } from './fotmobCache';
import type { PlayerInjuryInfo } from './fotmob';

const INJURY_CACHE_COLLECTION = 'fotmob_injuries';

function buildFromOverride(override: Record<string, unknown>): PlayerInjuryInfo {
  return {
    name: override.name as string,
    expectedReturn: (override.expectedReturn as string) ?? null,
    expectedReturnDate: (override.expectedReturnDate as string) ?? null,
    lastUpdated: (override.lastUpdated as string) ?? null,
    overridden: true,
  };
}

async function injuryFromTeamData(
  playerId: number,
  teamId: number,
  teamName: string,
): Promise<PlayerInjuryInfo | null> {
  try {
    const players = await getTeamPlayersCached(teamId, teamName);
    const player = players.find((p) => p.id === playerId);
    if (!player?.injured) return null;
    return { name: 'Injured', expectedReturn: null, expectedReturnDate: null, lastUpdated: null };
  } catch {
    return null;
  }
}

async function findPlayerTeam(
  playerId: number,
): Promise<{ teamId: number; teamName: string } | null> {
  const db = await getDb();
  const squadDoc = await db.collection('squads').findOne(
    { 'players.id': playerId },
    { projection: { 'players.$': 1 } },
  );
  const p = squadDoc?.players?.[0];
  if (!p?.teamId) return null;
  return { teamId: p.teamId as number, teamName: (p.teamName as string) ?? '' };
}

/**
 * Returns injury info for a player, preferring any manual DB override over
 * live team data. Falls back to the FotMob team endpoint (cached) which exposes
 * an `injured` boolean — the per-player `playerData` endpoint is Cloudflare-blocked.
 */
export async function getPlayerInjury(playerId: number): Promise<PlayerInjuryInfo | null> {
  const db = await getDb();
  const override = await db.collection('player_injuries').findOne({ playerId });

  if (override) {
    if (override.cleared) {
      return {
        name: 'Manually healed',
        expectedReturn: null,
        expectedReturnDate: null,
        lastUpdated: override.lastUpdated as string ?? null,
        overridden: true,
        cleared: true,
      };
    }
    return buildFromOverride(override as Record<string, unknown>);
  }

  const team = await findPlayerTeam(playerId);
  if (!team) return null;
  return injuryFromTeamData(playerId, team.teamId, team.teamName);
}

/**
 * Batch-fetches injury info for all players in one pass.
 * Groups players by team to minimise team data fetches (one per team, all cached).
 */
export async function getPlayerInjuriesBatch(
  players: Array<{ id: number; teamId: number; teamName: string }>,
): Promise<Record<number, PlayerInjuryInfo | null>> {
  if (players.length === 0) return {};

  const db = await getDb();
  const playerIds = players.map((p) => p.id);
  const overrides = await db.collection('player_injuries')
    .find({ playerId: { $in: playerIds } })
    .toArray();
  const overrideMap = new Map(overrides.map((o) => [o.playerId as number, o]));

  // Group players without overrides by team
  const teamGroups = new Map<number, { teamName: string; playerIds: number[] }>();
  for (const p of players) {
    if (overrideMap.has(p.id)) continue;
    if (!teamGroups.has(p.teamId)) {
      teamGroups.set(p.teamId, { teamName: p.teamName, playerIds: [] });
    }
    teamGroups.get(p.teamId)!.playerIds.push(p.id);
  }

  // Fetch team data per team (uses existing fotmob_players cache)
  const teamInjuredSets = new Map<number, Set<number>>();
  await Promise.all(
    Array.from(teamGroups.entries()).map(async ([teamId, { teamName }]) => {
      try {
        const teamPlayers = await getTeamPlayersCached(teamId, teamName);
        teamInjuredSets.set(
          teamId,
          new Set(teamPlayers.filter((p) => p.injured).map((p) => p.id)),
        );
      } catch {
        teamInjuredSets.set(teamId, new Set());
      }
    }),
  );

  const result: Record<number, PlayerInjuryInfo | null> = {};
  for (const p of players) {
    const override = overrideMap.get(p.id);
    if (override) {
      result[p.id] = override.cleared
        ? {
            name: 'Manually healed',
            expectedReturn: null,
            expectedReturnDate: null,
            lastUpdated: override.lastUpdated as string ?? null,
            overridden: true,
            cleared: true,
          }
        : buildFromOverride(override as Record<string, unknown>);
    } else {
      const injured = teamInjuredSets.get(p.teamId)?.has(p.id) ?? false;
      result[p.id] = injured
        ? { name: 'Injured', expectedReturn: null, expectedReturnDate: null, lastUpdated: null }
        : null;
    }
  }

  return result;
}

/**
 * Fetches fresh injury state directly, bypassing any DB override.
 * Used after deleting an override so the client can immediately reflect live state.
 */
export async function fetchPlayerInjuryFresh(playerId: number): Promise<PlayerInjuryInfo | null> {
  const team = await findPlayerTeam(playerId);
  if (!team) return null;
  return injuryFromTeamData(playerId, team.teamId, team.teamName);
}

/** Evicts the FotMob injury cache entry for a player. */
export async function evictInjuryCache(playerId: number): Promise<void> {
  await deleteCache(INJURY_CACHE_COLLECTION, { playerId });
}
