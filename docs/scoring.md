# Tour Player Scoring Algorithm

The scoring algorithm is `calcScore()` in `apps/web/src/lib/tourScoring.ts`; formations, out-of-position malus and slot assignment are in `apps/web/src/lib/tourModules.ts`; `page.tsx` under `app/league/[id]/tour/` only loads data and renders. Behaviour is pinned by `tourScoring.test.ts` / `tourScoring.weights.test.ts` / `tourModules.test.ts`.

It ranks each squad player so the auto-select can pick the best XI for a matchday tour. The weights were fitted on ~3,100 historical matches (see **`docs/scoring-research.md`** for data, method and the backtest; `scripts/weights-research/` re-fits them).

**The idea:** a score is the *expected Mantra points* of the player in the next match, above a replacement player, × the probability that he starts:

```
score = 15 × startProb × (expectedPoints − 5.0)      // floored at 0; 15 score units = 1 Mantra point
```

---

## Inputs

| Input | Source | Notes |
|---|---|---|
| `player` | `SquadPlayer` from MongoDB | `mantraPositions`, `lineupStatus`, `availabilityPct` (+ `availabilityPctSource`) |
| `analytics` | `PlayerAnalytics` from `/api/leagues/[id]/analytics` | Season stats: rating, matches/minutes, goals, assists, xG, key passes, big chances created. Also carries `priorSeason` (previous completed season) for early-season blending |
| `fix` | `TeamFixture` from `/api/leagues/[id]/fixtures` | Next fixture: `isHome`, `round`, `difficulty` 1–5 (fallback only) |
| `odds` | `FixtureOdds` from `/api/matches/[id]/odds` | Decimal 1X2 odds: home/draw/away |
| `form` | `PlayerRecentMatch[]` from `/api/leagues/[id]/form` | Only the per-match **ratings** are used (blend with the season rating when ≥3 rated matches). The form route is derived from team results, so ratings are `null` and this blend is inactive in practice |

### Analytics data source

`PlayerAnalytics` is assembled in the analytics API route from three sources:
1. **Team endpoint** (`/api/data/teams`) — rating, goals, assists, yellow/red cards
2. **Rating rankings** (`data.fotmob.com/stats/.../rating.json`) — leagueRank, matchesPlayed, minutesPlayed
3. **CDN stat lists** (`fetchLeagueAllPlayerStats`) — xG, chancesCreated, bigChancesCreated and 16 more categories

**Caveat — CDN lists are partial and some fields are mis-extracted.** The CDN stat lists only contain players who rank in them (e.g. `cleanSheets` exists for ~30 of 537 PL players, `saves` for ~20), so a missing value means "not in the list", read as 0. `calcScore` therefore only uses fields that are present for most outfield players *and* verified against match data: `goals`, `assists`, `expectedGoals`, `chancesCreated`, `bigChancesCreated`, `rating`, `matchesPlayed`, `minutesPlayed`. Do **not** add `shots` (the CDN `SubStatValue` of `ontarget_scoring_att` is the shot *accuracy %*, not a count), `foulsCommitted`, `bigChancesMissed` or `possessionWonFinal3rd` without re-checking their semantics (see `docs/refactor-backlog.md` §10). `successfulDribbles`, `aerialsWon`, `dribbledPast`, `highClaims` are never fetched.

### Early-season blending (previous season)

Early in a season every player's current stats are 0/null, which would make everyone score alike. So counting stats and rating are blended with last season's:

```
wConf = min(1, matchesPlayed / 4)            // trust in current-season data, ramps 0 → 1 over 4 matches
pm(cur, prior)  = per-match rate:  cur/matchesPlayed * wConf + prior/priorMatches * (1 - wConf)
                  (only current or only prior available → that one; neither → 0)
pmOr(cur, prior, fallback) = pm(...) if either exists, else fallback (xG missing → goals per match)
seasonRating = cur * wConf + prior * (1 - wConf)   (cur ?? prior ?? 6.0 when one side is missing)
rating       = formRating != null ? seasonRating * 0.6 + formRating * 0.4 : seasonRating
```

