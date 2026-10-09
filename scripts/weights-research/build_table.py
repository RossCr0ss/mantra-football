"""Step 2 — turn the raw downloads into one (match × player) table with the ground-truth Mantra points.

  python build_table.py      # → data/pts.pkl

1. read data/m (+ data/odds) into a long table (one row per player in a matchday squad);
2. match FotMob players to the official Mantra positions (data/mantra_<league>.json) by name; unmatched players
   get the Mantra position that is most common among matched players who started in the same FotMob slot;
3. compute the Mantra points of every appearance from the official rules (https://mantrafootball.org/rules):
   FotMob rating (6.0 if played without a rating) + goal bonus by native position (penalty goal +2) + assist +1
   + earned penalty +1 + saved penalty +3 − conceded penalty 1 − missed penalty 2 − own goal 2 − yellow 0.5 / red 2 (GK 3)
   + GK saves (3–5: +0.5, 6+: +1) − 1 per goal conceded (GK) + clean sheet (≥60 min, none conceded while on the pitch).
"""
import collections, glob, json, os, pickle, re, unicodedata
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
LEAGUES = [47, 55, 87, 40]
GROUP = {'GK': 'GK', 'RB': 'DEF', 'CB': 'DEF', 'LB': 'DEF', 'WB': 'DEF', 'DM': 'MID', 'CM': 'MID', 'W': 'MID', 'AM': 'MID', 'FW': 'FWD', 'ST': 'FWD'}
STAT_KEEP = {
    'minutes_played': 'min', 'rating_title': 'rating_p', 'goals': 'goals', 'assists': 'assists',
    'expected_goals': 'xg', 'expected_assists': 'xa', 'total_shots': 'shots', 'ShotsOnTarget': 'sot',
    'chances_created': 'kp', 'matchstats.headers.tackles': 'tackles', 'interceptions': 'inter',
    'clearances': 'clear', 'shot_blocks': 'blocks', 'aerials_won': 'aerials', 'dribbles_succeeded': 'dribbles',
    'dribbled_past': 'dribbled_past', 'fouls': 'fouls', 'was_fouled': 'was_fouled', 'recoveries': 'recov',
    'touches': 'touches', 'touches_opp_box': 'touches_box', 'big_chance_created_team_title': 'bcc',
    'big_chance_missed_title': 'bcm', 'saves': 'saves', 'goals_conceded': 'gc_stat', 'goals_prevented': 'gprev',
    'keeper_high_claim': 'claims', 'conceded_penalties': 'pen_conceded', 'penalties_won': 'pen_won',
    'missed_penalty': 'pen_missed', 'saved_penalties': 'pen_saved', 'owngoal': 'og_stat',
    'expected_goals_on_target_faced': 'xgot_faced', 'errors_led_to_goal': 'err_goal', 'defensive_actions': 'def_act',
    'passes_into_final_third': 'pass_f3', 'accurate_passes': 'passes_acc', 'duel_won': 'duel_won', 'duel_lost': 'duel_lost',
}


def norm(s):
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r'[^a-z0-9 ]', ' ', s.replace('-', ' '))
    return re.sub(r'\s+', ' ', s).strip()


