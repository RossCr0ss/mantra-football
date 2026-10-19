"""Own match-strength model vs bookmaker odds vs league-table difficulty (docs/scoring-research.md §Match difficulty).

  python match_model.py     # data/pts.pkl → data/match_model.pkl + a report on stdout

Builds, strictly point-in-time, for each of the 3,138 matches
  * Elo (goal-difference aware, home advantage, regression to the mean between seasons)
  * xG form: exponentially weighted xG for / against of both teams (team xG = sum of the players' xG) → Poisson λ for/against
  * table features (position, points per game) = what the app's fallback difficulty uses
and evaluates 1X2 probabilities (log loss, RPS) walk-forward (train on everything before the month, predict the month):
  odds-only | table-only | own-only | odds + own, plus clean-sheet / goals-scored calibration.
"""
import os, pickle, warnings
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss

warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__))
df, mt = pickle.load(open(os.path.join(HERE, 'data', 'pts.pkl'), 'rb'))
mt = mt.sort_values(['date', 'match_id']).reset_index(drop=True)
mt['date'] = pd.to_datetime(mt['date'], utc=True)

# ---- team xG per match (sum over players who played) ----
pl = df[df.played]
txg = pl.groupby(['match_id', 'team'])['xg'].agg(['sum', 'count', lambda s: s.notna().mean()]).reset_index()
txg.columns = ['match_id', 'team', 'xg', 'n', 'cov']
# players without a shot have xG = NaN (= 0): the sum is the team xG (mean 2.77 per match, all matches)
xg_of = {(r.match_id, r.team): r.xg for r in txg.itertuples()}
mt['hxg'] = [xg_of.get((m, h), np.nan) for m, h in zip(mt.match_id, mt.h)]
mt['axg'] = [xg_of.get((m, a), np.nan) for m, a in zip(mt.match_id, mt.a)]
print('matches with team xG:', mt.hxg.notna().mean().round(3))

# ---- sequential point-in-time features ----
K, HOME_ELO, REG = 18.0, 55.0, 0.7          # Elo step, home advantage, season-start shrink factor
HL = 8.0                                     # xG-form half-life in matches
alpha = 1 - 0.5 ** (1 / HL)
elo, lg_prev = {}, {}
elo_f = {}                                   # season-fresh Elo: only the current season's results (all the app has)
att, dfn, nobs = {}, {}, {}                  # ewma xG for / against per (league, team), venue-agnostic
league_xg = {}                               # running league mean xG per team per match
pts_acc, gp_acc = {}, {}
rows = []
cur_season = {}
for r in mt.itertuples():
    lg = r.league
    for t in (r.h, r.a):
        k = (lg, t)
        if cur_season.get(k) != r.season:     # new season for this team: regress Elo to the league mean
            if k in elo:
                elo[k] = 1500 + REG * (elo[k] - 1500)
                pts_acc[k] = 0.0; gp_acc[k] = 0
                nobs[k] = min(nobs.get(k, 0), 6)    # keep the xG form but trust it less
            cur_season[k] = r.season
    kh, ka = (lg, r.h), (lg, r.a)
    eh, ea = elo.get(kh, 1500.0), elo.get(ka, 1500.0)
    mu = league_xg.get(lg, (1.35, 0))[0]
    def form(k):
        n = nobs.get(k, 0)
        a_, d_ = att.get(k, mu), dfn.get(k, mu)
        w = min(1.0, n / 6.0)                 # shrink towards league mean while the sample is short
        return mu + w * (a_ - mu), mu + w * (d_ - mu), n
    ha, hd, hn = form(kh); aa, ad, an = form(ka)
    fh, fa = elo_f.get((lg, r.season, r.h), 1500.0), elo_f.get((lg, r.season, r.a), 1500.0)
    rows.append(dict(match_id=r.match_id, elo_fresh_diff=fh - fa, elo_h=eh, elo_a=ea, elo_diff=eh - ea,
                     xgf_h=ha, xga_h=hd, xgf_a=aa, xga_a=ad, n_h=hn, n_a=an, mu=mu,
                     ppg_h=(pts_acc.get(kh, 0) / gp_acc[kh]) if gp_acc.get(kh) else np.nan,
                     ppg_a=(pts_acc.get(ka, 0) / gp_acc[ka]) if gp_acc.get(ka) else np.nan))
    # ---- update after the match ----
    gd = r.hs - r.as_
    exp_h = 1 / (1 + 10 ** (-(eh - ea + HOME_ELO) / 400))
    s_h = 1.0 if gd > 0 else 0.5 if gd == 0 else 0.0
    mult = 1.0 if abs(gd) <= 1 else (1.5 if abs(gd) == 2 else (11 + abs(gd)) / 8)
    elo[kh] = eh + K * mult * (s_h - exp_h); elo[ka] = ea - K * mult * (s_h - exp_h)
    exp_f = 1 / (1 + 10 ** (-(fh - fa + HOME_ELO) / 400))
    elo_f[(lg, r.season, r.h)] = fh + K * mult * (s_h - exp_f); elo_f[(lg, r.season, r.a)] = fa - K * mult * (s_h - exp_f)
    for k, p in ((kh, 3 if gd > 0 else 1 if gd == 0 else 0), (ka, 3 if gd < 0 else 1 if gd == 0 else 0)):
        pts_acc[k] = pts_acc.get(k, 0) + p; gp_acc[k] = gp_acc.get(k, 0) + 1
    # xG form uses xG when known, else goals (noisier, but keeps the series going)
    hx = r.hxg if r.hxg == r.hxg else float(r.hs); ax = r.axg if r.axg == r.axg else float(r.as_)
    for k, f, a_ in ((kh, hx, ax), (ka, ax, hx)):
        if k in att:
            att[k] += alpha * (f - att[k]); dfn[k] += alpha * (a_ - dfn[k])
        else:
            att[k], dfn[k] = f, a_
        nobs[k] = nobs.get(k, 0) + 1
    m_, c_ = league_xg.get(lg, (1.35, 0))
    league_xg[lg] = (m_ + (hx - m_) / min(c_ + 1, 400), c_ + 1)
    league_xg[lg] = (league_xg[lg][0] + (ax - league_xg[lg][0]) / min(c_ + 1, 400), c_ + 2)

