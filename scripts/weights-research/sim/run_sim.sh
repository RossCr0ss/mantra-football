#!/bin/bash
# Runs the real calcScore() + pickBestModule() of one apps/web/src version over the exported squads.
#   sim/run_sim.sh <src_dir> <label> [none|sugg|oracle] [weights.json] [engine|oracle|random]
# AVAIL   none   = availabilityPct unset (the score estimates start probability itself)
#         sugg   = availabilityPct = "suggested" value from the last 5 matches (what the Team page stores)
#         oracle = availabilityPct 100/0 from who actually started (upper bound: lineup known)
# MODE    oracle = rank by the real points (upper bound), random = random scores (lower bound)
# weights.json (optional) is deep-merged over SCORE_WEIGHTS of the engine under test (e.g. data/weights_holdout.json).
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
mkdir -p "$HERE/work"
SRC="$1" ROWS="$HERE/work/rows.json" SQUADS="$HERE/work/squads.json" OUT="$HERE/work/res_$2.json" SCORES_OUT="$HERE/work/scores_$2.json" \
  AVAIL="${3:-none}" WEIGHTS_JSON="$4" SIM_MODE="${5:-engine}" \
  "$ROOT/node_modules/.bin/vitest" run --config "$HERE/vitest.config.mjs" 2>&1 | grep -E "Tests|passed|failed|Error|error" | head -5
