# Cache Strategy

The app has two caching layers:

1. **Next.js fetch cache** — built-in, per-request ISR, used in `fotmob.ts` raw functions
2. **MongoDB TTL cache** — explicit, persistent across restarts, used in `fotmobCache.ts` + `fixturesCache.ts`

API routes always go through the MongoDB layer. Server components may use either.

---

## Why MongoDB instead of in-memory / Redis?

MongoDB is already running for squad persistence. Adding Redis would increase infrastructure complexity with no benefit at this traffic level. The MongoDB cache survives server restarts (unlike in-memory) and is straightforward to inspect and clear manually.

---

## Layer 1 — Next.js fetch cache (`fotmob.ts`)

Every `fetch()` call in `fotmob.ts` includes `next: { revalidate: N }`:

```typescript
fetch(url, { headers: FOTMOB_HEADERS, next: { revalidate: 3600 } })
```

This uses Next.js ISR (Incremental Static Regeneration) to cache responses at the HTTP layer. It is process-local — lost on server restart.

| Function | Revalidate |
|---|---|
| `fetchLeagueTeams` | 3600s (1h) |
| `fetchTeamPlayers` | 3600s (1h) |
| `fetchLeagueRatingStats` | 3600s (1h) |
| `fetchLeagueStatsList` | 3600s (1h) |
| `fetchLeagueSeasonId` | 86400s (24h) |
| `fetchMatchOdds` | 1800s (30m) |
| `fetchLeagueData` | 3600s (1h) |

This layer protects against cache misses on the MongoDB layer (e.g., after a restart) by preventing thundering-herd FotMob requests.

---

## Layer 2 — MongoDB TTL cache (`mongoCache.ts`)

`withCache<T>(collection, filter, ttlMs, fetcher)` is the generic utility:

```typescript
export async function withCache<T>(
  collection: string,          // MongoDB collection name
  filter: Record<string, unknown>,  // document key (e.g. { leagueId: 47 })
  ttlMs: number,               // how long the cache is valid
  fetcher: () => Promise<T>,   // called on miss or stale
): Promise<T>
```

**Hit path:** document exists AND `cachedAt > staleThreshold` AND data is not an empty array → returns `data` immediately.

**Miss path:** calls `fetcher()`, upserts `{ ...filter, data, cachedAt: new Date() }`.

### Empty array cache miss fix

A known FotMob issue: before the `fetchTeamPlayersFromLineup` fallback was added, some Ukrainian teams returned `[]` from `fetchTeamPlayers`. These empty arrays were cached, and subsequent requests kept serving the empty cache.

Fix in `withCache`:
```typescript
const isEmpty = Array.isArray(cached?.data) && (cached.data as unknown[]).length === 0;
if (cached && cached.cachedAt > staleThreshold && !isEmpty) {
  return cached.data;
}
```

An empty array is treated as a cache miss and triggers a fresh fetch.

### TTL constants (`CACHE_TTL` in `mongoCache.ts`)

| Key | Value | Collection(s) | Reasoning |
|---|---|---|---|
| `TEAMS` | 24h | `fotmob_teams` | Teams change only on transfer window open/close |
| `PLAYERS` | 6h | `fotmob_players`, `fotmob_stats`, `fotmob_player_stats`, `fotmob_form`, `fotmob_rich_stats` | Daily transfers / injuries can affect squad |
| `ODDS` | 30m | `fotmob_odds` | Odds shift significantly in the hours before kick-off |
| `RATINGS` | 24h | `fotmob_ratings`, `fotmob_stat_list`, `fotmob_all_stats` | FotMob updates CDN stats ~weekly |
| `SEASON` | 24h | `fotmob_season` | Primary season ID changes once per season |

---

## Fixtures cache (`fixturesCache.ts`)

This cache is separate from `withCache` because it stores a `Map<number, number>` (table positions) which MongoDB cannot store directly.

```typescript
interface LeagueCacheDoc {
  leagueId: number;
  tablePositions: Record<string, number>;  // serialised Map
  matches: LeagueMatch[];
  currentRound: string | null;
  cachedAt: Date;
}
```

