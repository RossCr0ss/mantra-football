# Refactor backlog

Findings from the 2026-10-09 bottleneck audit that were **not** done yet, ordered by payoff for agent speed / correctness.
Done: split of `lib/fotmob.ts` into `lib/fotmob/*`; vitest + 22 tests. Done in the first audit: slim root `CLAUDE.md` + scoped `CLAUDE.md` files, shared client-safe modules (`leagues`, `positionGroups`, `clientCache`, `injuryDate`, `fixtureDifficulty`, `suspensionRules`), tour logic extracted to `lib/tourScoring.ts` + `lib/tourModules.ts`, `yarn typecheck`, cache docs corrected, build artifacts untracked.

## 1. `lib/fotmob/*` — DONE
Split into `{types,http,cdnStats,league,teams,players,matches}.ts`; all server HTTP goes through `fotmobFetch` (shared headers, `no-store`, 15 s timeout; covered by `http.test.ts`). `fetchMatchOddsClient` is the only raw `fetch` (relative URL to our own API). Not done: retries (timeouts surface as errors; `withCache` serves stale on failure).

## 2. Tests — extend (vitest set up, DONE for core pure logic)
Covered: `tourScoring`, `tourModules`, `nameMatch`, `buildTeamFixtures`. Not covered yet: `calcScore` numeric weights (only invariants tested), `squadStats`, `availabilitySuggestion`, `injuries` merge logic, `mantraFootball` HTML roster parsing (use a saved fixture).

## 3. Lint — DONE
`apps/web/.eslintrc.json`: `next/core-web-vitals` + `@typescript-eslint/no-restricted-imports` banning server-only modules (`lib/fotmob` runtime, `mongodb`, `injuries`, `suspensionCheck`, caches) in `components/**` and the client pages (analytics/fixtures/tour). Clean now. If you add another client page, add it to the `files` list in the override.

## 4. Large client files — mostly DONE
Moved (pure moves, bundle sizes unchanged): `tour/page.tsx` 1390 → 471, `analytics/page.tsx` 1023 → 431, `TeamSquadView.tsx` 1046 → 660 into `components/{tour,analytics,team}/`. Still open:
- `TeamSquadView.tsx` main component (~590 lines of one function) and `SquadManager.tsx` (~590, has its own `PlayerCard`/`SquadListItem` — different from `team/PlayerCard`, could share a base card).
- DONE: the repeated sessionStorage+fetch block is now `fetchJsonCached` (tested). Side effect fixed: tour's Refresh now also sends `?refresh=1`. `fixtures/page.tsx` still fetches uncached by design.
- `tour/page.tsx` data-loading effects → `useTourData(leagueId)`.

## 5. API route hygiene — DONE
`lib/apiUtils.ts` (`parseIdParam`, `findLeague`, `parseLeagueParam`, `apiError`) is used by every route; `/api/squad` now validates league, squad size (≤26), `lineupStatus` and `mantraPositions` values. `SquadPlayer` shape/size validation on POST is in `lib/squadValidation.ts`; `?refresh=1` is throttled in `withCache` (30 s per cache doc). There is still no authentication anywhere (single-user app).

## 6. Dead exports — DONE
Removed `fetchPlayerInjuryInfo`, `fetchPlayerSeasonStats` (+ its parsing helpers), `getPlayerSeasonStatsCached`, `getLeagueStatsListCached` (`fotmob/players.ts` 530 → 286 lines). `noUnusedLocals` is now on in `tsconfig.json`, so new leftovers fail `typecheck`.

## 7. Two sources of truth to unify
- ~~League registration split~~ — DONE: `mantraTournamentId` lives in `LEAGUES`; `MANTRA_TOURNAMENT_ID` is derived.
- `.claude/skills/mantra-auction-picks/scripts/fetch_and_score.py` re-implements `CDN_STAT_CONFIG`, position guessing and bonus tiers from TS. Keep in sync manually or generate one from the other.

## 8. Operational risks (not code smell)
- SWR background refresh in `mongoCache.ts` is a fire-and-forget promise — unreliable on serverless (`.vercel/` exists).
- No fetch-level cache in `fotmob.ts` (all `no-store`): server pages that call raw `fotmob.ts` functions hit FotMob every request — use `*Cached` wrappers.
