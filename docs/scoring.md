# Tour Player Scoring Algorithm

The scoring algorithm lives in `calcScore()` inside `apps/web/src/app/league/[id]/tour/page.tsx`.

It ranks each squad player so the auto-select can pick the best XI for a matchday tour.

---

## Inputs

| Input | Source | Notes |
|---|---|---|
| `player` | `SquadPlayer` from MongoDB | Includes `mantraPositions`, `lineupStatus`, `availabilityPct` |
| `analytics` | `PlayerAnalytics` from `/api/leagues/[id]/analytics` | Season stats from CDN: rating, goals, xG, tackles, CS, saves, minutes, and more |
| `fix` | `TeamFixture` from `/api/leagues/[id]/fixtures` | Next fixture with difficulty 1–5 |
| `odds` | `FixtureOdds` from `/api/matches/[id]/odds` | Decimal odds: home/draw/away |
| `form` | `PlayerRecentMatch[]` from `/api/leagues/[id]/form` | Last 5 team matches (W/D/L + score) — blended with season rating when ≥3 rated matches |
| `teamForm` | `TeamForm` — computed from `form` | Aggregated wins/draws/losses/CS rate for the team's last 5 matches |

### Analytics data source

`PlayerAnalytics` is assembled in the analytics API route from three sources:
1. **Team endpoint** (`/api/data/teams`) — rating, goals, assists, yellow/red cards
2. **Rating rankings** (`data.fotmob.com/stats/.../rating.json`) — leagueRank, matchesPlayed, minutesPlayed
3. **CDN stat lists** (`fetchLeagueAllPlayerStats`) — tackles, interceptions, clearances, xG, shots, chancesCreated, cleanSheets, saves, goalsConceded, foulsCommitted, and more (19 categories total, fetched in parallel and merged into one cache document)

The `playerData` endpoint (per-player rich stats) is Turnstile-blocked for server-side requests and no longer used in the analytics route.

---

## Early exit: blocked players

If `player.lineupStatus === 'injured'` or `'suspended'`, the function immediately returns `total: -999` so these players are never auto-selected. They can still be manually added by clicking in the squad list.

---

## Score components

### 1. Rating score (0–∞, typical 0–18)

```
seasonRating = analytics.rating ?? 6.0
formRating   = average of last 5 match ratings where minutesPlayed > 30 (null if < 3 rated matches)
blendedRating = formRating != null ? seasonRating * 0.6 + formRating * 0.4 : seasonRating
ratingScore  = max(0, (blendedRating - 6.0) * 15)
```

FotMob ratings run roughly 6.0–8.5. A 7.0 rating = 15 points; 7.5 = 22.5 points; 8.0 = 30 points. Players with no rating data default to 6.0 (zero points).

**Form blend:** The form data from `/api/leagues/[id]/form` is derived from the fixtures cache (team results) and does not include individual player ratings (`rating: null`). The 40% form weight therefore only activates if `fetchPlayerRecentMatches` (Turnstile-blocked) has previously populated per-match ratings for that player. In practice the blend is currently always 100% season rating.

### 2. Fixture score (0–16)

```
fixtureScore = (difficulty - 1) * 4
```

`difficulty` 1–5 from league table position. Easy fixture (5) = 16 points; hard fixture (1) = 0 points. A player with no upcoming fixture gets `-25` penalty.

- difficulty 1 → fixtureScore = 0 (hardest opponent)
- difficulty 5 → fixtureScore = 16 (easiest opponent)

### 3. Odds score (0–15)

```
winProb = 1 / teamOdds   (home odds if playing at home, away odds otherwise)
oddsScore = winProb * 15
```

Win probability from decimal odds. A team with odds 1.5 (67% win prob) = 10 points; odds 2.0 (50%) = 7.5 points.

If odds are unavailable, a rough estimate from difficulty is used:
```
winProb ≈ difficulty * 0.1 - 0.05   (0.05 for difficulty 1, 0.45 for difficulty 5)
```

### 4. Position-specific score

This is the most complex component. It rewards players based on stats that matter for their Mantra scoring role.

**Clean sheet probability** (used by GK and DEF):
```
baseCsProb = difficulty * 0.075 - 0.025
csFromOdds = winProb > 0 ? min(0.55, baseCsProb + winProb * 0.15) : baseCsProb
csProb = teamForm.matches >= 3
  ? csFromOdds * 0.5 + teamForm.csRate * 0.5
  : csFromOdds
```
When 3+ recent matches are available, the team's actual CS rate is blended 50/50 with the odds-based estimate.

**GK:**
```
effectiveCsProb = actualCsRate ? csProb * 0.4 + actualCsRate * 0.6 : csProb
svPctBonus = max(0, savePercentage - 65) * 0.1
positionScore = effectiveCsProb * csBonus * 12 + saves/MP * 0.4
              + svPctBonus + goalsPrevented/MP * 5 + highClaims/MP * 0.4
              - goalsConceded/MP * 0.2
```