**TTL:** 1 hour, hardcoded. After 1 hour, `getLeagueFixturesCached` calls `fetchLeagueData` and upserts the new doc.

**`buildTeamFixtures` is pure:** it takes pre-fetched `matches` and `tablePositions` as arguments, with no I/O. This makes it easy to test and reuse.

---

## `fotmobCache.ts` — cached wrappers

All expensive FotMob calls used in API routes go through this module. It wraps `fotmob.ts` functions with `withCache`.

| Function | Collection | Key | TTL |
|---|---|---|---|
| `getLeagueTeamsCached(leagueId)` | `fotmob_teams` | `{ leagueId }` | TEAMS 24h |
| `getTeamPlayersCached(teamId, teamName)` | `fotmob_players` | `{ teamId }` | PLAYERS 6h |
| `getTeamPlayerStatsCached(teamId, teamName)` | `fotmob_stats` | `{ teamId }` | PLAYERS 6h |
| `getLeagueRatingStatsCached(leagueId, seasonId)` | `fotmob_ratings` | `{ leagueId, seasonId }` | RATINGS 24h |
| `getLeagueSeasonIdCached(leagueId)` | `fotmob_season` | `{ leagueId }` | SEASON 24h |
| `getMatchOddsCached(matchId)` | `fotmob_odds` | `{ matchId }` | ODDS 30m |
| `getLeagueAllPlayerStatsCached(leagueId, seasonId)` | `fotmob_all_stats` | `{ leagueId, seasonId }` | RATINGS 24h |
| `getLeagueStatsListCached(leagueId, seasonId, statKey)` | `fotmob_stat_list` | `{ leagueId, seasonId, statKey }` | RATINGS 24h |
| `getPlayerSeasonStatsCached(playerId)` | `fotmob_player_stats` | `{ playerId }` | PLAYERS 6h |
| `getPlayerFormCached(playerId)` | `fotmob_form` | `{ playerId }` | INJURIES 1h |
| `getPlayerRichStatsCached(playerId)` | `fotmob_rich_stats` | `{ playerId }` | PLAYERS 6h |

### Map serialisation

`Map<K, V>` objects cannot be stored in MongoDB. Stats and ratings are serialised as arrays of objects before storing, and restored on read:

```typescript
// Store: Map<number, PlayerSeasonStats> → PlayerSeasonStats[] (with playerId added)
Array.from(map.values())

// Restore: PlayerSeasonStats[] → Map<number, PlayerSeasonStats>
new Map(rows.map((r) => [r.playerId, r]))
```

---

## Manually clearing cache

Connect to MongoDB and drop or update documents:

```js
// Clear all cached player data for a team (forces re-fetch on next request)
db.fotmob_players.deleteOne({ teamId: 10260 })
db.fotmob_stats.deleteOne({ teamId: 10260 })

// Clear fixtures for a league
db.fixtures_cache.deleteOne({ leagueId: 441 })

// Clear odds for a match
db.fotmob_odds.deleteOne({ matchId: "4193490" })

// Clear all data for a league (e.g. start of new season)
db.fotmob_teams.deleteOne({ leagueId: 441 })
db.fotmob_season.deleteOne({ leagueId: 441 })
db.fotmob_ratings.deleteMany({ leagueId: 441 })
db.fotmob_stat_list.deleteMany({ leagueId: 441 })
db.fotmob_all_stats.deleteMany({ leagueId: 441 })

// Clear per-player enrichment caches (form, rich stats, player season stats)
db.fotmob_player_stats.deleteOne({ playerId: 976428 })
db.fotmob_form.deleteOne({ playerId: 976428 })
db.fotmob_rich_stats.deleteOne({ playerId: 976428 })
```

---

## Adding a new cached function

1. Add the raw fetch function to `fotmob.ts` with `next: { revalidate: N }`.
2. Add a cached wrapper in `fotmobCache.ts` using `withCache`.
3. Choose or add a TTL constant in `CACHE_TTL` (`mongoCache.ts`).
4. If the return type contains a `Map`, serialise to array before storing (see existing examples).
5. Use the cached wrapper in API routes, never the raw function.
