# Refactor backlog

Findings from the 2026-10-09 bottleneck audit that were **not** done yet, ordered by payoff for agent speed / correctness.
Done: split of `lib/fotmob.ts` into `lib/fotmob/*`; vitest + 22 tests. Done in the first audit: slim root `CLAUDE.md` + scoped `CLAUDE.md` files, shared client-safe modules (`leagues`, `positionGroups`, `clientCache`, `injuryDate`, `fixtureDifficulty`, `suspensionRules`), tour logic extracted to `lib/tourScoring.ts` + `lib/tourModules.ts`, `yarn typecheck`, cache docs corrected, build artifacts untracked.

## 1. `lib/fotmob/*` — DONE
Split into `{types,http,cdnStats,league,teams,players,matches}.ts`; all server HTTP goes through `fotmobFetch` (shared headers, `no-store`, 15 s timeout; covered by `http.test.ts`). `fetchMatchOddsClient` is the only raw `fetch` (relative URL to our own API). Not done: retries (timeouts surface as errors; `withCache` serves stale on failure).

## 2. Tests — extend (vitest set up, DONE for core pure logic)
Covered: `tourScoring`, `tourModules`, `nameMatch`, `buildTeamFixtures`. Also covered now: `squadStats`, `availabilitySuggestion`, `mongoCache`, `squadValidation`, `apiUtils`, `clientCache`, `fotmobFetch`, `mantraFootball` (pagination, roster HTML parsing, login). Also `injuries` (override vs live) and `suspensionCheck`. `calcScore` weights are pinned by hand-computed values in `tourScoring.weights.test.ts` (rating, fixture, odds, minutes, form, every position formula, prior-season blend) — all position formulas (GK, DEF, DM, CM, AM/W, FWD winger, ST/FW) are pinned. Not covered: `fixturesCache` Mongo read/write path, `fotmobCache` wrappers, `cdnStats` and the `players.ts` parsers (recent matches, rich stats). `fotmob/{league,teams,matches}` are covered with hand-written fixtures that follow `docs/fotmob-api.md` — refresh them from a live response if FotMob changes shape.

## 3. Lint — DONE
`apps/web/.eslintrc.json`: `next/core-web-vitals` + `@typescript-eslint/no-restricted-imports` banning server-only modules (`lib/fotmob` runtime, `mongodb`, `injuries`, `suspensionCheck`, caches) in `components/**` and the client pages (analytics/fixtures/tour). Clean now. If you add another client page, add it to the `files` list in the override.

## 4. Large client files — mostly DONE
Moved (pure moves, bundle sizes unchanged): `tour/page.tsx` 1390 → 471, `analytics/page.tsx` 1023 → 431, `TeamSquadView.tsx` 1046 → 660 into `components/{tour,analytics,team}/`. Still open:
- DONE: `TeamSquadView` 660 → 518 (`InjuryReportSection` extracted), `SquadManager` 594 → 436 (`components/squad/`). Remaining in `TeamSquadView`: ~340 lines of state + async handlers (suspensions, positions sync, form, injuries) — candidates for hooks if it grows again.
- DONE: the repeated sessionStorage+fetch block is now `fetchJsonCached` (tested). Side effect fixed: tour's Refresh now also sends `?refresh=1`. `fixtures/page.tsx` still fetches uncached by design.
- `tour/page.tsx` data-loading effects → `useTourData(leagueId)`.

## 5. API route hygiene — DONE
`lib/apiUtils.ts` (`parseIdParam`, `findLeague`, `parseLeagueParam`, `apiError`) is used by every route; `/api/squad` now validates league, squad size (≤26), `lineupStatus` and `mantraPositions` values. `SquadPlayer` shape/size validation on POST is in `lib/squadValidation.ts`; `?refresh=1` is throttled in `withCache` (30 s per cache doc). There is still no authentication anywhere (single-user app).

## 6. Dead exports — DONE
Removed `fetchPlayerInjuryInfo`, `fetchPlayerSeasonStats` (+ its parsing helpers), `getPlayerSeasonStatsCached`, `getLeagueStatsListCached` (`fotmob/players.ts` 530 → 286 lines). `noUnusedLocals` is now on in `tsconfig.json`, so new leftovers fail `typecheck`.

## 7. Two sources of truth to unify
- ~~League registration split~~ — DONE: `mantraTournamentId` lives in `LEAGUES`; `MANTRA_TOURNAMENT_ID` is derived.
- `.claude/skills/mantra-auction-picks/scripts/fetch_and_score.py` re-implements `CDN_STAT_CONFIG`, position guessing and bonus tiers from TS. Drift is now guarded by `skillParity.test.ts` (goal/clean-sheet bonuses, CDN keys + flags; skipped when `python3` is missing). Position guessing (`guess_native_positions`) is not covered. The goal-bonus rule already drifted once (changed on mantrafootball.org on 01.06.2026) — check https://mantrafootball.org/rules when scoring looks off.

## 8. Operational risks (not code smell)
- SWR background refresh in `mongoCache.ts` is a fire-and-forget promise — unreliable on serverless (`.vercel/` exists).
- No fetch-level cache in `fotmob.ts` (all `no-store`): server pages that call raw `fotmob.ts` functions hit FotMob every request — use `*Cached` wrappers.

## 9. Rules the app does not model (from https://mantrafootball.org/rules)
- **Defence bonus**: now used when auto-select ranks formations (`pickBestModule`, see `docs/scoring.md`). Open questions: whether wing-backs count as defenders (currently not), player choice within a formation is refined by `improveAssignment` (local search, may leave local optima); the auction skill prints "defence clusters" as a rough proxy.
- Team points → goals conversion (72 points = 1 goal, +1 goal per extra 7) — irrelevant for choosing players but relevant if a "projected result" feature is ever added.
- The **position malus matrix** on the rules page is an image, so `POSITION_MALUS` cannot be verified automatically — compare it by eye after rule changes (the `-1.5` / `-3` steps are confirmed in the text).
- Bonuses not in `calcScore`: saves (+0.5 for 3–5, +1 for 6+), penalties, cards/maluses — they are only reflected indirectly through xG/rating/stat proxies.

## 10. Findings from live browser testing (2026-10-09, isolated Mongo copy of the real squads)
- Verified end-to-end: all pages render without console errors; auto-select picks a formation and shows the defence bonus; tour/analytics Refresh send `?refresh=1`; session cache serves reloads; squad POST validation accepts the real stored squads and strips unknown keys.
- **Fixed:** `getLeagueFixturesCached` had its own copy of the SWR logic and ignored the forced-refresh throttle → now on `withCache`.
- **Fixed afterwards:** live injuries now block auto-select on the tour page (`applyLiveInjuries`, see `docs/player-availability.md`). The My Team / Injuries pages and the saved squad are unchanged — the overlay is not persisted. Open: FotMob only exposes an `injured` boolean (no return date, no doubtful state), so a flagged player stays blocked until FotMob clears it or the user presses Healed.
- `favicon.ico` returns 404 (no `public/` by design) — harmless console noise.
- `.env` still points `MONGODB_URI` at port 27018 while `docker-compose.yml` publishes Mongo on 27028 (see CLAUDE.md) — pass `MONGODB_URI` explicitly or fix `.env`.

