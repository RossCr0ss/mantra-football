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

### 1. Rating score (0–∞, typical 0–20)

```
seasonRating = analytics.rating ?? 6.0
formRating   = average of last 5 match ratings where minutesPlayed > 30 (null if < 3 rated matches)
blendedRating = formRating != null ? seasonRating * 0.6 + formRating * 0.4 : seasonRating
ratingScore  = max(0, (blendedRating - 6.0) * 18)
```

FotMob ratings run roughly 6.0–8.5. A 7.0 rating = 18 points; 7.5 = 27 points; 8.0 = 36 points. Players with no rating data default to 6.0 (zero points).

**Form blend:** The form data from `/api/leagues/[id]/form` is derived from the fixtures cache (team results) and does not include individual player ratings (`rating: null`). The 40% form weight therefore only activates if `fetchPlayerRecentMatches` (Turnstile-blocked) has previously populated per-match ratings for that player. In practice the blend is currently always 100% season rating.

### 2. Fixture score (0–16)

```
fixtureScore = (difficulty - 1) * 4
```

`difficulty` 1–5 from league table position. Easy fixture (5) = 16 points; hard fixture (1) = 0 points. A player with no upcoming fixture gets `-25` penalty.

Wait — difficulty 1 means hardest opponent (top of table), difficulty 5 means easiest. So:
- difficulty 1 → fixtureScore = 0 (hard match, bad)
- difficulty 5 → fixtureScore = 16 (easy match, good)

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

**GK:**
```
csProb = blend of fixture-difficulty CS probability and actual clean sheet rate
savesPerMatch = saves / matchesPlayed
positionScore = effectiveCsProb * csBonus * 12 + savesPerMatch * 0.4
```

`csBonus` for GK = 1.5 (Mantra awards +1.5 for GK clean sheet).

When the player has > 3 matches played and `cleanSheets` data is available, actual CS rate gets 60% weight and fixture-based estimate gets 40% weight. Without CS data, 100% fixture-based.

**DEF:**
```
defContrib = tackles/MP * 0.8 + interceptions/MP * 1.0 + clearances/MP * 0.4
           + blockedShots/MP * 0.8 + possessionWonFinal3rd/MP * 0.5
           + aerialsWon/MP * 0.4 - dribbledPast/MP * 0.5 - foulsCommitted/MP * 0.25
positionScore = csProb * csBonus * 10 + goalsPerMatch * goalBonus * 6
              + assistsPerMatch * 4 + defContrib
```

`csBonus`: RB/CB/LB = 1.0, WB/DM = 0.5 (Mantra clean sheet bonus by position).
`goalBonus`: ST primary = 2, FW primary = 2.5, others = 3 (Mantra goal point value by position).

All per-match defensive stats (`tackles`, `interceptions`, `clearances`, `blockedShots`, `possessionWonFinal3rd`, `foulsCommitted`) are now populated from the CDN. `aerialsWon` and `dribbledPast` are not available from CDN and default to 0.

**MID:**
```
xgPerMatch = expectedGoals / matchesPlayed   (or goals/played if xG unavailable)
kpPerMatch = chancesCreated / matchesPlayed  (or assists/played if chancesCreated unavailable)
defContrib = tackles/MP * 0.4 + interceptions/MP * 0.6
positionScore = xgPerMatch * goalBonus * 7 + kpPerMatch * 5 + shots/MP * 0.15
              + bigChancesCreated/MP * 4 + successfulDribbles/MP * 0.3 + defContrib
```

**FWD:**
```
positionScore = xgPerMatch * goalBonus * 10 + assistsPerMatch * 5
              + shots/MP * 0.25 + bigChancesCreated/MP * 2
              + successfulDribbles/MP * 0.4 + aerialsWon/MP * 0.3
              - bigChancesMissed/MP * 2.0
```

FWD gets higher xG weight than MID because forwards convert more consistently. `successfulDribbles` and `aerialsWon` are not available from CDN; `bigChancesCreated`, `bigChancesMissed`, `shots`, `chancesCreated`, `expectedGoals` are all populated from CDN.

### 5. Minutes score (0–10)

```
avgMinutes = minutesPlayed / matchesPlayed
minutesScore:
  82+ min/game → 10
  70+ min/game → 7
  55+ min/game → 4
  40+ min/game → 1
  <40 min/game → 0
```

Rewards players who play most of the match. A player averaging 50 min/game might not finish; a sub is unreliable for Mantra points.

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
baseTotal = ratingScore + fixtureScore + oddsScore + positionScore + minutesScore - noFixturePenalty
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
effectiveRatingScore = max(0, (effectiveRating - 6.0) * 18)
```

**Examples:**
- Player rated 6.0, malus −1.5 → effective rating 4.5 → ratingScore 0
- Player rated 7.5, malus −1.5 → effective rating 6.0 → ratingScore 0
- Player rated 8.0, malus −1.5 → effective rating 6.5 → ratingScore 9

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
  baseRating: number;  // blended season+form rating (e.g. 7.2)
  rating: number;      // ratingScore component
  fixture: number;     // fixtureScore component
  odds: number;        // oddsScore component
  position: number;    // positionScore component
  minutes: number;     // minutesScore component
  availability: number; // availabilityPct (0–100)
}
```

In the Tour page, each `SquadRow` card shows:
- **Score badge** with the total score coloured by tier
- **Micro-bar** (4-segment) below the badge showing the proportion from each component:
  - Yellow = rating, Blue = fixture, Green = position stats, Purple = minutes
- **Hover tooltip** listing all four components numerically, e.g. `Rating 12.3 · Fixture 8.0 · Position 4.5 · Minutes 7.0`

The breakdown is display-only — `autoSelect()` uses `total` only.

## Tuning the weights

If auto-select consistently produces poor picks, adjust these constants in `calcScore()`:

| Parameter | Default | Effect if increased |
|---|---|---|
| Rating multiplier | `* 18` | Prioritises higher-rated players more |
| Fixture multiplier | `* 4` (max 16) | Prioritises easy fixtures more |
| Odds multiplier | `* 15` | Prioritises better win probability more |
| CS probability × csBonus × `12` | 12 | Prioritises GK/DEF with expected clean sheets |
| xG × goalBonus × `10` | 10 (FWD) | Prioritises high-xG forwards |
| `noFixturePenalty` | `25` | Makes blank-gameweek players less likely to be selected |
| `availabilityPct` divisor | `100` | Always `/ 100` (percentage to decimal) |
