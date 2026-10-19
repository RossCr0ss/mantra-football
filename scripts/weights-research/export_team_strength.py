"""Exports the own match-strength model for the app: apps/web/src/lib/teamStrengthCoef.json + a golden test file.

  python export_team_strength.py     # needs data/match_model.pkl (match_model.py)

* coefficients of the multinomial logistic regression 1X2 ~ [elo_diff, lam_diff, lam_tot] (raw features, softmax over
  home / draw / away), fitted on every match from 2024-10 on;
* golden values (pre-match Elo difference and λ's of selected matches of one league) that pin the TypeScript
  implementation of the rating updates (lib/teamStrength.test.ts) to this script.
"""
import json, os
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'apps', 'web', 'src', 'lib')
F = pd.read_pickle(os.path.join(HERE, 'data', 'match_model.pkl'))
COLS = ['elo_diff', 'lam_diff', 'lam_tot']

tr = F[F.date >= '2024-10-01']
mu, sd = tr[COLS].mean(), tr[COLS].std()
m = LogisticRegression(C=1.0, max_iter=2000).fit((tr[COLS] - mu) / sd, tr.y)
coef = m.coef_ / sd.values                     # classes 0 = home, 1 = draw, 2 = away
icpt = m.intercept_ - (coef * mu.values).sum(axis=1)
coef_json = dict(features=COLS, intercept=[round(float(x), 5) for x in icpt],
                 coef=[[round(float(x), 5) for x in row] for row in coef])
json.dump(coef_json, open(os.path.join(OUT, 'teamStrengthCoef.json'), 'w'), indent=1)
print('coefficients', coef_json)

# golden: league 47 — every 12th match of 2024/25 + the first 30 of 2025/26 (covers the season-start shrink)
g = F[F.league == 47].sort_values(['date', 'match_id']).reset_index(drop=True)
s1 = g[g.season == '2024/2025']; s2 = g[g.season == '2025/2026']
upto = pd.concat([s1, s2.head(30)])
keep = set(s1.index[::12]) | set(s2.head(30).index)
gold = dict(
    matches=[dict(season=r.season, h=int(r.h), a=int(r.a), hs=int(r.hs), as_=int(r.as_), hxg=float(r.hxg), axg=float(r.axg),
                  date=str(r.date)) for r in upto.itertuples()],
    expected=[dict(i=int(list(upto.index).index(i)), elo_diff=float(g.loc[i, 'elo_diff']), lam_h=float(g.loc[i, 'lam_h']), lam_a=float(g.loc[i, 'lam_a']))
              for i in sorted(keep)])
p = np.exp(np.array(coef_json['intercept']) + np.array([[g.loc[e['i'] if False else upto.index[e['i']], c] for c in COLS] for e in gold['expected']]) @ np.array(coef_json['coef']).T)
p = p / p.sum(axis=1, keepdims=True)
for e, row in zip(gold['expected'], p):
    e['p'] = [round(float(x), 5) for x in row]
json.dump(gold, open(os.path.join(OUT, 'teamStrength.golden.json'), 'w'), separators=(',', ':'))
print('golden matches', len(gold['matches']), 'expected', len(gold['expected']))