F = mt.merge(pd.DataFrame(rows), on='match_id')
# Poisson-style expected goals from form
F['lam_h'] = np.clip((F.xgf_h + F.xga_a) / 2 * 1.10, 0.3, 4)      # home boost on top of the mean
F['lam_a'] = np.clip((F.xgf_a + F.xga_h) / 2 * 0.92, 0.2, 4)
F['lam_diff'] = F.lam_h - F.lam_a
F['lam_tot'] = F.lam_h + F.lam_a
# bookmaker, de-vigged
inv = 1 / F[['oh', 'od', 'oa']]
F['has_odds'] = inv.notna().all(axis=1)
pn = inv.div(inv.sum(axis=1), axis=0)
F['p_h'], F['p_d'], F['p_a'] = pn.oh, pn.od, pn.oa
F['o_lr'] = np.log(F.p_h / F.p_a); F['o_ld'] = np.log(F.p_d)
F['y'] = np.where(F.hs > F.as_, 0, np.where(F.hs == F.as_, 1, 2))
# table position / difficulty as the app computes it (from features)
feat = pickle.load(open(os.path.join(HERE, 'data', 'feat.pkl'), 'rb'))
pos = feat[feat.is_home == True].drop_duplicates('match_id').set_index('match_id')[['my_pos', 'opp_pos', 'n_teams']]
F = F.merge(pos.rename(columns={'my_pos': 'pos_h', 'opp_pos': 'pos_a'}), left_on='match_id', right_index=True, how='left')
F['pos_diff'] = (F.pos_a - F.pos_h) / F.n_teams
F['ppg_diff'] = (F.ppg_h - F.ppg_a).fillna(0)
F['elo_n'] = np.minimum(F.n_h, F.n_a)
F.to_pickle(os.path.join(HERE, 'data', 'match_model.pkl'))