Every `stat/MP` term below means `pm(analytics.stat, priorSeason.stat)`. `getSquadPriorSeasonStats` (`lib/squadStats.ts`) estimates a missing `matchesPlayed` from minutes (`round(min/90)`).

---

## Early exit: blocked players

If `player.lineupStatus === 'injured'` or `'suspended'`, the function immediately returns `total: -999` so these players are never auto-selected. They can still be manually added by clicking in the squad list.

No upcoming fixture (blank gameweek) → `startProb = 0` → `total = 0`.

---

## Expected points if the player starts

```
expectedPoints = w.intercept + w.rating × rating
               + w.winProb × winProb + w.oppWinProb × oppWinProb + w.drawProb × drawProb
               + csBonus × (w.csWin × winProb + w.csOppWin × oppWinProb)               // defenders only
               + w.xgGoalBonus × xG/MP × goalBonus + w.assist × assists/MP
               + w.chanceCreated × chancesCreated/MP + w.bigChance × bigChancesCreated/MP
```

`w` = `SCORE_WEIGHTS.byGroup[group]` (group = GK/DEF/MID/FWD of the first Mantra position). `xG/MP` falls back to goals/MP. `goalBonus` is the official native-position goal bonus (ST/FW 2, AM/W 2.5, others 3 — rule in force since 01.06.2026), `csBonus` the clean-sheet bonus of the primary position (GK 1.5, RB/CB/LB 1, WB/DM 0.5).

### Match context: 1X2 odds → probabilities

```
winProb = 1 / (odds of the player's team)    oppWinProb = 1 / (odds of the opponent)    drawProb = 1 / (draw odds)
```
A missing or ≤1 price falls back to the empirical average for the fixture difficulty (1…5): winProb 0.244 / 0.348 / 0.411 / 0.448 / 0.503, oppWinProb 0.587 / 0.455 / 0.381 / 0.342 / 0.296, drawProb 0.28. Raw `1/odds` are used (not normalised) — the fit used them the same way.

### Weights (`SCORE_WEIGHTS.byGroup`, pinned in `tourScoring.weights.test.ts`)

| | GK | DEF | MID | FWD |
|---|---|---|---|---|
| intercept | 6.465 | 6.735 | 6.202 | 6.275 |
| rating | 0.03 | 0.058 | 0.144 | 0.169 |
| winProb | 1.03 | 0.518 | 0.995 | 1.149 |
| oppWinProb | −1.33 | −0.578 | −0.796 | −0.901 |
| drawProb | 1.906 | 0.6 | −0.726 | −1.115 |
| xG × goalBonus | – | 0.42 | 0.549 | 0.39 |
| assists / MP | – | – | 0.095 | – |
| chancesCreated / MP | – | 0.168 | 0.16 | 0.126 |
| bigChancesCreated / MP | – | 0.166 | 0.181 | 0.201 |
| csBonus × winProb | – | 0.482 | – | – |
| csBonus × oppWinProb | – | −0.475 | – | – |

Reading it: one point of rating above 6 moves the expected points by only 0.03–0.17 (a season average is a weak predictor of a single match — regression to the mean), whereas the *match* moves them a lot: from a toss-up against a strong side to a heavy home favourite the expected points of an attacker rise by ~1. Draw-prone matches help GKs/defenders (clean sheets) and hurt attackers. Defensive stats (tackles, interceptions, clearances…) and team form had no predictive value beyond these terms and are not used.

---

## Start probability

```
startProb = availabilityPct set by hand ('manual' / unknown source)      → availabilityPct / 100
          = availabilityPct 'suggested' (last-5-matches form)             → 0.6 × availabilityPct/100 + 0.4 × model
          = not set                                                       → model
model     = sigmoid(−2.46 + 3.67 × share + 0.89 × avgMinutes/90)
```

