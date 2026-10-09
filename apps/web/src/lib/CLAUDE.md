# lib/ — data layer

## Client-safe modules (no server imports — safe in `'use client'` files)
| Module | Exports |
|---|---|
| `leagues.ts` | `LEAGUES`, `FotMobLeague` (**not** in `fotmob.ts` any more) |
| `positionGroups.ts` | `POSITION_ORDER`, `POSITION_SECTIONS`, `POSITION_RING`, `effectivePositionGroup(player)` |
| `mantraPositions.ts` | `MANTRA_POSITIONS`, `MANTRA_POSITION_COLOR`, `guessMantraPositions` |
| `clientCache.ts` | `fetchJsonCached(key, url, {refresh})` + `CACHE_KEY.{analytics,fixtures,form}(leagueId)` — sessionStorage (15 min) in front of an API GET; `refresh` bypasses it and sends `?refresh=1`. Also `cacheGet/cacheSet` |
| `injuryDate.ts` | `isReturningToday(info)` |
| `fixtureDifficulty.ts` | `DIFFICULTY_STYLE` (1 = hardest/red … 5 = easiest/green) |
| `tourScoring.ts`, `tourModules.ts` | tour scoring + formation assignment (pure; see tour/CLAUDE.md) |
| `nameMatch.ts` | `matchMantraPlayer()` fuzzy FotMob↔mantrafootball matching |
| `suspensionRules.ts` | `YELLOW_CARD_BAN_THRESHOLD`, `YELLOW_CARD_WARNING_THRESHOLD` |
| `testUtils.ts` | test factories (`makePlayer`, `makeMatch`, `makeForm`) — tests only |

## Server-only modules
`fotmob.ts` + `fotmob/*`, `fotmobCache.ts`, `mongoCache.ts`, `fixturesCache.ts`, `mantraFootball.ts`, `mantraFootballCache.ts`, `injuries.ts`, `suspensionCheck.ts`, `squadStats.ts`, `availabilitySuggestion.ts`, `mongodb.ts`.

## Caching (details: `docs/cache.md`)
- `mongoCache.ts` `withCache(collection, filter, CACHE_TTL.X, fetcher, {forceRefresh})` is **stale-while-revalidate** (`freshMs` / `staleMs`, deduped background refresh). TTL values live in `CACHE_TTL` in code — trust the code over docs.
- `mongodb.ts` connects **lazily** on the first `getDb()` (and checks `MONGODB_URI` there). Never connect or throw at module top level — `next build` imports every route module without env vars (Vercel build failed on this).
- New cached FotMob call = add fetcher to the matching `lib/fotmob/*.ts` file (use `fotmobFetch`, never raw `fetch` — MongoDB is the only cache layer), wrapper to `fotmobCache.ts`.
- Fixtures: `fixturesCache.ts` (`withCache` wrapper, collection `fixtures_league`; converts the table-position Map to/from a record). Mantra positions: `mantraFootballCache.ts`.
- Authenticated mantrafootball calls (login, roster) are never cached/persisted. All mantrafootball.org HTTP goes through `mantraFetch` (`no-store` + 15 s timeout) — don't use raw `fetch` there.

## FotMob wrapper (`lib/fotmob/*`, barrel `lib/fotmob.ts`) — main functions
Import from `@/lib/fotmob` in server code (barrel re-exports everything). Files: `types.ts` (all interfaces), `http.ts` (**`fotmobFetch(url, 'default'|'player'|'cdn')`** — the only way to hit FotMob: headers, `no-store`, 15 s timeout; plus `FOTMOB_HEADERS`, `playerDataHeaders`), `cdnStats.ts`, `league.ts` (season ids + `fetchLeagueData`), `teams.ts`, `players.ts` (injury/rich stats/recent matches/search), `matches.ts` (odds, card events). Client code: `import type` from the barrel; runtime import only `@/lib/fotmob/matches` (`fetchMatchOddsClient`).

| Function | Purpose |
|---|---|
| `fetchLeagueTeams(leagueId)` | Teams from league table |
| `fetchTeamPlayers(teamId, teamName)` | Squad + season stats; falls back to `fetchTeamPlayersFromLineup` when `squad.squad` is null (Ukrainian clubs) |
| `fetchTeamPlayerStats` | Map playerId → stats |
| `fetchLeagueRatingStats` / `fetchLeagueStatsList` / `fetchLeagueAllPlayerStats` | CDN stats (`data.fotmob.com`); exact keys in `CDN_STAT_CONFIG` — wrong key = 403 |
| `fetchLeagueSeasonId` / `fetchLeaguePreviousSeasonId` | Season ids |
| `fetchLeagueData(leagueId)` | One call → `{ tablePositions, matches, currentRound }` (all fixtures) |
| `fetchMatchOdds` (server) / `fetchMatchOddsClient` (→ `/api/matches/[id]/odds`) | 1×2 odds; needs `FOTMOB_CCODE3` + `FOTMOB_BETTING_PROVIDER` |
| `fetchPlayerRecentMatches`, `fetchMatchCardEvents` | Form + card events (used by form route, suspension check) |
| `fetchPlayerCurrentTeam`, `searchFotMobPlayer`, `fetchPlayerPrimaryPosition` | Player lookup helpers |
| `fetchPlayerRichStats` | `playerData` endpoint — **Turnstile-blocked** server-side; needs `FOTMOB_COOKIE`. Injuries: use `getPlayerInjury()` in `injuries.ts` (DB override → FotMob). Removed as dead: `fetchPlayerInjuryInfo`, `fetchPlayerSeasonStats` (see git history) |

Endpoints: `www.fotmob.com/api/data/{leagues,teams,playerData,matchOdds}`, `data.fotmob.com/stats/{leagueId}/season/{seasonId}/{statKey}.json`.

### FotMob quirks (full list: `docs/fotmob-api.md`)
- Matches at `data.fixtures.allMatches` (not `data.matches`); `home.id`/`away.id` are **strings** → `Number()`.
- Score is `status.scoreStr` (`"2 - 1"`).
- Belgium has split table (`data.tables[].table.all`).
- `data.fotmob.com/stats/441/...rating.json` → 403 (only goals.json works for Ukraine).
- LaLiga playoffs reset roundName to 1,2… → `buildTeamFixtures` filters `!m.finished`.
- Odds: Ukrainian users use `ccode3=UKR&bettingProvider=22Bet_Ukraine`.

## MantraFootball.org (`mantraFootball.ts`; docs: `docs/mantrafootball-api.md`)
`resolveMantraLeagueId`, `fetchMantraTournamentPlayers` (official positions — source of truth for `mantraPositions`), `mantraLogin`, `fetchMantraTeamRoster` (cheerio HTML parse). Cached wrapper: `getMantraTournamentPlayersCached`.

## Injuries / suspensions
`injuries.ts`: `getPlayerInjury`/`getPlayerInjuriesBatch` — Mongo `player_injuries` overrides beat live FotMob. `suspensionCheck.ts` (server) uses thresholds from client-safe `suspensionRules.ts` (`YELLOW_CARD_BAN_THRESHOLD = 5`, `YELLOW_CARD_WARNING_THRESHOLD = 4`).