# ---- walk-forward evaluation ----
FEATS = {
    'table (position+ppg)': ['pos_diff', 'ppg_diff'],
    'elo':                  ['elo_diff'],
    'elo (season only)':    ['elo_fresh_diff'],
    'xG form':              ['lam_diff', 'lam_tot'],
    'own (elo+xG form)':    ['elo_diff', 'lam_diff', 'lam_tot'],
    'odds':                 ['o_lr', 'o_ld'],
    'odds + elo':           ['o_lr', 'o_ld', 'elo_diff'],
    'odds + xG form':       ['o_lr', 'o_ld', 'lam_diff', 'lam_tot'],
    'odds + own':           ['o_lr', 'o_ld', 'elo_diff', 'lam_diff', 'lam_tot'],
}
F['month'] = F.date.dt.strftime('%Y-%m')
months = sorted(m for m in F.month.unique() if m >= '2025-10')
E = F[F.has_odds].copy()     # evaluate on matches that have odds so that every model sees the same matches
res = {k: np.full((len(E), 3), np.nan) for k in FEATS}
idx = {i: n for n, i in enumerate(E.index)}
for mth in months:
    tr = E[(E.month < mth) & (E.date >= '2024-10-01')]
    te = E[E.month == mth]
    if len(te) == 0 or len(tr) < 300:
        continue
    for name, cols in FEATS.items():
        mu_, sd_ = tr[cols].mean(), tr[cols].std().replace(0, 1)
        m = LogisticRegression(C=1.0, max_iter=1000).fit((tr[cols] - mu_) / sd_, tr.y)
        p = m.predict_proba((te[cols] - mu_) / sd_)
        for i, row in zip(te.index, p):
            res[name][idx[i]] = row
ok = ~np.isnan(res['odds'][:, 0]); Y = E.y.values[ok]
raw_odds = E.loc[ok, ['p_h', 'p_d', 'p_a']].values


def rps(p, y):
    cum_p = np.cumsum(p, axis=1)[:, :2]; cum_y = np.cumsum(np.eye(3)[y], axis=1)[:, :2]
    return ((cum_p - cum_y) ** 2).sum(axis=1) / 2


print(f'\nWalk-forward 1X2, {ok.sum()} matches with odds from 2025-10 on (log loss, lower = better; RPS)')
print(f'  {"raw de-vigged odds":24s} logloss {log_loss(Y, raw_odds):.4f}  RPS {rps(raw_odds, Y).mean():.4f}')
base_ll = log_loss(Y, np.tile(np.bincount(Y) / len(Y), (len(Y), 1)))
print(f'  {"climatology":24s} logloss {base_ll:.4f}')
boot = np.random.default_rng(1)
ll_odds = -np.log(np.clip(res['odds'][ok][np.arange(ok.sum()), Y], 1e-9, 1))
for name in FEATS:
    p = res[name][ok]
    ll = -np.log(np.clip(p[np.arange(ok.sum()), Y], 1e-9, 1))
    d = ll - ll_odds
    print(f'  {name:24s} logloss {ll.mean():.4f}  RPS {rps(p, Y).mean():.4f}   vs odds-LR: {d.mean():+.4f} ± {1.96 * d.std() / np.sqrt(len(d)):.4f}')

# matches WITHOUT odds (what the fallback covers): table vs own
nod = F[~F.has_odds & (F.month >= '2025-10')]
print(f'\n{len(nod)} matches without odds from 2025-10 (fallback situation)')
trn = F[(F.month < '2026-03') & (F.date >= '2024-10-01') & F.has_odds]
ten = F[(F.month >= '2026-03')]
for name in ['table (position+ppg)', 'own (elo+xG form)']:
    cols = FEATS[name]
    mu_, sd_ = trn[cols].mean(), trn[cols].std().replace(0, 1)
    m = LogisticRegression(C=1.0, max_iter=1000).fit((trn[cols] - mu_) / sd_, trn.y)
    p = m.predict_proba((ten[cols] - mu_) / sd_)
    print(f'  {name:24s} logloss {log_loss(ten.y, p):.4f} on {len(ten)} matches from 2026-03 (all, odds or not)')
print('  (table here = position + points per game; the app\'s fallback is the coarser 5-step "difficulty")')

# ---- goals: does the own model say anything about the SCORELINE beyond the 1X2 odds? ----
G = E[E.month >= '2025-10'].copy()
G['tot'] = G.hs + G.as_
print('\nTotal goals vs odds-implied features / own λ (OLS corr):')
G['o_abs'] = np.abs(G.o_lr)
for c in ['o_abs', 'lam_tot', 'elo_diff']:
    print(f'  corr(total goals, {c}) = {np.corrcoef(G.tot, G[c])[0, 1]:+.3f}')
print(f'  corr(total goals, own λ_total) partial on |odds log-ratio|: ', end='')
X = np.c_[np.ones(len(G)), G.o_abs]; r1 = G.tot - X @ np.linalg.lstsq(X, G.tot, rcond=None)[0]
r2 = G.lam_tot - X @ np.linalg.lstsq(X, G.lam_tot, rcond=None)[0]
print(f'{np.corrcoef(r1, r2)[0, 1]:+.3f}')