# ───────────────────────── 1. long table ─────────────────────────
def build_long():
    odds = {}
    for f in glob.glob(os.path.join(DATA, 'odds', '*.json')):
        o = json.load(open(f))
        if o and all(k in o for k in ('H', 'D', 'A')):
            odds[int(os.path.basename(f)[:-5])] = o
    rows, matches = [], []
    for f in glob.glob(os.path.join(DATA, 'm', '*.json')):
        d = json.load(open(f))
        hs, as_ = d['h']['score'], d['a']['score']
        if hs is None or as_ is None or not d['date']:
            continue
        o = odds.get(d['id'])
        matches.append(dict(match_id=d['id'], date=d['date'], league=d['league'], season=d['season'], round=d['round'],
                            h=d['h']['id'], a=d['a']['id'], hs=hs, as_=as_, hn=d['h']['name'], an=d['a']['name'],
                            oh=o['H'] if o else np.nan, od=o['D'] if o else np.nan, oa=o['A'] if o else np.nan))
        goals = d['goals']
        pen_by, og_by = {}, {}
        for g in goals:
            if g['pid'] is None:
                continue
            if g['og']:
                og_by[g['pid']] = og_by.get(g['pid'], 0) + 1
            elif g['pen']:
                pen_by[g['pid']] = pen_by.get(g['pid'], 0) + 1
        for p in d['players']:
            st = p['st']
            mins = st.get('minutes_played')
            mins = mins if mins is not None and mins > 0 else 0
            tin, tout = 0, 120
            if not p['started']:
                ins = [t for k, t in p['sub'] if k == 'subIn']
                tin = ins[0] if ins else None
            outs = [t for k, t in p['sub'] if k == 'subOut']
            if outs:
                tout = outs[0]
            side = 'h' if p['home'] else 'a'
            ga_on = 0     # goals conceded by his team while he was on the pitch
            if mins > 0 and tin is not None:
                ga_on = sum(1 for g in goals if g['side'] is not None and g['side'] != side and g['min'] is not None and tin <= g['min'] <= tout)
            r = dict(match_id=d['id'], player_id=p['id'], name=p['name'], team=p['teamId'], is_home=p['home'], started=p['started'],
                     posId=p['posId'], usual=p['usual'], gk=p['gk'], rating_l=p['rating'], min=mins, ga_on=ga_on,
                     yellow=1 if 'yellowCard' in p['events'] else 0, red=1 if 'redCard' in p['events'] else 0,
                     second_yellow=1 if 'secondYellow' in p['events'] else 0, goals_pen=pen_by.get(p['id'], 0), og=og_by.get(p['id'], 0))
            for k, v in STAT_KEEP.items():
                r[v] = st.get(k, np.nan)
            rows.append(r)
    df = pd.DataFrame(rows)
    mt = pd.DataFrame(matches)
    mt['date'] = pd.to_datetime(mt['date'], utc=True)
    df = df.merge(mt[['match_id', 'date', 'league', 'season', 'round', 'h', 'a', 'hs', 'as_', 'oh', 'od', 'oa']], on='match_id')
    df['opp'] = np.where(df['is_home'], df['a'], df['h'])
    df['gf'] = np.where(df['is_home'], df['hs'], df['as_'])
    df['ga'] = np.where(df['is_home'], df['as_'], df['hs'])
    df = df.sort_values(['date', 'match_id']).reset_index(drop=True)
    df['rating'] = df['rating_l'].where(df['rating_l'].notna(), df['rating_p'])
    df['played'] = df['min'] > 0
    print('long table', df.shape, 'matches', len(mt), 'odds coverage', round(mt['oh'].notna().mean(), 3))
    return df, mt


# ───────────────────────── 2. native Mantra positions ─────────────────────────
def native_positions(df, mt):
    players = df.groupby('player_id').agg(name=('name', 'first'), league=('league', 'last'), team=('team', 'last')).reset_index()
    teams = {}
    for _, r in mt.iterrows():
        teams[r['h']] = r['hn']; teams[r['a']] = r['an']
    players['team_name'] = players['team'].map(teams)
    out = {}
    for lg in LEAGUES:
        M = json.load(open(os.path.join(DATA, f'mantra_{lg}.json')))
        full, last = collections.defaultdict(list), collections.defaultdict(list)
        for m in M:
            full[norm(f"{m.get('first_name') or ''} {m['name']}")].append(m)
            last[norm(m['name'])].append(m)
        for _, p in players[players.league == lg].iterrows():
            n = norm(p['name'])
            cand = full.get(n)
            if not cand:
                toks = n.split()
                cand = []
                for k, ms in last.items():
                    if k and (k == n or n.endswith(' ' + k) or k.endswith(' ' + n)):
                        cand += ms
                if len(cand) > 1 and toks:
                    c2 = [m for m in cand if norm(m.get('first_name') or '')[:1] == toks[0][:1]]
                    cand = c2 or cand
            if cand and len(cand) > 1:
                tn = norm(p['team_name'] or '')
                c2 = [m for m in cand if norm(m['club']['name']) and (norm(m['club']['name']) in tn or tn in norm(m['club']['name'])
                                                                      or set(norm(m['club']['name']).split()) & set(tn.split()))]
                cand = c2 or cand
            if cand and len(cand) == 1 and cand[0]['position_classic_arr']:
                out[int(p['player_id'])] = cand[0]['position_classic_arr']
    print('matched to Mantra positions:', len(out), 'of', len(players), 'players')
    return out


