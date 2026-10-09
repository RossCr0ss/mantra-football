# Cache Strategy

There is **one** caching layer: the MongoDB SWR cache. All `fetch()` calls in `fotmob.ts` / `mantraFootball.ts` use `cache: 'no-store'` (no Next.js fetch/ISR cache), so every MongoDB miss goes straight to FotMob.

- API routes always go through the MongoDB layer (`fotmobCache.ts`, `fixturesCache.ts`, `mantraFootballCache.ts`).
- Server pages that call raw `fotmob.ts` functions are **uncached** — use a `*Cached` wrapper instead.

---

## Why MongoDB instead of in-memory / Redis?

MongoDB is already running for squad persistence. Adding Redis would increase infrastructure complexity with no benefit at this traffic level. The MongoDB cache survives server restarts (unlike in-memory) and is straightforward to inspect and clear manually.

---

## MongoDB stale-while-revalidate cache (`mongoCache.ts`)

`withCache(collection, filter, ttl, fetcher, { forceRefresh })` where `ttl = { freshMs, staleMs }`:

| Cached doc age | Behaviour |
|---|---|
| `< freshMs` | Serve immediately |
| `freshMs → staleMs` | Serve immediately + deduplicated silent background refresh |
| `> staleMs` or no doc | Synchronous fetch, store, serve |
| Fetch fails and a stale doc exists | Serve stale (graceful degradation) |

`forceRefresh: true` skips all checks (UI "Refresh" button, `?refresh=1`). An empty-array doc is always treated as a miss (legacy Ukrainian-squad bug).

**TTL values are defined only in `CACHE_TTL` in `apps/web/src/lib/mongoCache.ts` — read the code, they are not repeated here** (keys: `TEAMS`, `PLAYERS`, `RATINGS`, `ODDS`, `SEASON`, `FIXTURES`, `INJURIES`, `MANTRA_POSITIONS`, `PLAYER_TEAM`, `MATCH_CARDS`). Utilities: `deleteCache`, `getCachedAt` (for "last updated" UI).

> Caveat: the background refresh is a fire-and-forget promise; on serverless hosts (Vercel) it may be cut off after the response. Self-hosted/Docker is fine.

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

**TTL:** `CACHE_TTL.FIXTURES` (SWR, same semantics as above). When stale, `getLeagueFixturesCached` calls `fetchLeagueData` and upserts the doc.

**`buildTeamFixtures` is pure:** it takes pre-fetched `matches` and `tablePositions` as arguments, with no I/O. This makes it easy to test and reuse.

---

## `fotmobCache.ts` — cached wrappers

All expensive FotMob calls used in API routes go through this module. It wraps `fotmob.ts` functions with `withCache`.

| Function | Collection | Key | TTL |
|---|---|---|---|
| `getLeagueTeamsCached(leagueId)` | `fotmob_teams` | `{ leagueId }` | TEAMS |
| `getTeamPlayersCached(teamId, teamName)` | `fotmob_players` | `{ teamId }` | PLAYERS |
| `getTeamPlayerStatsCached(teamId, teamName)` | `fotmob_stats` | `{ teamId }` | PLAYERS |
| `getLeagueRatingStatsCached(leagueId, seasonId)` | `fotmob_ratings` | `{ leagueId, seasonId }` | RATINGS |
| `getLeagueSeasonIdCached(leagueId)` | `fotmob_season` | `{ leagueId }` | SEASON |
| `getMatchOddsCached(matchId)` | `fotmob_odds` | `{ matchId }` | ODDS |
| `getLeagueAllPlayerStatsCached(leagueId, seasonId)` | `fotmob_all_stats` | `{ leagueId, seasonId }` | RATINGS |
| `getPlayerFormCached(playerId)` | `fotmob_form` | `{ playerId }` | INJURIES |
| `getPlayerRichStatsCached(playerId)` | `fotmob_rich_stats` | `{ playerId }` | PLAYERS |

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
db.fotmob_form.deleteOne({ playerId: 976428 })
db.fotmob_rich_stats.deleteOne({ playerId: 976428 })
```

---

## Adding a new cached function

1. Add the raw fetch function to `fotmob.ts` using `fotmobFetch()` (`cache: 'no-store'` + timeout).
2. Add a cached wrapper in `fotmobCache.ts` using `withCache`.
3. Choose or add a TTL constant in `CACHE_TTL` (`mongoCache.ts`).
4. If the return type contains a `Map`, serialise to array before storing (see existing examples).
5. Use the cached wrapper in API routes, never the raw function.