`csBonus` for GK = 1.5 (Mantra awards +1.5 for GK clean sheet). `goalsPrevented` multiplier raised to 5 (was 3) — this stat directly captures saves that prevented goals.

**DEF:**
```
defContrib = tackles/MP * 0.8 + interceptions/MP * 1.0 + clearances/MP * 0.4
           + blockedShots/MP * 0.8 + possessionWonFinal3rd/MP * 0.5
           + aerialsWon/MP * 0.4 - dribbledPast/MP * 0.5 - foulsCommitted/MP * 0.25
positionScore = csProb * csBonus * 10 + goalsPerMatch * goalBonus * 6
              + assistsPerMatch * 4 + defContrib
```

`csBonus`: RB/CB/LB = 1.0, WB/DM = 0.5.
`goalBonus`: ST primary = 2, FW primary = 2.5, others = 3.

**MID — split by sub-role:**

DM (pure defensive midfielder — has DM but not AM or W):
```
positionScore = xgPerMatch * goalBonus * 5 + kpPerMatch * 3
              + shots/MP * 0.1 + bigChancesCreated/MP * 2
              + successfulDribbles/MP * 0.2
              + tackles/MP * 0.8 + interceptions/MP * 1.2 + clearances/MP * 0.3
```

AM or W (attacking/wide midfielder):
```
positionScore = xgPerMatch * goalBonus * 9 + kpPerMatch * 7
              + shots/MP * 0.2 + bigChancesCreated/MP * 5
              + successfulDribbles/MP * 0.5
              + tackles/MP * 0.15 + interceptions/MP * 0.2
```

CM (balanced central midfielder):
```
positionScore = xgPerMatch * goalBonus * 7 + kpPerMatch * 5
              + shots/MP * 0.15 + bigChancesCreated/MP * 4
              + successfulDribbles/MP * 0.3
              + tackles/MP * 0.4 + interceptions/MP * 0.6
```

**FWD — split by sub-role:**

W (wide forward — has W but not ST or FW):
```
positionScore = xgPerMatch * goalBonus * 8 + chancesCreated/MP * 3
              + assistsPerMatch * 6 + shots/MP * 0.2
              + bigChancesCreated/MP * 3 + successfulDribbles/MP * 0.6
              - bigChancesMissed/MP * 1.5
```

ST / FW (central striker / forward):
```
positionScore = xgPerMatch * goalBonus * 10 + assistsPerMatch * 5
              + shots/MP * 0.25 + bigChancesCreated/MP * 2
              + successfulDribbles/MP * 0.4 + aerialsWon/MP * 0.3
              - bigChancesMissed/MP * 2.0
```

### 5. Minutes score (0–10, linear)

```
avgMinutes = minutesPlayed / matchesPlayed
minutesScore = round(min(10, (avgMinutes / 90) * 12))
```

Linear scale: 90 min/game = 12 → capped at 10. 75 min/game ≈ 10 pts; 60 min/game = 8 pts; 45 min/game = 6 pts.

Rewards players who play most of the match. Replaces the old step-function (82+→10, 70+→7, 55+→4, 40+→1) which created large cliff effects.

### 6. Team form bonus (approx −4 to +4)

```
teamForm = computeTeamForm(playerFormMatches)   // last 5 results with non-null result
formBonus = teamForm.matches >= 3
  ? ((wins - losses) / matches) * 4
  : 0
```

Rewards players on winning teams and penalises players on losing streaks. A team with 4W 1L in last 5 = +2.4; a team with 1W 4L = −2.4; 3W 2L = +1.6; 2W 2L 1D = 0. Requires at least 3 results with non-null outcome.

---

## Availability multiplier

```
total = max(0, baseTotal) * (availabilityPct / 100)
```

`availabilityPct` (0–100, default 100) is set manually by the user in TeamSquadView. It represents expected playing time/start probability for the upcoming match.

- 100% → full score (certain starter)
- 75% → 75% of score (likely starter)
- 50% → 50% of score (bench, uncertain)
- 0% → score = 0 (not expected to play, but not blocked)

This naturally pushes low-availability players down in auto-select without requiring a hard block. A 50% player can still be manually selected.

---

## Total score

```
baseTotal = ratingScore + fixtureScore + oddsScore + positionScore + minutesScore + formBonus - noFixturePenalty
total = max(0, baseTotal) * (availabilityPct / 100)
```

`noFixturePenalty = 25` when the player has no upcoming fixture (blank gameweek, cup only). This is a strong penalty that pushes fixture-less players below most available players.

---

## Score tiers (display only)