`share` = share of his team's minutes: `min(1, minutes / (teamMatches × 90))`, blended with last season's `min(1, priorMinutes / (34 × 90))` while the season is young (`wCur = min(1, teamMatches/6)`); `teamMatches = max(matchesPlayed, round − 1)` (the fixture's round; rounds restart in playoffs). `avgMinutes` is the `wConf`-blended minutes per appearance. No minutes data at all (e.g. Ukrainian league, FotMob rating list is 403) → neutral 0.5. AUC of the model on held-out matches: 0.81 (the old "average minutes per appearance" had 0.75: it ignores rotation).

Start probability is the single most valuable input: without it the model *loses* to the old formula, with it the XI gets ~1 extra player who actually plays.

## Total score

```
total = max(0, 15 × startProb × (expectedPoints − 5.0))
```

`5.0` (`SCORE_WEIGHTS.replacement`) is the points a bench replacement is assumed to bring, so the score is "points above replacement". `15` = `SCORE_UNITS_PER_MANTRA_POINT` (also the defence-bonus conversion rate).

### Score tiers (display only, `components/tour/tourUi.ts`)

| Score | Tier | Color | Meaning (held-out starters) |
|---|---|---|---|
| 31+ | Elite | Emerald | top ~20 % |
| 18–30 | Good | Blue | |
| 6–17 | Average | Gray | |
| < 6 | Low | Dim | |

---

## Out-of-position penalty (malus)

When a player fills a slot outside his registered Mantra positions the real game subtracts the malus from his match score. The malus is therefore applied **linearly** to the total, only if he plays:

```
effectiveScore = max(0, total + malus × 15 × startProb)       // malus is negative
```

**Examples** (`startProb` 1): total 42, malus −1.5 → 42 − 22.5 = 19.5; malus −3 → −3 × 15 = −45 → floored at 0. (Older versions only reduced the rating component, floored at 0, which let weakly-rated out-of-position players off almost free.) Goal bonuses, clean-sheet bonuses and everything else are unaffected — they are awarded for the player's actual actions, not his slot.

### Malus values (`POSITION_MALUS` in `lib/tourModules.ts` — source of truth)

`POSITION_MALUS[slotPosition][playerPosition]`: `0` = native, `-1.5` = adjacent role, `-3` = stretch, missing = incompatible (not allowed). If a slot accepts several positions (e.g. `DM/CM`) or a player has several, the best (highest) malus wins (`getSlotPenalty`).

| Slot | Native | −1.5 | −3 |
|---|---|---|---|
| GK | GK | | |
| LB | LB | RB, CB | WB |
| RB | RB | LB, CB | WB |
| CB | CB | LB, RB | DM |
| WB | WB | DM, CM | LB, RB |
| DM | DM | CM | WB, CB |
| CM | CM | DM | AM |
| AM | AM | | CM, W, FW |
| W | W | AM | FW |
| FW | FW | ST | W, AM |
| ST | ST | FW | W |

## Auto-select algorithm

`autoSelect()` uses the scoring to fill a formation.

### Step 1 — Fill each module slot (`assignModule`)

For each module, slots are filled with a **constrained-slot-first** greedy approach:

1. Find the unfilled slot with the **fewest native (malus 0) candidates**, ties broken by fewest total eligible candidates (most constrained first — prevents deadlock where the only RB gets consumed by a flexible WB/RB slot). If any slot has no eligible player at all, the module is infeasible (`null`).
2. From eligible players for that slot:
   - **If any native players exist** (penalty = 0): assign the highest-scoring one. Out-of-position players are never considered when a native option is available.
   - **Only if no native player remains**: assign the best out-of-position player (scored after applying their malus).
3. Mark the player as used and repeat.

### Step 2 — Pick the best module

Unless the user pinned a formation chip, every module is assigned and the one with the **highest `assignmentScore`** wins: the sum of `effectiveScore` over the GK and 10 slots (out-of-position players already lose their malus points) **plus the team defence bonus**. Infeasible modules are skipped. Implemented by `pickBestModule()` in `lib/tourModules.ts`.

#### Defence bonus

Official rule (mantrafootball.org/rules): the team gets 0–5 points from the **average base score** of the module's defenders — <7.00 → 0, 7.00–7.24 → 1, 7.25–7.49 → 2, 7.50–7.74 → 3, 7.75–7.99 → 4, ≥8.00 → 5. The malus does not affect it, and the goalkeeper is excluded.

In the app: base score = `scoreBreakdown.baseRating` (blended season/form rating, unpenalised); defenders = the module's back-line slots (slots accepting only RB/CB/LB — **3 in 3-x-x, 4 in 4-x-x; wing-backs not counted**, an assumption to verify against the rules page). The bonus is converted at `SCORE_UNITS_PER_MANTRA_POINT = 15` (the same rate as player scores: 1 Mantra point = 15 units), so a 5-point bonus is worth 75 score units when comparing formations. It is not added to individual player scores. The tour header shows the result as "Def. bonus".

#### Refinement step (`improveAssignment`)

The greedy `assignModule` cannot see the bonus tiers (e.g. that a slightly lower-scored but higher-rated centre-back lifts the back line's average to the next tier). After the greedy fill, `improveAssignment` hill-climbs on `assignmentScore`: it tries replacing a slot's player with an unused eligible one and swapping two slots' players, applying the best strictly-improving move until none is left (max 50 rounds; the GK is untouched; each player's own malus is recomputed). The result is never worse than the greedy one. It runs for every formation — also for a pinned one, where it can still change *who* plays — so the "native players first" rule of Step 1 is now only the starting point: an out-of-position player can end up in a slot if that raises the total.

Earlier versions ranked "fewest out-of-position slots" first; that double-counted the penalty and could pick a worse formation, so it was removed (see the comment in `autoSelect()`).

### Step 3 — GK

Always the highest-scoring available (non-blocked) GK. Slot 0 in every module.

### Why constrained-slot-first matters

Without it, a greedy fill might consume the squad's only RB in a flexible `WB/RB` slot, forcing the dedicated `RB` slot to use an out-of-position player. Processing the most-constrained slot first ensures scarce players go to the slots that need them.

---

## Score breakdown display

```typescript
interface ScoreBreakdown {
  total: number;          // score units, see above (−999 = blocked)
  baseRating: number;     // blended season/form rating, unpenalised (input of the defence bonus)
  expectedPoints: number; // expected Mantra points if he starts
  startProb: number;      // 0–1
  rating: number;         // score units (already × startProb) from the player's rating above 6
  context: number;        // … from the match context (odds, clean-sheet terms)
  attack: number;         // … from xG × goal bonus, assists, chances created, big chances
  availability: number;   // startProb × 100
}
```

`rating`, `context` and `attack` exclude the intercept, so they do not sum to `total`; they only show *what drives* a score. In the Tour page each `SquadRow` shows the score badge (coloured by tier), a 3-segment micro-bar (yellow = rating, blue = context, green = attack) and a hover tooltip with expected points, start probability and the three parts. The breakdown is display-only — `autoSelect()` uses `total` (and `baseRating` for the defence bonus).

## Tuning the weights

Do not hand-tune: re-fit with `scripts/weights-research` (`docs/scoring-research.md`), which needs the Mantra rules in `build_table.py` to match https://mantrafootball.org/rules (they change between seasons — goal bonus changed on 01.06.2026). Then paste the numbers into `SCORE_WEIGHTS`, update the table above and `tourScoring.weights.test.ts` together.

| Knob | Default | Effect if increased |
|---|---|---|
| `replacement` | `5.0` | Lowers every score by the same amount per start-probability; a high value punishes low-probability players more. Zero point of the score; 0–5 gave the same results in the backtest, 6.5 was worse |
| `startProb.suggestedBlend` | `0.4` | Trusts the season-long minutes model more than the "last 5 matches" suggestion (0.3–0.5 were equal in the backtest) |
| `startProb.unknown` | `0.5` | Start probability of a player without any minutes data |
| `byGroup.*` | table above | see `docs/scoring-research.md` |
| `SCORE_UNITS_PER_MANTRA_POINT` | `15` | Scale of scores; also the weight of the defence bonus (1 point = 15 units) and of the malus |
