#!/bin/bash
# Regret decomposition: realised points of every formation under engine scores vs oracle (hindsight) scores.
#   sim/run_regret.sh <label> [none|sugg|oracle] [weights.json]      → sim/work/regret_<label>.json   (see report_regret.py)
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SRC="${SRC:-$ROOT/apps/web/src}" TEST_FILE=regret.test.ts ROWS="$HERE/work/rows.json" SQUADS="$HERE/work/squads.json" OUT="$HERE/work/regret_$1.json" \
  AVAIL="${2:-none}" WEIGHTS_JSON="$3" SIM_MODE=engine \
  "$ROOT/node_modules/.bin/vitest" run --config "$HERE/vitest.config.mjs" 2>&1 | grep -E "Tests|passed|failed|Error|error" | head -5
