"""Start probability: how much does a better model of "will he start" gain? (docs/scoring-research.md §Start probability)

  python start_prob.py     # data/feat.pkl → AUC / log loss / Brier on the hold-out period for several start-probability models
Models: A minutes share (the current estimateStartProb) | B suggested % of the Team page (last-5 starts + minutes)
        | C = 0.6 B + 0.4 A (what calcScore does with a suggested availability) | D logistic on A + last-5 features
        | E logistic on A + last-5 features from what the production form feed has (starts, minutes only).
"""
import numpy as np, pandas as pd, warnings
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, log_loss, brier_score_loss
from common import load_features
from fit_weights import feats, HOLDOUT_FROM
warnings.filterwarnings('ignore')

df = load_features(); F = feats(df)
cand = ((df.c_apps + df.p_apps.fillna(0)) > 0) & (df.season != '2024/2025')
y = df.started.astype(int)
tr = cand & (df.date < HOLDOUT_FROM); te = cand & (df.date >= HOLDOUT_FROM)

gk = (df.group == 'GK').astype(float)
F['A'] = 1 / (1 + np.exp(-(-2.46 + 3.67 * F.share + 0.89 * F.avgmin)))
has5 = df.tf_idx >= 1
sugg = np.round(((df.r_starts / 5) * 0.5 + (df.r_min / 450) * 0.5) * 100 / 5) * 5 / 100
F['B'] = np.where(has5, sugg, np.nan)
F['C'] = np.where(has5, 0.6 * F.B + 0.4 * F.A, F.A)
F['B'] = F.B.fillna(F.A)
n5 = np.minimum(df.tf_idx, 5).clip(lower=1)
F['rs'] = df.r_starts / n5; F['rm'] = df.r_min / (n5 * 90)
F['rsq'] = df.r_squad / n5; F['rab'] = df.r_absent / n5
F['rs10'] = df.r_starts10 / np.minimum(df.tf_idx, 10).clip(lower=1)
F['gap'] = df.r_tidx_gap.fillna(10).clip(upper=10) / 10
F['gk'] = gk
F['rs_gk'] = F.rs * gk
F['logitA'] = np.log(F.A / (1 - F.A))


def fit(cols, C=1.0):
    X = F[cols]; mu, sd = X[tr].mean(), X[tr].std().replace(0, 1)
    m = LogisticRegression(C=C, max_iter=2000).fit((X[tr] - mu) / sd, y[tr])
    return m.predict_proba((X[te] - mu) / sd)[:, 1], m


def row(name, p):
    yt = y[te].values
    print(f'  {name:46s} AUC {roc_auc_score(yt, p):.4f}  logloss {log_loss(yt, np.clip(p, 1e-4, 1 - 1e-4)):.4f}  Brier {brier_score_loss(yt, p):.4f}')


print(f'hold-out rows: {int(te.sum())}, started share {y[te].mean():.3f}')
row('A minutes share (current model)', F.A[te].values)
row('B suggested % (last 5)', F.B[te].values)
row('C 0.6 B + 0.4 A (current with suggestion)', F.C[te].values)
pE, mE = fit(['logitA', 'rs', 'rm']); row('E logistic: A + last-5 starts/minutes', pE)
pD, mD = fit(['logitA', 'rs', 'rm', 'rsq', 'rab', 'rs10', 'gap']); row('D logistic: E + squad/absence + last-10 starts', pD)
pG, mG = fit(['logitA', 'rs', 'rm', 'rs10', 'gk', 'rs_gk']); row('G logistic: E + last-10 starts + GK terms', pG)
print('\nlogistic E coefficients (standardised):', dict(zip(['logitA', 'rs', 'rm'], mE.coef_[0].round(2))))
print('logistic D coefficients (standardised):', dict(zip(['logitA', 'rs', 'rm', 'rsq', 'rab', 'rs10', 'gap'], mD.coef_[0].round(2))))
# by position group and by round phase
for g in ['GK', 'DEF', 'MID', 'FWD']:
    m = te & (df.group == g)
    yt = y[m].values
    print(f'  {g}: AUC A {roc_auc_score(yt, F.A[m]):.3f}  C {roc_auc_score(yt, F.C[m]):.3f}  E {roc_auc_score(yt, pd.Series(pE, index=te[te].index)[m[te]].values if False else mE.predict_proba(((F.loc[m, ["logitA","rs","rm"]] - F.loc[tr, ["logitA","rs","rm"]].mean()) / F.loc[tr, ["logitA","rs","rm"]].std()))[:,1]):.3f}')

# --- what production can do: it only has the suggested % (a mix of starts and minutes), not the two parts ---
F['has5'] = has5.astype(float)
F['Bc'] = F.B * F.has5
pH, mH = fit(['logitA', 'Bc', 'has5']); row('H logistic on [A, suggested %]', pH)
print('   H coefficients (standardised):', dict(zip(['logitA', 'Bc', 'has5'], mH.coef_[0].round(2))))
for w in (0.4, 0.5, 0.6, 0.7):
    row(f'   linear blend w={w} (w·B + (1-w)·A)', (np.where(has5, w * F.B + (1 - w) * F.A, F.A))[te.values])
# sim-style quantity: expected points lost if the start probability is used as a multiplier — calibration by decile for C and H
for name, p in (('C', F.C[te].values), ('H', pH)):
    q = pd.DataFrame(dict(p=p, y=y[te].values)); q['b'] = pd.qcut(q.p, 10, duplicates='drop')
    print(name, 'calibration deciles (pred → real):', ' '.join(f'{g.p.mean():.2f}→{g.y.mean():.2f}' for _, g in q.groupby('b')))

print('\n--- suggestion formula: share of starts a in B\' = a·starts + (1-a)·minutes, then C\' = 0.5 B\' + 0.5 A')
for a in (0.0, 0.2, 0.35, 0.5, 0.65):
    Bp = np.where(has5, np.round((a * F.rs + (1 - a) * F.rm) * 100 / 5) * 5 / 100, np.nan)
    Cp = np.where(has5, 0.5 * Bp + 0.5 * F.A, F.A)
    row(f'  a={a}', Cp[te.values])
