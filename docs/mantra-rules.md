# Mantra Game Rules

Mantra is an Italian fantasy football format played with real league squads. This document covers the rules as implemented in the app.

Reference: https://mantrafootball.org/rules

---

## Positions

Mantra uses 11 specific positions, grouped into 4 categories.

| Code | Full name | Italian | Group | Notes |
|---|---|---|---|---|
| GK | Goalkeeper | Por | GK | |
| RB | Right Back | Dd | DEF | |
| CB | Centre Back | Dc | DEF | |
| LB | Left Back | Ds | DEF | |
| WB | Wing Back | E | DEF | Covers both RWB and LWB |
| DM | Defensive Midfielder | M | MID | |
| CM | Central Midfielder | C | MID | |
| W | Winger | W | MID | |
| AM | Attacking Midfielder | T | MID | |
| FW | Wing Forward | A | FWD | "Second striker" or wide forward |
| ST | Striker | Pc | FWD | Central striker |

A player can have **multiple Mantra positions** if they naturally play multiple roles (e.g. a player listed as both WB and W). This is set manually by the user in the app.

### FotMob → Mantra position mapping

FotMob uses different position labels. `guessMantraPositions()` in `mantraPositions.ts` maps them automatically when a player is first added to the squad. Users can override via the position editor.

| FotMob label | → Mantra position(s) |
|---|---|
| GK / goalkeeper | GK |
| Right Back, RB, Dd | RB |
| Left Back, LB, Ds | LB |
| Right Wing Back, RWB | RB, WB |
| Left Wing Back, LWB | LB, WB |
| Wing Back, WB, E | WB |
| Centre Back, CB, Dc | CB |
| Defensive Mid, DM, CDM, M | DM |
| Attacking Mid, AM, CAM, T | AM |
| Right/Left Wing, LW, RW, W | W |
| Second Striker, SS, A | FW |
| Striker, CF, Pc | ST |
| (anything else in MID) | CM |
| (anything else in FWD) | ST |

---

## Squad rules

- **26 players total** (defined in `SQUAD_RULES`)
- **Exactly 3 goalkeepers**
- No other position quotas — the user decides the rest

---

## Tour (matchday selection)

For each matchday tour the user selects:

- **11 main players** (starting XI):
  - Exactly **1 GK**
  - 10 outfield players matching the chosen formation
- **9 substitutes**:
  - At least **1 GK** must be on the bench

All 20 must come from the saved 26-player squad.

---

## Clean sheet bonus

Clean sheets add bonus points for defensive players. Used in the scoring algorithm's `csBonus()` function:

| Position | Bonus |
|---|---|
| GK | +1.5 |
| RB, CB, LB | +1.0 |
| WB, DM | +0.5 |
| CM and all attackers | 0 |

---

## Goal bonus

Goals are worth more for players in naturally defensive/creative positions, and less for pure strikers (since goals are their base job). Used in `goalBonus()`:

| Primary position | Points per goal |
|---|---|
| ST | +2 |
| FW | +2.5 |
| All others (GK, DEF, MID, AM, W) | +3 |

---

## Formations (modules)

12 supported modules. Each defines 10 outfield slots (GK = slot 0, always required separately).

Each slot accepts one or more Mantra positions separated by `/`. A player can fill a slot if **any** of their Mantra positions matches one of the slot's accepted positions.

| Module | Slot positions (left to right: defensive → attacking) |
|---|---|
| 3-4-3 | CB, CB, CB \| WB, DM/CM, CM, WB \| W/FW, FW/ST, W/FW |
| 3-4-1-2 | CB, CB, CB \| WB, DM/CM, CM, WB \| AM \| FW/ST, FW/ST |
| 3-4-2-1 | CB, CB, CB \| WB/W, DM, DM/CM, WB \| AM, AM/FW \| FW/ST |
| 3-5-2 | CB, CB, CB \| WB/W, DM, DM/CM, CM, WB \| FW/ST, FW/ST |
| 3-5-1-1 | CB, CB, CB \| DM, DM, CM, WB/W, WB/W \| AM/FW \| FW/ST |
| 4-3-3 | RB, CB, CB, LB \| DM/CM, CM, DM \| W/FW, FW/ST, W/FW |
| 4-3-1-2 | RB, CB, CB, LB \| DM/CM, DM, CM \| AM \| FW/ST, FW/ST |
| 4-4-2 | RB, CB, CB, LB \| WB/W, DM/CM, CM, WB \| FW/ST, FW/ST |
| 4-1-4-1 | RB, CB, CB, LB \| DM \| WB/W, CM/AM, AM, W \| FW/ST |
| 4-4-1-1 | RB, CB, CB, LB \| WB/W, DM, CM, WB/W \| AM/FW \| FW/ST |
| 4-2-3-1 | RB, CB, CB, LB \| DM, DM/CM \| W/AM, AM, W/FW \| FW/ST |
| 4-3-2-1 | RB, CB, CB, LB \| DM/CM, DM, CM \| AM/FW, AM/FW \| FW/ST |

### Out-of-position play (malus)

A player can be assigned to a slot outside their registered Mantra positions only as a **last resort** — when no player with a compatible native position remains unused. In that case, a **malus** is applied directly to their FotMob match rating:

| Malus | Example |
|---|---|
| **−1.5** | Adjacent positions: RB ↔ CB, RB ↔ LB, DM ↔ CM, W ↔ AM, FW ↔ ST |
| **−3.0** | Distant positions: CB ↔ DM, WB ↔ LB/RB, CM ↔ AM, ST ↔ W |
| **Incompatible** | Cannot play (e.g. GK in outfield slot) |

**Example:** A CB playing as RB gets −1.5. If FotMob rates them 6.0 that match, their effective Mantra score is 4.5.

The malus is subtracted from the FotMob match rating only. Goals, assists, and clean sheet bonuses are still awarded normally.

### Slot filling algorithm

`assignModule()` uses a **constrained-slot-first** strategy to avoid deadlocks and minimise out-of-position play:

1. Find the slot with the **fewest eligible remaining players** (most constrained).
2. If **native players** (malus = 0) exist for that slot: assign the highest-scoring one. Out-of-position players are **never used** when a native option is available.
3. Only if **no native player remains**: assign the best out-of-position compatible player.
4. Mark that player as used and repeat.

When comparing formations, the algorithm **always prefers a formation with zero out-of-position slots** over one that requires any OOP assignment, regardless of score. Score is only a tiebreaker among formations with equal OOP counts.

This ensures, for example, that the only RB in the squad is used as RB rather than accidentally consumed by a WB/RB slot when filling WB first.

---

## Difficulty scale (fixture difficulty)

Used to weight scoring in the auto-select algorithm.

| Difficulty | Opponent position | Display |
|---|---|---|
| 1 | Top of table (~1–4) | Red |
| 2 | Upper mid (~5–8) | Orange |
| 3 | Mid table (~9–12) | Yellow |
| 4 | Lower mid (~13–16) | Light green |
| 5 | Bottom of table (~17–20) | Dark green |

Formula: `difficulty = ceil(opponentTablePosition / totalTeams * 5)`, clamped 1–5.

A player with an easy fixture (difficulty 5) has a better chance of a clean sheet and more goal opportunities, both of which contribute to Mantra points.
