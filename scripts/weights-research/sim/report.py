"""Compare simulation results: python sim/report.py <base label> <label> [<label> ...]   (results in sim/work/res_<label>.json)"""
import json, os, sys
import numpy as np
import pandas as pd

WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')


def load(label):
    r = json.load(open(os.path.join(WORK, f'res_{label}.json')))['results']
    return pd.DataFrame([{k: v for k, v in x.items() if k != 'ids'} for x in r if x.get('ok')])


def report(base, labels):
    D = {l: load(l) for l in [base] + labels}
    for scen in ('known', 'blind', 'all'):
        m = D[base].scenario.eq(scen) if scen != 'all' else D[base].scenario.notna()
        print(f'--- scenario {scen} ({int(m.sum())} squads); realised points of the XI incl. defence bonus')
        b = D[base].loc[m, 'total']
        for l, d in D.items():
            t = d.loc[m, 'total']
            diff = t - b
            ci = 1.96 * diff.std() / np.sqrt(len(diff))
            print(f'  {l:20s} mean={t.mean():7.3f}  Δ vs {base}={diff.mean():+7.3f} ± {ci:.3f}   played {d.loc[m, "played"].mean():.2f}/11   defence bonus {d.loc[m, "defBonus"].mean():.2f}')


if __name__ == '__main__':
    report(sys.argv[1], sys.argv[2:])