# ───────────────────────── 3. ground-truth points ─────────────────────────
def goal_bonus(n):
    if 'ST' in n or 'FW' in n:
        return 2.0
    if 'AM' in n or 'W' in n:
        return 2.5
    return 3.0


def cs_bonus(n):
    best = 0.0
    for p in n:
        best = max(best, 1.5 if p == 'GK' else 1.0 if p in ('RB', 'CB', 'LB') else 0.5 if p in ('WB', 'DM') else 0.0)
    return best


def add_points(df, native):
    st = df[df.started & df.player_id.isin(native)].copy()
    st['nat'] = st.player_id.map(lambda i: tuple(native[i]))
    proxy = st.groupby('posId')['nat'].agg(lambda s: collections.Counter(s).most_common(1)[0][0]).to_dict()
    modal_pos = df[df.started].groupby('player_id')['posId'].agg(lambda s: s.mode().iloc[0] if len(s.mode()) else np.nan)
    usual = df.groupby('player_id')['usual'].agg(lambda s: s.mode().iloc[0] if len(s.mode()) else np.nan)
    by_usual = {0: ('GK',), 1: ('CB',), 2: ('CM',), 3: ('ST',)}

    def nat_of(pid):
        if pid in native:
            return tuple(native[pid]), True
        p = modal_pos.get(pid)
        if p is not None and not pd.isna(p) and p in proxy:
            return proxy[p], False
        return by_usual.get(usual.get(pid), ('CM',)), False

    m = {i: nat_of(i) for i in df.player_id.unique()}
    df['nat'] = df.player_id.map(lambda i: m[i][0])
    df['nat_known'] = df.player_id.map(lambda i: m[i][1])
    df['group'] = df.nat.map(lambda n: GROUP[n[0]])
    df['gb'] = df.nat.map(goal_bonus)
    df['csb'] = df.nat.map(cs_bonus)

    base = np.where(df.rating.notna(), df.rating, 6.0)
    pens = df.goals_pen
    goals_np = np.clip(df.goals.fillna(0) - pens, 0, None)
    pts = base + goals_np * df.gb + pens * 2 + df.assists.fillna(0)
    pts = pts + df.pen_won.fillna(0) + df.pen_saved.fillna(0) * 3 - df.pen_conceded.fillna(0) - df.pen_missed.fillna(0) * 2 - df.og * 2
    red = (df.red == 1) | (df.second_yellow == 1)
    pts = pts - np.where(red, np.where(df.gk, 3, 2), 0) - np.where((df.yellow == 1) & ~red, 0.5, 0)
    sv = df.saves.fillna(0)
    pts = pts + np.where(df.gk, np.where(sv >= 6, 1.0, np.where(sv >= 3, 0.5, 0.0)) - df.ga_on, 0)
    cs_ok = (df['min'] >= 60) & (df.ga_on == 0) & (~red | (df.ga == 0))
    df['cs_flag'] = cs_ok
    pts = pts + np.where(cs_ok, df.csb, 0)
    df['pts'] = np.where(df.played, pts, np.nan)
    df['base'] = np.where(df.played, base, np.nan)
    df['bonus'] = df.pts - df.base
    print(df[df.played].groupby('group')[['base', 'bonus', 'pts']].mean().round(3))
    return df


if __name__ == '__main__':
    df, mt = build_long()
    native = native_positions(df, mt)
    df = add_points(df, native)
    pickle.dump((df, mt), open(os.path.join(DATA, 'pts.pkl'), 'wb'))
    print('wrote data/pts.pkl')
