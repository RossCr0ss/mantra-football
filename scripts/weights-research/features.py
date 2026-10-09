"""Step 3 — point-in-time features for every (match, player) row; uses only data strictly before the match.

  python features.py      # data/pts.pkl → data/feat.pkl

Per row: season-to-date totals (c_*), last season's totals (p_*), the player's recent squad history (r_*),
league-table position / form of both teams (before the match), 1X2 odds. Rows of players who were in the team's
squads of the last 10 matches but not in this one ("absent": injured / rotated out) are added so that start
probability can be modelled.
"""
import sys, os, pickle, collections
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
df, mt = pickle.load(open(os.path.join(HERE, 'data', 'pts.pkl'), 'rb'))
mt = mt.sort_values(['date', 'match_id']).reset_index(drop=True)
SEASONS = ['2024/2025', '2025/2026', '2026/2027']
SUM_STATS = ['goals', 'assists', 'xg', 'xa', 'sot', 'shots', 'kp', 'tackles', 'inter', 'clear', 'blocks', 'aerials',
             'dribbles', 'dribbled_past', 'fouls', 'was_fouled', 'recov', 'bcc', 'bcm', 'saves', 'gc_stat', 'gprev', 'claims',
             'touches_box', 'def_act', 'duel_won', 'duel_lost']

# ---------------- table position before each match + team form ----------------
table_pos = {}   # (match_id, team) -> position before the match
n_teams = {}
team_hist = collections.defaultdict(list)   # (league, season, team) -> list of dict(date, match_id, gf, ga, pts)
for (lg, s), g in mt.groupby(['league', 'season']):
    pts = collections.defaultdict(int); gd = collections.defaultdict(int); gf_ = collections.defaultdict(int)
    teams = sorted(set(g.h) | set(g.a))
    n_teams[(lg, s)] = len(teams)
    for _, r in g.iterrows():
        order = sorted(teams, key=lambda t: (-pts[t], -gd[t], -gf_[t], t))
        for i, t in enumerate(order):
            if t in (r.h, r.a):
                table_pos[(r.match_id, t)] = i + 1
        for t, f, a in ((r.h, r.hs, r.as_), (r.a, r.as_, r.hs)):
            p = 3 if f > a else 1 if f == a else 0
            pts[t] += p; gd[t] += f - a; gf_[t] += f
            team_hist[(lg, s, t)].append(dict(date=r.date, mid=r.match_id, gf=f, ga=a, p=p))

# team form before each match: last 5 results in same league-season (and goals stats)
team_form = {}
for (lg, s, t), h in team_hist.items():
    for i, m in enumerate(h):
        prev = h[max(0, i - 5):i]
        prev8 = h[max(0, i - 8):i]
        team_form[(m['mid'], t)] = dict(
            tf_n=len(prev), tf_w=sum(x['p'] == 3 for x in prev), tf_d=sum(x['p'] == 1 for x in prev), tf_l=sum(x['p'] == 0 for x in prev),
            tf_cs=(sum(x['ga'] == 0 for x in prev) / len(prev)) if prev else np.nan,
            tf_gf=(np.mean([x['gf'] for x in prev8]) if prev8 else np.nan), tf_ga=(np.mean([x['ga'] for x in prev8]) if prev8 else np.nan),
            tf_idx=i)

# ---------------- player cumulative history ----------------
df = df.sort_values(['date', 'match_id']).reset_index(drop=True)

