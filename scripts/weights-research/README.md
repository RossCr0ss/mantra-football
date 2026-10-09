# weights-research

Re-fits the weights of `calcScore()` (`apps/web/src/lib/tourScoring.ts`) on historical matches and compares engines by simulating squads with the real selection code. Method, results and caveats: **`docs/scoring-research.md`**. Not part of the yarn workspaces and not run by CI; Python 3 + `pip install -r requirements.txt`, Node/yarn deps come from the repo.

```
python fetch_data.py             # 1. FotMob matchDetails + odds, Mantra positions → data/   (~10 min, resumable)
python build_table.py            # 2. match × player table with ground-truth Mantra points → data/pts.pkl
python features.py               # 3. point-in-time features → data/feat.pkl                 (~30 s)
python fit_weights.py holdout    # 4. fit before 2026-02-15, report R² / AUC after it
python fit_weights.py all        #    final fit → numbers for SCORE_WEIGHTS (data/weights_all.json)
python export_sim.py             # 5. evaluation rows + random 26-man squads → sim/work/
sim/run_sim.sh <src> <label> [none|sugg|oracle] [weights.json] [engine|oracle|random]   # 6. run an engine
python sim/report.py <base label> <label> ...                                            #    compare
```

Comparing two versions of the engine: export the old one with `git archive <rev> apps/web/src | tar -x -C sim/work/old`, then

```
sim/run_sim.sh "$PWD/sim/work/old/apps/web/src" old
sim/run_sim.sh "$PWD/../../apps/web/src" new none data/weights_holdout.json   # holdout-fitted weights = unbiased
python sim/report.py old new
```

Changing the leagues/seasons: `LEAGUES=…`, `SEASONS=…` for `fetch_data.py` (and `LEAGUES` / `MANTRA_TOURNAMENT` in it, `LEAGUES` in `build_table.py`). Changing a rule (goal bonus, clean-sheet bonus, cards…): `build_table.py` → `add_points` (check https://mantrafootball.org/rules). The features in `fit_weights.py` (`feats`) must stay identical to `calcScore` / `estimateStartProb`; after refitting update `SCORE_WEIGHTS`, `docs/scoring.md` and `tourScoring.weights.test.ts` together.

`data/` and `sim/work/` are git-ignored (≈ 250 MB).
