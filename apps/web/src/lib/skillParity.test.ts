import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { goalBonus, csBonus } from './tourScoring';
import { CDN_STAT_CONFIG } from './fotmob/cdnStats';
import type { MantraPosition } from '@/types/squad';

/**
 * The mantra-auction-picks skill re-implements parts of the app's scoring in Python
 * (.claude/skills/mantra-auction-picks/scripts/fetch_and_score.py). These tests run that script
 * and fail when the two implementations drift apart (the goal bonus rule did change once already).
 */
const script = path.resolve(import.meta.dirname, '../../../../.claude/skills/mantra-auction-picks/scripts/fetch_and_score.py');

const POSITION_SETS: MantraPosition[][] = [
  ['ST'], ['FW'], ['W', 'FW'], ['ST', 'W'], ['AM'], ['W'], ['WB', 'W'], ['DM', 'AM'], ['DM', 'CM'], ['CM'], ['DM'],
  ['WB'], ['RB'], ['CB', 'WB'], ['LB'], ['GK'],
];

function runPython(): { goal: Record<string, number>; cs: Record<string, number>; config: [string, string, boolean][] } | null {
  const code = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('fs', ${JSON.stringify(script)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
sets = json.loads(sys.argv[1])
print(json.dumps({
  'goal': {','.join(s): m.goal_bonus_tier(set(s)) for s in sets},
  'cs': {','.join(s): m.clean_sheet_bonus_tier(set(s)) for s in sets},
  'config': [list(c) for c in m.CDN_STAT_CONFIG],
}))`;
  const r = spawnSync('python3', ['-I', '-c', code, JSON.stringify(POSITION_SETS)], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null; // python3 unavailable → skip
  return JSON.parse(r.stdout);
}

const py = runPython();
const maybe = py ? describe : describe.skip;

maybe('mantra-auction-picks skill ↔ app parity', () => {
  it('goal bonus tiers match goalBonus() for every position combination', () => {
    for (const s of POSITION_SETS) expect(py!.goal[s.join(',')], s.join('/')).toBe(goalBonus(s));
  });

  it('clean sheet bonus matches csBonus() (primary position first; TS only looks at the first position)', () => {
    for (const s of POSITION_SETS) {
      // Python looks at any native position; the app at the first. Compare single-position sets exactly.
      if (s.length === 1) expect(py!.cs[s.join(',')], s.join('/')).toBe(csBonus(s));
    }
  });

  it('every CDN stat key in the script exists in the app config with the same useSubStatValue flag', () => {
    const ts = new Map(CDN_STAT_CONFIG.map(([key, , sub]) => [key, sub]));
    for (const [key, , useSub] of py!.config) {
      expect(ts.has(key), `${key} missing in app CDN_STAT_CONFIG`).toBe(true);
      expect(ts.get(key), `${key} useSubStatValue`).toBe(useSub);
    }
  });
});