| Score | Tier | Color |
|---|---|---|
| 55+ | Elite | Emerald |
| 38–54 | Good | Blue |
| 22–37 | Average | Gray |
| < 22 | Low | Dim |

---

## Out-of-position penalty (malus)

When a player fills a slot outside their registered Mantra positions, a malus is applied directly to their expected FotMob match rating before scoring:

```
effectiveRating = baseRating + malus   (malus is negative)
effectiveRatingScore = max(0, (effectiveRating - 6.0) * 15)
```

**Examples:**
- Player rated 6.0, malus −1.5 → effective rating 4.5 → ratingScore 0
- Player rated 7.5, malus −1.5 → effective rating 6.0 → ratingScore 0
- Player rated 8.0, malus −1.5 → effective rating 6.5 → ratingScore 7.5

The malus only reduces the rating component. Goal bonuses, clean sheet bonuses, fixture score, and minutes score are **unaffected** — those are awarded based on the player's actual actions, not their position slot.

### Malus values (`POSITION_MALUS` in `tour/page.tsx`)

| Slot position | Player position | Malus |
|---|---|---|
| RB / LB | The other of RB/LB | −1.5 |
| RB / LB | CB | −1.5 |
| CB | RB or LB | −1.5 |
| WB | DM or CM | −1.5 |
| DM | CM | −1.5 |
| W | AM | −1.5 |
| FW | ST | −1.5 |
| ST | FW | −1.5 |
| Any other cross-group mismatch | | −3.0 |
| Completely incompatible | | not allowed |

---

## Auto-select algorithm

`autoSelect()` uses the scoring to fill a formation.

### Step 1 — Fill each module slot (`assignModule`)

For each module, slots are filled with a **constrained-slot-first** greedy approach:

1. Find the unfilled slot with the **fewest eligible remaining players** (most constrained first — prevents deadlock where the only RB gets consumed by a flexible WB/RB slot).
2. From eligible players for that slot:
   - **If any native players exist** (penalty = 0): assign the highest-scoring one. Out-of-position players are never considered when a native option is available.
   - **Only if no native player remains**: assign the best out-of-position player (scored after applying their malus).
3. Mark the player as used and repeat.

### Step 2 — Pick the best module

Modules are ranked by two criteria in order:

1. **Fewest out-of-position slots** (primary) — a module with zero OOP assignments always beats one with any OOP, regardless of score difference.
2. **Highest total effective score** (tiebreaker) — among modules with the same OOP count, pick the one whose players score highest with malus applied.

This guarantees that out-of-position play only happens when the squad genuinely has no native alternative, not simply because an OOP player happens to score higher after penalty.

### Step 3 — GK

Always the highest-scoring available (non-blocked) GK. Slot 0 in every module.

### Why constrained-slot-first matters

Without it, a greedy fill might consume the squad's only RB in a flexible `WB/RB` slot, forcing the dedicated `RB` slot to use an out-of-position player. Processing the most-constrained slot first ensures scarce players go to the slots that need them.

---

## Score breakdown display

The `ScoreBreakdown` interface tracks each component separately:

```typescript
interface ScoreBreakdown {
  total: number;
  baseRating: number;   // blended season+form rating (e.g. 7.2)
  rating: number;       // ratingScore component
  fixture: number;      // fixtureScore component
  odds: number;         // oddsScore component
  position: number;     // positionScore component
  minutes: number;      // minutesScore component
  form: number;         // team form bonus component
  availability: number; // availabilityPct (0–100)
}
```

In the Tour page, each `SquadRow` card shows:
- **Score badge** with the total score coloured by tier
- **Micro-bar** (5-segment) below the badge showing the proportion from each component:
  - Yellow = rating, Blue = fixture, Green = position stats, Purple = minutes, Teal = form
- **Hover tooltip** listing all five components numerically

The breakdown is display-only — `autoSelect()` uses `total` only.

## Tuning the weights

If auto-select consistently produces poor picks, adjust these constants in `calcScore()`:

| Parameter | Default | Effect if increased |
|---|---|---|
| Rating multiplier | `* 15` | Prioritises higher-rated players more |
| Fixture multiplier | `* 4` (max 16) | Prioritises easy fixtures more |
| Odds multiplier | `* 15` | Prioritises better win probability more |
| CS probability × csBonus × `12` | 12 | Prioritises GK/DEF with expected clean sheets |
| GK goalsPrevented multiplier | `* 5` | Weights shot-stopping GKs more |
| xG × goalBonus × `10` | 10 (ST/FW) | Prioritises high-xG forwards |
| Form bonus multiplier | `* 4` | Weights team momentum more strongly |
| `noFixturePenalty` | `25` | Makes blank-gameweek players less likely to be selected |
| `availabilityPct` divisor | `100` | Always `/ 100` (percentage to decimal) |
