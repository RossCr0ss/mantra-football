---
name: mantra-auction-picks
description: Rank a supported league's players by previous-season FotMob stats and propose an 11-player round-1 blind-auction target list with bid amounts, for Mantra Football squad building. Use when the user wants auction picks, draft targets, or bid suggestions for a new Mantra Football season/league.
metadata:
  type: analysis-workflow
---

# Mantra Football — Auction Picks

Builds a data-driven ranking of a league's players from the most recent **completed**
season and turns it into a concrete round-1 blind-auction plan (which 11 players to
target, how much to bid on each).

## Mantra Football auction rules (do not re-derive — these are fixed platform rules)

- Total budget: **260M** for a 26-player squad (min 3 GK).
- **Round 1** (initial blind auction): submit offers for exactly **11 players**,
  including **at least 1 GK**, using **up to 220M**. The remaining 40M is reserved
  and unlocks from round 2 onward.
- Round 1 & 2: the platform sets each player's **minimum offer** (1–20M) from their
  previous-season performance. Round 3+ (and all mid-season transfer-window
  auctions): minimum offer is **1M** for everyone.
- It's a **first-price sealed bid**: highest offer wins and pays exactly what they
  bid (not second-price). A tie at the highest offer voids the bid — player is
  unsold, money refunded, player reappears next round.
- Implication: round 1 is when player *quality* still matters for price — round 3+
  is a 1M floor, so it's the efficient place to pick up squad depth
  (backup GK, rotation defenders) rather than spending round-1 budget on them.

## Step 1 — Fetch and score

Run the bundled script (Node 18+/Python 3, no extra deps, read-only — hits FotMob's
public endpoints):

```bash
python3 scripts/fetch_and_score.py --league <leagueId> [--season "YYYY/YYYY"] --out <scratch-path-prefix>
```

- `--league`: use the app's supported league IDs — 47 Premier League, 55 Serie A,
  40 Belgian First Division A, 441 Ukrainian Premier League, 87 LaLiga — or any
  other FotMob league ID the user names.
- `--season`: omit to auto-detect the most recently **completed** season (the
  script checks the league's `seasons` list, which only contains seasons with a
  decided winner — the upcoming season never appears there). Pass explicitly if
  the user wants an older season.
- Output: printed tables (top 40 overall, top 15 per position group, breakout
  watch) plus a full JSON dataset at `<out>.json` for further slicing.

**Known league quirks already handled by the script** — don't rediscover these:
- `expected_goals` CDN stat has swapped `StatValue`/`SubStatValue` semantics vs.
  every other key (verified against 2025/26 PL data) — script uses `StatValue`
  for true xG. If this repo's `apps/web/src/lib/fotmob.ts` `CDN_STAT_CONFIG` still
  has `useSubStatValue: true` for `expected_goals`, flag it to the user — it's a
  live bug affecting their Tour/Analytics scoring, not just this skill.
- Belgian Pro League's `tables[].table.all` playoff shape vs. the standard
  `table.all` shape — handled in `extract_table_rows`.
- Ukrainian clubs with `squad.squad = null` — falls back to
  `overview.lastLineupStats` (no season stats available for those players; note
  this as a data gap rather than silently guessing).
