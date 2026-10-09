# Tour (matchday selection)

Page: `page.tsx` (UI + data loading only). Logic lives in `lib/`:
- `lib/tourScoring.ts` — `calcScore` (expected Mantra points × start probability; fitted weights in `SCORE_WEIGHTS`), `ScoreBreakdown`, `matchContext`, `estimateStartProb`, `recentFormRating`, `isBlocked` (algorithm: `docs/scoring.md`; how the weights were fitted: `docs/scoring-research.md`, re-fit with `scripts/weights-research`)
- `lib/tourModules.ts` — `MODULES` (formations — **source of truth**, slots per module), `POSITION_MALUS`, `getSlotPenalty`, `effectiveScore`, `enrichPlayers`, `assignModule`, and the formation choice: `pickBestModule` (= greedy `assignModule` → `improveAssignment` local search, ranked by effective scores + team defence bonus via `defenceBonusPoints` / `assignmentScore`)
- Formation/position reference: `docs/mantra-rules.md`

## Rules
- Squad of 26 (exactly 3 GK) → **11 main** (1 GK + 10 outfield, slot 0 = GK) + **9 subs** (≥1 GK on bench).
- `lineupStatus` `injured|suspended` → excluded from auto-select. The page also overlays **live injuries** (`lib/liveInjuries.ts`: active, non-healed injury ⇒ virtual `injured`, source `auto`) — see `docs/player-availability.md`; `availabilityPct` multiplies the final score (0 → never selected).
- Out-of-position slots lose `malus × 15 × startProb` score units (`POSITION_MALUS`, −1.5 / −3; linear, like the real game).

## Fixture difficulty (fallback only)
`buildTeamFixtures` (`lib/fixturesCache.ts`): `difficulty = clamp(ceil(opponentTablePos / totalTeams * 5), 1, 5)`. Top opponent → **1 = hardest (red)**, bottom → **5 = easiest (dark green)**. Styles in `lib/fixtureDifficulty.ts`. `calcScore` uses the 1X2 odds; difficulty only supplies the win/opponent-win probabilities when odds are missing.

## Editing tips
- Change scoring/formations in `lib/`, not in the page; update `docs/scoring.md` / `docs/mantra-rules.md`. Changing a weight = re-fit (`scripts/weights-research`), then update `SCORE_WEIGHTS`, the table in `docs/scoring.md` and `tourScoring.weights.test.ts` together.
- `page.tsx` (~470 lines) = data loading + state + layout only. UI pieces live in `components/tour/` (`PitchView`, `TourCards`, `tourUi`).