# ---------------- add "absent" rows: players of the team seen in its last 10 squads of this season but not in this one ----------------
info = df.drop_duplicates('player_id').set_index('player_id')[['name', 'group', 'nat', 'nat_known', 'gb', 'csb', 'gk', 'usual']]
present_by = df.groupby(['match_id', 'team'])['player_id'].agg(set).to_dict()
mt_idx = {}
absent_rows = []
for (lg, s), g in mt.groupby(['league', 'season']):
    last_seen = collections.defaultdict(dict)        # team -> {pid: idx}
    where = {}                                       # pid -> team currently tracked
    tcount = collections.defaultdict(int)
    for _, r in g.sort_values(['date', 'match_id']).iterrows():
        for t, opp, is_home in ((r.h, r.a, True), (r.a, r.h, False)):
            i = tcount[t]; tcount[t] += 1
            present = present_by.get((r.match_id, t), set())
            for pid, idx in list(last_seen[t].items()):
                if pid in present or i - idx > 10:
                    continue
                inf = info.loc[pid]
                absent_rows.append(dict(match_id=r.match_id, player_id=pid, name=inf['name'], team=t, is_home=is_home, started=False,
                                        posId=np.nan, usual=inf['usual'], gk=inf['gk'], min=0.0, played=False, absent=True,
                                        nat=inf['nat'], nat_known=inf['nat_known'], group=inf['group'], gb=inf['gb'], csb=inf['csb'],
                                        date=r.date, league=lg, season=s, round=r['round'], h=r.h, a=r.a, hs=r.hs, as_=r.as_,
                                        oh=r.oh, od=r.od, oa=r.oa, opp=opp, gf=(r.hs if is_home else r.as_), ga=(r.as_ if is_home else r.hs)))
            for pid in present:
                old = where.get(pid)
                if old is not None and old != t and pid in last_seen[old]:
                    del last_seen[old][pid]
                last_seen[t][pid] = i; where[pid] = t
df['absent'] = False
ab = pd.DataFrame(absent_rows)
print('absent rows added', len(ab))
df = pd.concat([df, ab], ignore_index=True)
df = df.sort_values(['date', 'match_id', 'team', 'player_id']).reset_index(drop=True)
played = df['played'].values
# season totals per (player, league, season) for prior-season lookup
agg_cols = ['min'] + SUM_STATS
tot = df[df.played].copy()
tot['cs_n'] = tot['cs_flag'].astype(int)
tot['rated'] = tot['rating'].notna().astype(int)
tot['rating_sum'] = tot['rating'].fillna(0)
tot['apps'] = 1
tot['pts_sum'] = tot['pts']
prior_tab = tot.groupby(['player_id', 'league', 'season'])[['apps', 'rated', 'rating_sum', 'cs_n'] + agg_cols].sum()

cum_keys = ['apps', 'rated', 'rating_sum', 'cs_n', 'min'] + SUM_STATS
rows = []
cur = collections.defaultdict(lambda: collections.defaultdict(float))     # (player, league, season) -> running totals
recent = collections.defaultdict(list)    # (player, league, season) -> list of (team_idx, started, min, rating, pts) for appearances in squad
last_match_date = {}

