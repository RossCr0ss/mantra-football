# Scoring weights — research notes (October 2026)

How the weights of `calcScore()` (`docs/scoring.md`) were derived from historical matches, what the backtest showed, and how to repeat it when the rules or the data change. Code: `scripts/weights-research/` (README there). Numbers below are from the run of 2026-10-09.

## Question

The old score was a sum of hand-picked terms on arbitrary scales (`(rating−6)×15 + (difficulty−1)×4 + winProb×15 + position stats + minutes + team form`). Are those weights any good, and what is the best formula for choosing the XI?

## Data

| | |
|---|---|
| Matches | 3,138 finished league matches: Premier League, Serie A, LaLiga, Belgian Pro League × 2024/25, 2025/26, 2026/27 (to early Oct) |
| Per player and match | FotMob `matchDetails`: rating, minutes, events (goals, penalties, own goals, cards, subs), ~40 match stats — 135k appearances + 41k "absent" rows (in the team's last 10 squads but not in this one: injured / rotated) |
| Odds | FotMob `matchOdds` 1X2 for 91 % of matches (available for finished matches too) |
| Mantra positions | official `position_classic_arr` from mantrafootball.org, matched by name for 2,257 of 4,333 players (rest: most common Mantra position of their FotMob starting slot) |
| **Ground truth** | Mantra points per appearance from the official rules: FotMob rating (6.0 if played without one) + goal bonus by native position (penalty +2) + assist + earned/saved/conceded/missed penalties + own goal + cards + GK saves and conceded goals + clean sheet (≥ 60 min, none conceded while on the pitch). Mean 7.11 per appearance = 6.78 rating + 0.33 bonuses |

Ukraine is excluded: Mantra uses SofaScore ratings there (6.5 default), FotMob's are not the base score. The app still applies the same weights to the Ukrainian league — treat them as unvalidated there.

All features are **point-in-time** (only matches before the one predicted) and built exactly like the app builds them (season-to-date totals blended with last season, same fallbacks).

## Method

* Split by time: weights fitted on matches before 2026-02-15, evaluated after (23k appearances, 1,944 simulated squads). The final weights are re-fitted on everything; the numbers below are from the hold-out fit.
* **V** = expected Mantra points of a player who starts: per position group, ridge regression (α = 1000) with sign constraints (win prob ≥ 0, opponent win prob ≤ 0, stats ≥ 0). **P** = probability of starting: logistic regression. Score = `15 × P × (V − 5)`.
* Evaluation that matters: a **squad simulation** with the real code (`calcScore` + `pickBestModule` incl. formation choice, malus and defence bonus). For every league-round, random 26-man squads (3 GK + 23 outfield by position quota, 78 % regulars / 22 % rotation players) pick their XI with the old and the new engine; the realised Mantra points of the XI (+ the real defence bonus) are compared, paired per squad. A starter who does not play scores 0 (no bench modelled).

## Findings

1. **A single match is mostly noise.** The fitted linear model explains 3–10 % of the variance of a starter's points (GK 3 %, DEF 8 %, MID 10 %, FWD 7 %), and a gradient-boosting model on all features is no better (correlation with a starter's points 0.25 vs 0.26). Expect modest gains from any formula; the old one is not "wrong", it is mis-weighted.
2. **Match context beats player quality.** Points of a starter ≈ +1.0 per unit of own win probability, −0.6…−1.3 per unit of opponent win probability, positively for draws for GK/DEF (clean sheets) and negatively for attackers. The old formula had an own-win term only (15 units ≈ 1 point per unit — correct) but no opponent term, plus a redundant `difficulty` term (a worse proxy of the same thing; the odds-based version is 0.18 correlated with points, difficulty 0.10).
3. **The season rating is over-weighted.** One point of season rating predicts only 0.55 points of the next match's rating (regression to the mean) and, once context and attacking stats are in, 0.03–0.17 points of the total. The old weight was 15 units = 1 point per rating point. (Setting it to 0.5 or 1.0 for every group instead of the fitted value changes the simulated result by +0.17 ± 0.18 / −0.09 ± 0.21 — i.e. the XI is not sensitive to it, but there is no case for the large weight.)
4. **Defensive stats (tackles, interceptions, clearances, blocks, fouls…), team form and difficulty add nothing** beyond the terms above (incremental held-out R² ≈ 0). Attacking output does: xG × goal bonus, key passes, big chances created (assists a little). The old position-specific formulas were largely noise.
5. **Playing time is the biggest lever.** Average minutes per appearance (old "minutes" term, AUC 0.75) ignores rotation; the share of the team's minutes played (AUC 0.81) works much better; with the last 5 matches' starts/minutes it would be 0.85 (not available in the Tour page today). The new model without start probability is *worse* than the old formula (−2.2 points); with it, it is better by +3.4.
6. **Calibration is good.** Held-out starters: mean predicted 7.41 vs realised 7.43; by decile of prediction 6.64→6.63 … 8.28→8.45. Start probability is slightly conservative for regulars (0.88 predicted vs 0.93 realised in the top decile).
7. The **malus** was applied only to the rating component, floored at 0 — a weakly rated out-of-position player lost almost nothing. The real game subtracts it linearly; `effectiveScore` now does too.