- Ukrainian league's `rating.json` 403s — real season ratings will be missing;
  the composite score still works off the position-specific stats and de-weights
  the rating component naturally (defaults to 0). **Confirmed worse in
  practice**: when combined with `squad.squad = null` on most clubs (only
  Shakhtar Donetsk currently has full granular squad data — everyone else falls
  back to `lastLineupStats`, which carries zero season stats of its own), *zero
  players* end up with both `matchesPlayed` and `seasonRating` populated. The
  per-match formula divides by `matchesPlayed`, so without a guard this
  silently drops every single player — confirmed as an actual empty-output bug
  when first run against league 441. Fixed via `has_per_match_data()` /
  `score_players_totals()`: the script now detects <5% per-match coverage and
  falls back to a TOTALS-ONLY ranking (season goals + assists + clean sheets,
  same position-bonus tiers, no rating/minutes component) with a loud warning.
  Treat totals-mode output as much cruder — it conflates "played a lot" with
  "good", and for the 15 non-Shakhtar clubs the native-position tagging is only
  the coarse GK/DEF/MID/FWD group default (no `positionIdsDesc`), so the
  goal-bonus tier (e.g. CM's default +3 vs a misclassified winger's true +2.5)
  is a guess, not derived from real role data. Also: **UPL's actual Mantra base
  score comes from SofaScore, not FotMob** (per the platform's own rules) — a
  data source this skill has no access to at all, so even a "real" FotMob
  rating wouldn't match what Mantra uses for this specific league.
- Season auto-detection can pick a stale season: `seasons[0]` (used when
  `--season` is omitted) requires a *tagged winner*, and some competitions have
  a fully-finished season with real stats that FotMob just hasn't tagged a
  winner for yet (confirmed: Ukrainian Premier League 2025/2026 — real data,
  real 240/240 finished matches, absent from `seasons` entirely). Fixed by
  preferring `allAvailableSeasons[1]` (index 0 is always the current/upcoming
  season) over `seasons[0]`, falling back to the old logic only if
  `allAvailableSeasons` is missing.
- Players who transferred into the league this summer from elsewhere have no
  previous-season stats in this dataset — flag them explicitly as unrankable by
  this method rather than omitting them silently, since they may still be
  auction-worthy on reputation/scouting grounds the user knows about.

## The actual Mantra Football scoring rules (bake these in — don't approximate)

The script computes each player's estimated points/match using the platform's
*real*, published rules (not a generic proxy):

- **Base score**: the FotMob/SofaScore match rating itself (6.0–10.0 scale;
  UPL uses SofaScore as its base-score source instead of FotMob — same
  mechanics, different provider, default-to-6.5 instead of 6.0 if unrated).
- **Goal bonus depends on the scorer's *native* positions, not the slot they're
  deployed in** — and it's inverted from naive intuition: ST/FW native → **+2**
  (cheapest, since it's "expected" of a striker); AM/W native (no ST/FW) →
  **+2.5**; anyone else (CB/RB/LB/WB/DM/CM/GK — i.e. a defender or holding mid
  scoring) → **+3**. A goal from a pure DM is worth 50% more than the same goal
  from a striker. This is `goal_bonus_tier()` in the script.
- **Assist**: flat **+1** regardless of position.
- **Clean sheet bonus**, also native-position-gated: GK **+1.5**, RB/CB/LB
  **+1.0**, WB/DM **+0.5**, everyone else **0** — requires 60+ min, the
  player's *native* position AND their *module slot* both qualifying, and zero
  goals conceded while they were on the pitch. `clean_sheet_bonus_tier()`.
- **GK-only**: saves bonus (+1 for 6+ saves in a match, +0.5 for 3–5), goals
  conceded malus (**−1 per goal**, including penalties) — a leaky keeper is
  punished hard, a shot-stopper on a mid-table team can still score well.
- **Cards**: yellow −0.5, red −2 (outfield) / −3 (GK), or −2.5/−3.5 if it's a
  second yellow on top of an existing one.
- **Own goal** −2, **earned penalty** +1, **conceded penalty** −1, **saved
  penalty (GK)** +3, **failed penalty (taker)** −2.
- **Defence bonus (team-wide, not per-player!)**: once per match, add up the
  base ratings of the 4 defenders actually in your module that week, average
  them, and look up the tier: <7.00 → 0, 7.00–7.24 → +1, 7.25–7.49 → +2,
  7.50–7.74 → +3, 7.75–7.99 → +4, ≥8.00 → +5. **This is NOT restricted to
  defenders from the same real-life club** — it's purely the average of
  whichever 4 you started, from anywhere. The strategic implication:
  acquiring a *cluster* of several individually high-rated defenders is far
  more valuable than one elite defender surrounded by average ones, because
  one weak link drags the whole average (and therefore the whole bonus tier)
  down. `print_defence_clusters()` groups scored defenders by team and reports
  each team's best-4 average — useful for spotting which real teams currently
  have the deepest high-rated defensive options, but the actual 4 you field
  can mix players from different clubs freely.

**Position-mapping gotcha**: native positions are inferred from FotMob's
`positionLabel` via `guess_native_positions()`, which deliberately does NOT
reuse `apps/web/src/lib/mantraPositions.ts`'s `guessMantraPositions()` verbatim
— that function has two confirmed bugs (only inspects the first token of a
multi-token label like `"RB,CB,LB"`; never checks for wing/AM tokens within the
FWD group, so wingers like Saka labeled `"RW,CAM"` misclassify as ST). The
script's version fixes both, which matters here because it changes which
goal-bonus tier a player falls into (a mid-value difference of +2 vs +2.5 per
goal). This is still a best-effort guess, not Mantra's own canonical
native-position database — flag it as an approximation, not ground truth.

## Step 2 — Build the round-1 target list (needs judgment — do this yourself, not the script)

From the scored output, select **11 players** including **at least 1 GK**:

1. Rank by `mantraPerMatch`, but don't just take the raw top 11 — a naive top-11
   skews toward the most famous attacking names, and in a *sealed-bid blind*
   auction, fame drives crowd bidding independent of actual scoring value.
   Cross-reference `print_defence_clusters()` output: acquiring 3-4 individually
   high-rated defenders (regardless of which real club — see above) is close to
   a free lunch, since most casual managers don't price in the defence-bonus
   mechanic at all.
2. Separate "everyone will overbid this player" risk from "this player is
   actually good" — they're different axes. The scoring model will often still
   rank global superstars #1 (they earned it), but round-1 money is better spent
   securing several near-as-good, far-less-contested alternatives than winning
   a bidding war on the 1-2 most recognizable names. Watch for **hidden-value
   transfers**: a player whose squad `teamName` this year is a bigger/stronger
   club than the one their previous-season stats were earned at (a summer
   move) — fans haven't recalibrated their perception of them yet, so they're
   often underpriced relative to their new, better team context.
3. Prefer reliable-minutes players (full-season starters) over high-per-90 but
   low-sample players for the round-1 core — save "breakout watch" flags for
   later cheap-round gambles (1M floor), not round-1 money.
4. If the user has a target formation in mind, sanity-check the 11 isn't so
   top-heavy in one position group that later rounds can't complete a legal
   squad (3 GK minimum, needs enough natural DEF/MID/FWD depth) — but don't force
   balance the user didn't ask for.

## Step 3 — Allocate bids (≤220M, first-price sealed bid)

Tier the 11 picks and assign whole-number bids (1M increments) summing to
somewhat under 220M (leave a few M of headroom — unspent round-1 allocation isn't
lost, it just isn't locked in until a bid wins):

- **Tier S** (rare statistical outliers / clear #1 overall picks): highest bids.
- **Tier A** (proven high-confidence starters): mid-high bids.
- **Tier B** (very good value / scarcity picks — GK, defenders): lower bids,
  since per-manager demand for these positions is typically thinner.

Be explicit that these are *suggested* amounts, not known market-clearing prices
— it's a blind auction against unknown competitors, so caveat the top 2-3 "everyone
wants them" picks as the ones most likely to need upward adjustment, and the
cheaper value picks as the safer bets to land near the suggested price.

## Output format

Present: the scored tables (trimmed to what's relevant), the 11 recommended
targets with one-line reasoning each, the suggested bid per player, the running
budget total, and a short "why this shape" note (position mix rationale). Call out
data-quality caveats (missing stats, new transfers, league-specific gaps) before
the recommendations, not buried after.