N = len(df)
out = []
cols = df.columns.tolist()
ci = {c: j for j, c in enumerate(cols)}
vals = df.values
for k in range(N):
    row = vals[k]
    pid = row[ci['player_id']]; lg = row[ci['league']]; s = row[ci['season']]; mid = row[ci['match_id']]
    team = row[ci['team']]
    key = (pid, lg, s)
    c = cur[key]
    d = dict(match_id=mid, player_id=pid)
    for ck in cum_keys:
        d['c_' + ck] = c.get(ck, 0.0)
    # prior season totals (same league)
    si = SEASONS.index(s)
    if si > 0:
        pk = (pid, lg, SEASONS[si - 1])
        if pk in prior_tab.index:
            pr = prior_tab.loc[pk]
            for ck in cum_keys:
                d['p_' + ck] = pr[ck]
        else:
            for ck in cum_keys:
                d['p_' + ck] = np.nan
    else:
        for ck in cum_keys:
            d['p_' + ck] = np.nan
    # recent team-match history of this player (squad appearances in the last 5 team matches)
    tf = team_form.get((mid, team), {})
    tidx = tf.get('tf_idx', 0)
    rec = recent[key]
    last5 = [x for x in rec if tidx - 5 <= x[0] < tidx]
    d['r_starts'] = sum(x[1] for x in last5)
    d['r_min'] = sum(x[2] for x in last5)
    d['r_squad'] = sum(1 for x in last5 if not x[5])      # times he was in the matchday squad (starter or sub)
    d['r_absent'] = sum(1 for x in last5 if x[5])
    rr = [x[3] for x in rec if x[3] is not None and x[2] > 30][-5:]
    d['r_rating_n'] = len(rr)
    d['r_rating'] = float(np.mean(rr)) if rr else np.nan
    rr3 = [x[3] for x in rec if x[3] is not None and x[2] > 30][-3:]
    d['r3_rating'] = float(np.mean(rr3)) if rr3 else np.nan
    pp = [x[4] for x in rec if x[4] is not None][-5:]
    d['r_pts'] = float(np.mean(pp)) if pp else np.nan
    d['r_tidx_gap'] = (tidx - rec[-1][0]) if rec else np.nan
    # last-5 minutes when appearing
    d['r_min_when_played'] = (np.mean([x[2] for x in last5 if x[2] > 0]) if any(x[2] > 0 for x in last5) else np.nan)
    d['r_min10'] = sum(x[2] for x in rec if tidx - 10 <= x[0] < tidx)
    d['r_starts10'] = sum(x[1] for x in rec if tidx - 10 <= x[0] < tidx)
    out.append(d)
    # update history AFTER recording features (strictly point-in-time)
    mins = row[ci['min']]
    if mins and mins > 0:
        c['apps'] += 1
        rt = row[ci['rating']]
        if rt == rt and rt is not None:
            c['rated'] += 1; c['rating_sum'] += rt
        c['cs_n'] += int(bool(row[ci['cs_flag']]))
        c['min'] += mins
        for sk in SUM_STATS:
            v = row[ci[sk]]
            if v == v and v is not None:
                c[sk] += v
    pts_v = row[ci['pts']]
    rec.append((tidx, int(bool(row[ci['started']])), float(mins) if mins == mins else 0.0,
                (None if (row[ci['rating']] != row[ci['rating']] or row[ci['rating']] is None) else float(row[ci['rating']])),
                (None if pts_v != pts_v else float(pts_v)), bool(row[ci['absent']])))
F = pd.DataFrame(out)
df = df.merge(F, on=['match_id', 'player_id'])

# match context
df['opp_pos'] = [table_pos.get((m, o), np.nan) for m, o in zip(df.match_id, df.opp)]
df['my_pos'] = [table_pos.get((m, t), np.nan) for m, t in zip(df.match_id, df.team)]
df['n_teams'] = [n_teams[(l, s)] for l, s in zip(df.league, df.season)]
df['diff'] = np.clip(np.ceil(df.opp_pos / df.n_teams * 5), 1, 5)
tfm = pd.DataFrame([dict(match_id=m, team=t, **v) for (m, t), v in team_form.items()])
df = df.merge(tfm, on=['match_id', 'team'], how='left')
oppf = tfm.rename(columns={c: 'opp_' + c for c in tfm.columns if c not in ('match_id', 'team')}).rename(columns={'team': 'opp'})
df = df.merge(oppf, on=['match_id', 'opp'], how='left')
df['team_odds'] = np.where(df.is_home, df.oh, df.oa)
df['opp_odds'] = np.where(df.is_home, df.oa, df.oh)
df['win_prob'] = 1.0 / df.team_odds
df['draw_prob'] = 1.0 / df.od
df['opp_win_prob'] = 1.0 / df.opp_odds
pickle.dump(df, open(os.path.join(HERE, 'data', 'feat.pkl'), 'wb'))
print(df.shape)
print(df[['diff', 'win_prob', 'tf_cs', 'r_starts', 'c_apps', 'p_apps', 'r_rating']].describe().T)
