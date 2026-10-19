"""Does an own match-strength model add to the player-points model? (docs/scoring-research.md §Match difficulty)

  python incremental_value.py     # needs data/feat.pkl, data/match_model.pkl (match_model.py)

Held-out (fit < 2026-02-15, test after) R² of a starter's Mantra points, per position group, for
  A  the current model (1X2 odds, table-difficulty fallback)               — fit_weights.py
  B  A + the team's own expected goals (λ for / against, clean-sheet prob.)  — "own λ" from the xG-form model
and, for the fallback situation (no odds), the same model fed with
  odds | own-model 1X2 probabilities | the app's 5-step table difficulty.
Paired bootstrap over matches for the CI of the difference in squared error.
"""
import numpy as np, pandas as pd, warnings
from sklearn.linear_model import Ridge, LogisticRegression
from common import load_features
from fit_weights import feats, SETS, ALPHA, HOLDOUT_FROM, WP_BY_DIFF, OWP_BY_DIFF, DP_DEFAULT
warnings.filterwarnings('ignore')

df = load_features()
M = pd.read_pickle('data/match_model.pkl')
M['date'] = pd.to_datetime(M.date, utc=True)

# --- own 1X2 probabilities for every match, walk-forward (train on earlier matches, all of them) ---
OWN = ['elo_diff', 'lam_diff', 'lam_tot']
M['month'] = M.date.dt.strftime('%Y-%m')
for c in ('op_h', 'op_d', 'op_a'):
    M[c] = np.nan
for mth in sorted(M.month.unique()):
    tr = M[(M.month < mth) & (M.date >= '2024-10-01')]
    te = M[M.month == mth]
    if len(tr) < 300 or len(te) == 0:
        continue
    mu, sd = tr[OWN].mean(), tr[OWN].std().replace(0, 1)
    p = LogisticRegression(C=1.0, max_iter=1000).fit((tr[OWN] - mu) / sd, tr.y).predict_proba((te[OWN] - mu) / sd)
    M.loc[te.index, ['op_h', 'op_d', 'op_a']] = p

keep = ['match_id', 'lam_h', 'lam_a', 'op_h', 'op_d', 'op_a']
D = df.merge(M[keep], on='match_id', how='left')
H = D.is_home.astype(bool)
D['lam_for'] = np.where(H, D.lam_h, D.lam_a); D['lam_opp'] = np.where(H, D.lam_a, D.lam_h)
D['own_win'] = np.where(H, D.op_h, D.op_a); D['own_opp'] = np.where(H, D.op_a, D.op_h); D['own_draw'] = D.op_d

F = feats(D)
F['lf'] = D.lam_for.values; F['nla'] = -D.lam_opp.values
F['pcs'] = np.exp(-D.lam_opp.values) * D.csb.values       # P(clean sheet) × clean-sheet bonus
EXTRA = ['lf', 'nla', 'pcs']

holdout = D.date < HOLDOUT_FROM
train = holdout; test = ~holdout & (D.season != '2024/2025') & D.own_win.notna() & D.win_prob.notna()
st = D.started & D.pts.notna()
rng = np.random.default_rng(3)


def fit_predict(g, cols, Fte=None):
    gm = D.group == g
    tr, te = train & gm & st, test & gm & st
    X = F.loc[tr, cols]; mu, sd = X.mean(), X.std().replace(0, 1)
    m = Ridge(alpha=ALPHA, positive=True).fit((X - mu) / sd, D.loc[tr, 'pts'])
    Xt = (Fte if Fte is not None else F).loc[te, cols]
    return te, m.predict((Xt - mu) / sd)


def swap(F0, win, opp, draw):
    G = F0.copy()
    G['wp'] = win; G['owp'] = opp; G['nowp'] = -opp; G['dp'] = draw; G['dpp'] = draw; G['dpn'] = -draw
    G['csb_wp'] = D.csb.values * win; G['csb_owp'] = D.csb.values * opp; G['csb_nowp'] = -G['csb_owp']
    return G


def paired(g, a, b, te):
    y = D.loc[te, 'pts'].values
    d = (y - a) ** 2 - (y - b) ** 2          # >0 → b is better
    mid = D.loc[te, 'match_id'].values
    u, inv = np.unique(mid, return_inverse=True)
    s = np.bincount(inv, d); n = np.bincount(inv)
    bs = [s[i].sum() / n[i].sum() for i in (rng.integers(0, len(u), len(u)) for _ in range(300))]
    return d.mean(), 1.96 * np.std(bs), 1 - ((y - b) ** 2).mean() / ((y - y.mean()) ** 2).mean()


print(f'held-out starters: {int((test & st).sum())}   (matches with odds and own probabilities)')
print('\n(1) own expected goals as extra regressors on top of the odds model — Δ MSE of points per starter (positive = B better)')
for g, cols in SETS.items():
    te, pa = fit_predict(g, cols)
    te, pb = fit_predict(g, cols + EXTRA)
    d, ci, r2 = paired(g, pa, pb, te)
    y = D.loc[te, 'pts'].values; r2a = 1 - ((y - pa) ** 2).mean() / ((y - y.mean()) ** 2).mean()
    print(f'  {g:3s}  R² A {r2a:.4f} → B {r2:.4f}   ΔMSE {d:+.4f} ± {ci:.4f}')

print('\n(2) fallback: model fitted with odds, evaluated when the match context comes from… (MSE of points; lower = better)')
d3 = D['diff'].fillna(3).round().clip(1, 5).astype(int)
SRC = {
    'real odds':          (F.wp, F.owp, F.dp),
    'own model':          (D.own_win, D.own_opp, D.own_draw),
    'own × overround':    (D.own_win * 1.0811, D.own_opp * 1.0811, D.own_draw * 1.0811),
    'app table fallback': (d3.map(WP_BY_DIFF), d3.map(OWP_BY_DIFF), pd.Series(DP_DEFAULT, index=D.index)),
}
for g, cols in SETS.items():
    out = {}
    for name, (w, o, dr) in SRC.items():
        te, p = fit_predict(g, cols, swap(F, w.values, o.values, dr.values))
        out[name] = ((D.loc[te, 'pts'].values - p) ** 2).mean()
    te, pt = fit_predict(g, cols, swap(F, SRC['app table fallback'][0].values, SRC['app table fallback'][1].values, SRC['app table fallback'][2].values))
    te, po = fit_predict(g, cols, swap(F, D.own_win.values, D.own_opp.values, D.own_draw.values))
    d, ci, _ = paired(g, pt, po, te)
    print(f'  {g:3s}  ' + '  '.join(f'{k} {v:.4f}' for k, v in out.items()) + f'   own vs table: ΔMSE {d:+.4f} ± {ci:.4f}')
