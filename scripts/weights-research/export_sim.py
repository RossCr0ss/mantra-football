"""Step 5 — export the evaluation rows (as PlayerAnalytics-like objects) and random 26-man squads for sim/run.test.ts.

  python export_sim.py        # data/feat.pkl → sim/work/rows.json, sim/work/squads.json

Only matches on/after HOLDOUT_FROM are used (fit the weights with `fit_weights.py holdout` for an unbiased comparison).
Squads: 3 GK + 23 outfield players drawn per position quota from the players of that matchday; 78 % "regulars"
(started ≥ 4 of his last 10 team matches), 22 % rotation/bench players. Scenario `known` leaves out players who were not
in the matchday squad at all (a manager knows who is injured); `blind` may contain them.
"""
import sys, os, json, math, random
import numpy as np, pandas as pd

from common import HERE, load_features

WORK = os.path.join(HERE, 'sim', 'work')
os.makedirs(WORK, exist_ok=True)
rng = random.Random(7)

df = load_features()
TEST_FROM = '2026-02-15'      # = HOLDOUT_FROM in fit_weights.py
ev = df[(df.date >= TEST_FROM) & (df.season != '2024/2025')].copy()
ev = ev[(ev.c_apps + ev.p_apps.fillna(0)) > 0]   # a manager would not own a player with zero history
print('eval rows', len(ev), 'absent', ev.absent.sum())


def nz(v):
    return None if (v is None or (isinstance(v, float) and math.isnan(v))) else float(v)


def stats_obj(r, pre):
    """PlayerSeasonStats-like totals (only what the production CDN pipeline actually fetches)."""
    g = lambda k: nz(r[pre + k])
    apps = g('apps')
    if apps is None:
        return None
    rated = g('rated') or 0
    return dict(
        rating=(g('rating_sum') / rated) if rated > 0 else None, matchesPlayed=apps, minutesPlayed=g('min'),
        goals=g('goals'), assists=g('assists'), cleanSheets=g('cs_n'), saves=g('saves'), goalsConceded=g('gc_stat'),
        tackles=g('tackles'), interceptions=g('inter'), clearances=g('clear'), blockedShots=g('blocks'), foulsCommitted=g('fouls'),
        expectedGoals=g('xg'), shots=g('sot'), chancesCreated=g('kp'), bigChancesCreated=g('bcc'), bigChancesMissed=g('bcm'),
    )


rows = []
for r in ev.to_dict('records'):
    cur = stats_obj(r, 'c_')
    pri = stats_obj(r, 'p_')
    n = int(r['tf_n']) if not math.isnan(r['tf_n']) else 0
    form = []
    if n > 0:
        w, d, l = int(r['tf_w']), int(r['tf_d']), int(r['tf_l'])
        cs = int(round((r['tf_cs'] if not math.isnan(r['tf_cs']) else 0) * n))
        res = ['W'] * w + ['D'] * d + ['L'] * l
        for i, x in enumerate(res):
            form.append(dict(matchId=str(i), date='2026-01-01', opponentName='x', opponentId=0, isHome=True, result=x,
                             goalsFor=1, goalsAgainst=0 if i < cs else 1, minutesPlayed=None, rating=None, goals=0, assists=0,
                             yellowCard=False, redCard=False, leagueId=int(r['league']), started=False))
    odds = None
    if not math.isnan(r['oh']):
        odds = dict(home=r['oh'], draw=r['od'], away=r['oa'])
    starts5 = r['r_starts']; min5 = r['r_min']
    sugg = int(round(((starts5 / 5) * 0.5 + (min5 / 450) * 0.5) * 100 / 5) * 5) if r['tf_idx'] >= 1 else None
    rows.append(dict(
        rid=len(rows), pid=int(r['player_id']), team=int(r['team']), league=int(r['league']), season=r['season'], round=str(r['round']),
        date=str(r['date']), mid=int(r['match_id']), nat=list(r['nat']), group=r['group'], absent=bool(r['absent']),
        analytics=cur, prior=pri, form=form, odds=odds,
        fixture=dict(difficulty=None if math.isnan(r['diff']) else int(r['diff']), isHome=bool(r['is_home']), round=str(int(r['tf_idx']) + 1),
                     oppId=int(r['opp'])),
        sugg=sugg,
        played=bool(r['played']), started=bool(r['started']), pts=nz(r['pts']), base=nz(r['base']),
        r_starts10=int(r['r_starts10']),
    ))
json.dump(rows, open(os.path.join(WORK, 'rows.json'), 'w'), separators=(',', ':'))
print('rows exported', len(rows))

# ---------------- squads ----------------
QUOTA = [('GK', 3), ('CB', 4), ('RB', 2), ('LB', 2), ('WB', 2), ('DM', 2), ('CM', 3), ('W', 2), ('AM', 2), ('FW', 2), ('ST', 2)]
by_round = {}
for r in rows:
    by_round.setdefault((r['league'], r['season'], r['round']), []).append(r)


def sample_squad(pool, include_absent):
    regs = [r for r in pool if r['r_starts10'] >= 4 and not r['absent']]
    others = [r for r in pool if r['r_starts10'] < 4 or r['absent']]
    if not include_absent:
        others = [r for r in others if not r['absent']]
    used = set(); chosen = []
    for pos, k in QUOTA:
        cand_r = [r for r in regs if r['nat'][0] == pos and r['rid'] not in used]
        cand_o = [r for r in others if r['nat'][0] == pos and r['rid'] not in used]
        for _ in range(k):
            src = cand_r if (rng.random() < 0.78 and cand_r) else (cand_o or cand_r)
            if not src:
                break
            x = src.pop(rng.randrange(len(src)))
            for lst in (cand_r, cand_o):
                if x in lst:
                    lst.remove(x)
            used.add(x['rid']); chosen.append(x['rid'])
    return chosen


squads = []
for key, pool in sorted(by_round.items()):
    if len(pool) < 100:
        continue
    for scen in ('known', 'blind'):
        for _ in range(12):
            s = sample_squad(pool, include_absent=(scen == 'blind'))
            if len(s) >= 24:
                squads.append(dict(key=list(key), scenario=scen, rids=s))
json.dump(squads, open(os.path.join(WORK, 'squads.json'), 'w'), separators=(',', ':'))
print('squads', len(squads), 'league-rounds', len(by_round))
