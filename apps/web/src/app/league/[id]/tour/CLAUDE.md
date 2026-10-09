# Tour (matchday selection)

Page: `page.tsx` (UI + data loading only). Logic lives in `lib/`:
- `lib/tourScoring.ts` — `calcScore`, `ScoreBreakdown`, `computeTeamForm`, `recentFormRating`, `isBlocked` (algorithm: `docs/scoring.md`)
- `lib/tourModules.ts` — `MODULES` (formations — **source of truth**, slots per module), `POSITION_MALUS`, `getSlotPenalty`, `effectiveScore`, `enrichPlayers`, `assignModule`, and the formation choice: `pickBestModule` (= greedy `assignModule` → `improveAssignment` local search, ranked by effective scores + team defence bonus via `defenceBonusPoints` / `assignmentScore`)
- Formation/position reference: `docs/mantra-rules.md`

## Rules
- Squad of 26 (exactly 3 GK) → **11 main** (1 GK + 10 outfield, slot 0 = GK) + **9 subs** (≥1 GK on bench).
- `lineupStatus` `injured|suspended` → excluded from auto-select; `availabilityPct` multiplies the final score (0 → never selected).
- Out-of-position slots get a score penalty (`POSITION_MALUS`, −1.5 / −3).

## Fixture difficulty
`buildTeamFixtures` (`lib/fixturesCache.ts`): `difficulty = clamp(ceil(opponentTablePos / totalTeams * 5), 1, 5)`. Top opponent → **1 = hardest (red)**, bottom → **5 = easiest (dark green)**. Styles in `lib/fixtureDifficulty.ts`.

## Editing tips
- Change scoring/formations in `lib/`, not in the page; update `docs/scoring.md` / `docs/mantra-rules.md`.
- `page.tsx` (~470 lines) = data loading + state + layout only. UI pieces live in `components/tour/` (`PitchView`, `TourCards`, `tourUi`).
