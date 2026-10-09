"""Step 4 — fit the weights of calcScore() (apps/web/src/lib/tourScoring.ts, SCORE_WEIGHTS).

  python fit_weights.py holdout   # fit on matches before HOLDOUT_FROM, report R² / AUC on the rest
  python fit_weights.py all       # fit on everything → the numbers to paste into SCORE_WEIGHTS

Two models (see docs/scoring-research.md):
* V  — expected Mantra points of a player who STARTS: per position group, ridge regression with sign constraints
       (win prob ≥ 0, opponent win prob ≤ 0, stats ≥ 0) on rating + 1X2 odds + attacking per-match stats.
* P  — probability of starting: logistic regression on the share of his team's minutes he has played.
The features below must stay identical to calcScore()/estimateStartProb() — they are the same blends, same fallbacks.
Writes data/weights_<mode>.json, which sim/run_sim.sh accepts as a weights override.
"""
import json, os, sys
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import roc_auc_score

from common import DATA, avg_minutes, load_features, pm, season_rating

HOLDOUT_FROM = '2026-02-15'
ALPHA = 1000.0
# empirical average 1X2 probabilities by fixture difficulty (used by calcScore when odds are missing)
WP_BY_DIFF = {1: 0.244, 2: 0.348, 3: 0.411, 4: 0.448, 5: 0.503}
OWP_BY_DIFF = {1: 0.587, 2: 0.455, 3: 0.381, 4: 0.342, 5: 0.296}
DP_DEFAULT = 0.28
PRIOR_GAMES = 34

SETS = {   # regressors per group; n* = negated so that every coefficient can be constrained ≥ 0
    'GK':  ['sr', 'wp', 'nowp', 'dpp', 'dpn'],
    'DEF': ['sr', 'wp', 'nowp', 'dpp', 'dpn', 'xgb', 'apg', 'kp', 'bcc', 'csb_wp', 'csb_nowp'],
    'MID': ['sr', 'wp', 'nowp', 'dpp', 'dpn', 'xgb', 'apg', 'kp', 'bcc'],
    'FWD': ['sr', 'wp', 'nowp', 'dpp', 'dpn', 'xgb', 'apg', 'kp', 'bcc'],
}


def feats(df):
    F = pd.DataFrame(index=df.index)
    F['sr'] = season_rating(df)
    d = df['diff'].fillna(3).round().clip(1, 5).astype(int)
    F['wp'] = df['win_prob'].fillna(d.map(WP_BY_DIFF))
    F['owp'] = df['opp_win_prob'].fillna(d.map(OWP_BY_DIFF))
    F['dp'] = df['draw_prob'].fillna(DP_DEFAULT)
    gpg = pm(df, 'goals')
    xg = np.where((df['c_xg'].notna() | df['p_xg'].notna()).values, pm(df, 'xg'), gpg)   # xG, else goals per match
    F['xgb'] = xg * df['gb'].values
    F['apg'] = pm(df, 'assists'); F['kp'] = pm(df, 'kp'); F['bcc'] = pm(df, 'bcc')
    F['csb_wp'] = df['csb'].values * F['wp']; F['csb_owp'] = df['csb'].values * F['owp']
    F['nowp'] = -F['owp']; F['dpp'] = F['dp']; F['dpn'] = -F['dp']; F['csb_nowp'] = -F['csb_owp']
    # start-probability inputs: share of the team's minutes (this season, blended with last season while young)
    tm = df['tf_idx'].values.astype(float)           # team matches played so far
    tm = np.maximum(tm, df['c_apps'].values)         # (rounds restart in playoffs)
    share_cur = np.where(tm > 0, np.minimum(1, df['c_min'].values / (np.maximum(tm, 1) * 90)), np.nan)
    share_pri = np.where(df['p_min'].notna(), np.minimum(1, df['p_min'].values / (PRIOR_GAMES * 90)), np.nan)
    w = np.minimum(1, tm / 6.0)
    F['share'] = np.where(np.isnan(share_cur), np.where(np.isnan(share_pri), 0.0, share_pri),
                          np.where(np.isnan(share_pri), share_cur, share_cur * w + share_pri * (1 - w)))
    F['avgmin'] = np.nan_to_num(avg_minutes(df), nan=0.0) / 90.0
    return F


def fit_v(df, F, train, test):
    st = df.started & df.pts.notna()
    out, metrics = {}, {}
    for g, cols in SETS.items():
        gm = df.group == g
        tr, te = train & gm & st, test & gm & st
        X = F.loc[tr, cols]; mu, sd = X.mean(), X.std().replace(0, 1)
        m = Ridge(alpha=ALPHA, positive=True).fit((X - mu) / sd, df.loc[tr, 'pts'])
        raw = pd.Series(m.coef_ / sd.values, index=cols)
        icpt = m.intercept_ - (raw * mu).sum()
        out[g] = dict(intercept=icpt, rating=raw.get('sr', 0), winProb=raw.get('wp', 0), oppWinProb=-raw.get('nowp', 0),
                      drawProb=raw.get('dpp', 0) - raw.get('dpn', 0), xgGoalBonus=raw.get('xgb', 0), assist=raw.get('apg', 0),
                      chanceCreated=raw.get('kp', 0), bigChance=raw.get('bcc', 0), csWin=raw.get('csb_wp', 0), csOppWin=-raw.get('csb_nowp', 0))
        out[g] = {k: round(float(v), 3) for k, v in out[g].items()}
        if te.sum():
            pred = m.predict((F.loc[te, cols] - mu) / sd); y = df.loc[te, 'pts']
            r2 = 1 - ((y - pred) ** 2).mean() / ((y - df.loc[tr, 'pts'].mean()) ** 2).mean()
            metrics[g] = dict(n_train=int(tr.sum()), n_test=int(te.sum()), R2=round(float(r2), 4), corr=round(float(np.corrcoef(pred, y)[0, 1]), 4))
    return out, metrics


def fit_p(df, F, train, test):
    cand = (df.c_apps + df.p_apps.fillna(0)) > 0
    cols = ['share', 'avgmin']
    y = df.started.astype(int)
    X = F.loc[train & cand, cols]; mu, sd = X.mean(), X.std()
    m = LogisticRegression(C=10, max_iter=2000).fit((X - mu) / sd, y[train & cand])
    b = m.coef_[0] / sd.values; a = m.intercept_[0] - (b * mu.values).sum()
    metrics = {}
    if (test & cand).sum():
        p = m.predict_proba((F.loc[test & cand, cols] - mu) / sd)[:, 1]
        metrics = dict(AUC=round(float(roc_auc_score(y[test & cand], p)), 4), n_test=int((test & cand).sum()))
    return dict(intercept=round(float(a), 2), share=round(float(b[0]), 2), avgMinutes=round(float(b[1]), 2)), metrics


def main(mode):
    df = load_features()
    F = feats(df)
    holdout = df.date < HOLDOUT_FROM
    train = holdout if mode == 'holdout' else pd.Series(True, index=df.index)
    test = ~holdout & (df.season != '2024/2025')
    v, vm = fit_v(df, F, train, test)
    p, pmx = fit_p(df, F, train, test)
    print(f'--- {mode}: start probability', p, pmx)
    for g in v:
        print(f'--- {g}', v[g], vm.get(g, ''))
    json.dump({'startProb': p, 'byGroup': v}, open(os.path.join(DATA, f'weights_{mode}.json'), 'w'), indent=1)
    print(f'wrote data/weights_{mode}.json — paste the numbers into SCORE_WEIGHTS (tourScoring.ts) and update docs/scoring.md + the weights test')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'holdout')
