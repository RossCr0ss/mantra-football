import { getDb } from './mongodb';

// ─── TTL constants ────────────────────────────────────────────────────────────

export interface CacheTTL {
  /** Serve from cache with no background action. */
  freshMs: number;
  /**
   * Serve from cache immediately AND trigger a silent background refresh so the
   * next request gets fresher data.  Background refresh is deduplicated — only
   * one in-flight refresh per (collection, filter) key at a time.
   */
  staleMs: number;
}

/**
 * TTL pairs for each data category.
 *
 * freshMs / staleMs are tuned around typical FotMob update cadences:
 *   - Player stats / ratings refresh after each matchday (1-3×/week)
 *   - Fixture schedule + table positions refresh whenever a match finishes
 *   - Odds drift in the hours before kick-off, irrelevant afterwards
 *   - Team lists / season IDs barely change (transfers, once-per-season)
 */
export const CACHE_TTL = {
  /** League team lists — transfer windows only */
  TEAMS:    { freshMs: 24 * 3_600_000, staleMs:  7 * 86_400_000 },
  /** Team player stats (goals/assists/rating) — post-matchday cadence */
  PLAYERS:  { freshMs:  2 * 3_600_000, staleMs: 24 * 3_600_000  },
  /** League-wide rating/stat rankings — same post-matchday cadence */
  RATINGS:  { freshMs:  2 * 3_600_000, staleMs: 24 * 3_600_000  },
  /** Match odds — only meaningful ~24 h before kick-off */
  ODDS:     { freshMs: 15 *    60_000, staleMs:  2 * 3_600_000  },
  /** Primary season ID — once per season */
  SEASON:   { freshMs: 24 * 3_600_000, staleMs: 30 * 86_400_000 },
  /** Fixture schedule + league table positions */
  FIXTURES: { freshMs: 30 *    60_000, staleMs:  6 * 3_600_000  },
  /** Per-player injury data — changes after matches / press conferences */
  INJURIES: { freshMs:  2 * 3_600_000, staleMs: 12 * 3_600_000  },
} satisfies Record<string, CacheTTL>;

// ─── Core cache function ──────────────────────────────────────────────────────

interface CacheDoc<T> {
  data: T;
  cachedAt: Date;
  [key: string]: unknown;
}

/** Deduplicates in-progress background refreshes so only one runs per key. */
const backgroundRefreshes = new Map<string, Promise<void>>();

function docKey(collection: string, filter: Record<string, unknown>): string {
  return `${collection}:${JSON.stringify(filter, Object.keys(filter).sort())}`;
}

/**
 * SWR MongoDB cache.
 *
 * | Cached doc age            | Behaviour                               |
 * |---------------------------|-----------------------------------------|
 * | < freshMs                 | Serve immediately, no action            |
 * | freshMs → staleMs         | Serve immediately + background refresh  |
 * | > staleMs  or  no doc     | Synchronous fetch, then store & serve   |
 * | Fetch fails + stale exists| Return stale (graceful degradation)     |
 *
 * Pass `forceRefresh: true` to skip TTL checks entirely and always fetch fresh
 * (used when the user explicitly hits the Refresh button in the UI).
 */
export async function withCache<T>(
  collection: string,
  filter: Record<string, unknown>,
  ttl: CacheTTL,
  fetcher: () => Promise<T>,
  { forceRefresh = false }: { forceRefresh?: boolean } = {},
): Promise<T> {
  const db = await getDb();
  const col = db.collection<CacheDoc<T>>(collection);

  const isEmptyArr = (d: CacheDoc<T> | null) =>
    Array.isArray(d?.data) && (d!.data as unknown[]).length === 0;

  if (!forceRefresh) {
    const cached = await col.findOne(filter as Parameters<typeof col.findOne>[0]);

    if (cached && !isEmptyArr(cached)) {
      const ageMs = Date.now() - cached.cachedAt.getTime();

      if (ageMs < ttl.freshMs) {
        return cached.data;
      }

      if (ageMs < ttl.staleMs) {
        // Stale-while-revalidate: respond instantly, refresh silently in background
        const key = docKey(collection, filter);
        if (!backgroundRefreshes.has(key)) {
          const p: Promise<void> = fetcher()
            .then((data) =>
              col.updateOne(
                filter as Parameters<typeof col.updateOne>[0],
                { $set: { ...filter, data, cachedAt: new Date() } },
                { upsert: true },
              ).then(() => undefined),
            )
            .catch(() => undefined)
            .finally(() => backgroundRefreshes.delete(key));
          backgroundRefreshes.set(key, p);
        }
        return cached.data;
      }
    }
  }

  // Cache is too stale, missing, or force-refresh requested — fetch synchronously.
  let data: T;
  try {
    data = await fetcher();
  } catch (err) {
    // Graceful degradation: serve stale if FotMob is temporarily unreachable.
    const cached = await col.findOne(filter as Parameters<typeof col.findOne>[0]);
    if (cached && !isEmptyArr(cached)) return cached.data;
    throw err;
  }

  await col.updateOne(
    filter as Parameters<typeof col.updateOne>[0],
    { $set: { ...filter, data, cachedAt: new Date() } },
    { upsert: true },
  );
  return data;
}

/** Evicts a single cache document so the next call fetches fresh data. */
export async function deleteCache(
  collection: string,
  filter: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  await db.collection(collection).deleteOne(filter as Parameters<ReturnType<typeof db.collection>['deleteOne']>[0]);
}

/**
 * Returns the `cachedAt` timestamp for a stored document, or `null` if not
 * cached yet.  Useful for surfacing "Last updated X ago" in the UI.
 */
export async function getCachedAt(
  collection: string,
  filter: Record<string, unknown>,
): Promise<Date | null> {
  const db = await getDb();
  const doc = await db
    .collection<{ cachedAt?: Date }>(collection)
    .findOne(filter as Parameters<ReturnType<typeof db.collection>['findOne']>[0], {
      projection: { cachedAt: 1 },
    });
  return doc?.cachedAt ?? null;
}