## Backtest: realised Mantra points of the chosen XI (+ defence bonus)

1,944 simulated squads, hold-out period (Feb–May 2026 + the first rounds of 2026/27). Δ = new − old, ± 95 % CI of the paired difference.

| Availability information | old | new | Δ |
|---|---|---|---|
| none (`availabilityPct` unset) | 72.0 | 75.4 | **+3.4 ± 0.35** |
| `availabilityPct` = "suggested" from the last 5 matches (what the Team page stores) | 75.7 | 76.8 | **+1.1 ± 0.26** |
| lineup known (oracle availability) | 82.0 | 82.7 | **+0.7 ± 0.18** |

For scale: random XI 64.3, perfect hindsight 89.9. 7 points = 1 team goal in Mantra, so +3.4 ≈ +0.5 goals per tour without availability input, +1.1 ≈ +0.16 goals with it. The gain is positive in every league and period (no availability: Belgium +2.3, Premier League +4.0, Serie A +3.0, LaLiga +4.6, each ± 0.7; with suggestions Belgium +0.3 ± 0.5, others +0.8…+2.1).

Ablations (with suggested availability, vs the full new model): without attacking terms −0.1 ± 0.13, without odds context −0.3 ± 0.2, without rating −0.3 ± 0.15. Blending the suggested availability with the minutes model: 0 → +0.94, 0.3 → +1.13, 0.5 → +1.10, 0.7 → +0.77 (0.4 used). Replacement level 0…5 equal, 6.5 worse.

Takeaway: **who plays** decides the XI; the individual weights matter at the margin. Make sure every player has an availability (Team page suggestions), and keep the minutes model for those who have none.

## Caveats

* **The old baseline is flattering to the old formula.** The backtest feeds it correct stats, but the production data are partly broken: the CDN `shots` field is the shot *accuracy %* (Haaland 2025/26: 46.8 vs 59 shots on target of 126), `foulsCommitted` / `bigChancesMissed` / `possessionWonFinal3rd` are not totals either, and `successfulDribbles`, `aerialsWon`, `dribbledPast`, `highClaims` are never fetched. The new model avoids all of these (`docs/refactor-backlog.md` §10).
* CDN stat lists are top-N lists: a missing player reads as 0. Backtest features are complete, production ones are not — the new terms use fields present in the lists for most players (of the 537 PL players: xG 83 %, key passes 82 %, big chances 61 %); the rest are mostly low-minute players with a low start probability anyway.
* Squads are random, not auction squads; the starter who does not play scores 0 (a bench would soften it); Mantra positions are proxies for ~30 % of the appearances (players who left the league); the backtest used the goal bonus rule in force since 01.06.2026 for all seasons (ratings are unaffected, bonuses are small).
* Odds are Bet365 (GB) pre-match prices resolved by FotMob; the app fetches 22Bet (UKR). Same market, slightly different overround — the fit uses raw `1/odds` like the app.
* GK scores are hardly predictable (R² 3 %); the GK pick is essentially "the one most likely to play".

## Ideas not done

* Per-player recent matches (starts, minutes, ratings of the last 5) from `matchDetails` — unauthenticated, unlike the Turnstile-blocked `playerData`. Start-probability AUC 0.81 → 0.85; the form route could be built from it. This is the largest remaining lever.
* Replace the defence bonus step function by its expected value (a smooth function of the defenders' predicted ratings) — the oracle gets 1.4 bonus points per tour, the engine 0.55.
* Fix the CDN extraction (`shots`, fouls, …) and use xA / shots on target (xA is in match stats but not in the CDN lists).
* Position-specific replacement level / a real bench model.

## Reproduce

See `scripts/weights-research/README.md`: `fetch_data.py` → `build_table.py` → `features.py` → `fit_weights.py holdout|all` → `export_sim.py` → `sim/run_sim.sh` + `sim/report.py`. Fetching takes ~10 minutes, everything else under a minute. Re-run when the Mantra rules change (`build_table.py` encodes them) or at the start of a season, then update `SCORE_WEIGHTS`, `docs/scoring.md` and `tourScoring.weights.test.ts`.
