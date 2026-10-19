"""Regret decomposition: python sim/report_regret.py <label> [<label> ...]   (results of sim/run_regret.sh)

For every simulated squad we know the realised points of the best-by-score XI in EVERY formation, under the engine's
scores and under hindsight (oracle) scores. From that:
  engine        = engine XI in the formation the engine picked (what the app does)
  best_formation= engine XI in the formation that happened to realise most  → what perfect formation choice would add
  oracle_in_eng = hindsight XI in the formation the engine picked           → what perfect player choice would add
  oracle        = hindsight XI in the best hindsight formation
"""
import json, os, sys
import numpy as np

WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')


def report(label):
    R = json.load(open(os.path.join(WORK, f'regret_{label}.json')))['results']
    rows = []
    for r in R:
        if not r['eng']:
            continue
        pick = max(r['engScore'], key=r['engScore'].get)
        rows.append(dict(
            engine=r['eng'][pick],
            best_formation=max(r['eng'].values()),
            fixed_433=r['eng'].get('4-3-3', np.nan),
            oracle_in_eng=r['orc'][pick],
            oracle=max(r['orc'].values()),
            mean_formation=np.mean(list(r['eng'].values())),
            pick=pick, scen=r['scenario'], league=r['key'][0]))
    import pandas as pd
    d = pd.DataFrame(rows)
    print(f'=== {label}: {len(d)} squads')
    for c in ['engine', 'mean_formation', 'best_formation', 'oracle_in_eng', 'oracle']:
        print(f'  {c:16s} {d[c].mean():7.2f}')
    gap = d.oracle.mean() - d.engine.mean()
    f = d.best_formation.mean() - d.engine.mean()
    p = d.oracle_in_eng.mean() - d.engine.mean()
    print(f'  gap to hindsight = {gap:.2f}:  perfect formation alone +{f:.2f},  perfect players alone +{p:.2f}')
    # formation choice vs a random / fixed formation
    diff = d.engine - d.mean_formation
    print(f'  engine formation pick vs average formation (same scores): {diff.mean():+.2f} ± {1.96*diff.std()/np.sqrt(len(d)):.2f}')
    print('  picked formation frequency:', d.pick.value_counts(normalize=True).round(2).to_dict())
    print(d.groupby('league')[['engine', 'best_formation', 'oracle_in_eng', 'oracle']].mean().round(2).to_string())


if __name__ == '__main__':
    for l in sys.argv[1:]:
        report(l)
