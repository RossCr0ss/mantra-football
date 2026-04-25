import { getDb } from './mongodb';
import { fetchPlayerInjuryInfo } from './fotmob';
import { withCache, deleteCache, CACHE_TTL } from './mongoCache';
import type { PlayerInjuryInfo } from './fotmob';

const INJURY_COLLECTION = 'fotmob_injuries';

function buildFromOverride(override: Record<string, unknown>): PlayerInjuryInfo {
  return {
    name: override.name as string,
    expectedReturn: (override.expectedReturn as string) ?? null,
    expectedReturnDate: (override.expectedReturnDate as string) ?? null,
    lastUpdated: (override.lastUpdated as string) ?? null,
    overridden: true,
  };
}

/**
 * Returns injury info for a player, preferring any manual DB override over
 * live FotMob data. FotMob responses are cached per-player (2h fresh / 12h stale).
 */
export async function getPlayerInjury(playerId: number): Promise<PlayerInjuryInfo | null> {
  const db = await getDb();
  const override = await db.collection('player_injuries').findOne({ playerId });

  if (!override) {
    return withCache(
      INJURY_COLLECTION,
      { playerId },
      CACHE_TTL.INJURIES,
      () => fetchPlayerInjuryInfo(playerId),
    );
  }

  if (override.cleared) return null;
  return buildFromOverride(override as Record<string, unknown>);
}

/**
 * Batch-fetches injury info for all players in one call.
 * Uses a single DB query for overrides, then parallel cached FotMob lookups.
 * Much faster than calling getPlayerInjury() × N in a Promise.all.
 */
export async function getPlayerInjuriesBatch(
  playerIds: number[],
): Promise<Record<number, PlayerInjuryInfo | null>> {
  if (playerIds.length === 0) return {};

  const db = await getDb();
  const overrides = await db.collection('player_injuries')
    .find({ playerId: { $in: playerIds } })
    .toArray();
  const overrideMap = new Map(overrides.map((o) => [o.playerId as number, o]));

  const entries = await Promise.all(
    playerIds.map(async (playerId) => {
      const override = overrideMap.get(playerId);
      if (override) {
        if (override.cleared) return [playerId, null] as const;
        return [playerId, buildFromOverride(override as Record<string, unknown>)] as const;
      }
      const info = await withCache(
        INJURY_COLLECTION,
        { playerId },
        CACHE_TTL.INJURIES,
        () => fetchPlayerInjuryInfo(playerId),
      );
      return [playerId, info] as const;
    }),
  );

  return Object.fromEntries(entries);
}

/**
 * Fetches fresh injury data directly from FotMob, bypassing any DB override.
 * Used after deleting an override so the client can immediately reflect live state.
 */
export async function fetchPlayerInjuryFresh(playerId: number): Promise<PlayerInjuryInfo | null> {
  return fetchPlayerInjuryInfo(playerId);
}

/** Evicts the FotMob injury cache entry for a player. Call after a manual override is deleted. */
export async function evictInjuryCache(playerId: number): Promise<void> {
  await deleteCache(INJURY_COLLECTION, { playerId });
}
