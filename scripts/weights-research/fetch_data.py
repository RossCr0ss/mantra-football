"""Step 1 — download the raw data the weights are fitted on (all resumable; files land in ./data).

  python fetch_data.py            # matches + odds + Mantra positions
  LEAGUES=47,55 SEASONS=2025/2026 python fetch_data.py

* FotMob matchDetails  → data/m/<matchId>.json   (per-player rating, minutes, events, match stats)
* FotMob matchOdds     → data/odds/<matchId>.json (1X2 odds; available for finished matches too)
* mantrafootball.org   → data/mantra_<league>.json (official native positions)
"""
import json, os, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
LEAGUES = [int(x) for x in os.environ.get('LEAGUES', '47,55,87,40').split(',')]   # PL, Serie A, LaLiga, Belgium
SEASONS = os.environ.get('SEASONS', '2024/2025,2025/2026,2026/2027').split(',')
MANTRA_TOURNAMENT = {47: 2, 55: 1, 87: 5, 40: 13}                                    # FotMob league id → mantrafootball tournament id
M_OUT = os.path.join(HERE, 'data', 'm'); O_OUT = os.path.join(HERE, 'data', 'odds')
os.makedirs(M_OUT, exist_ok=True); os.makedirs(O_OUT, exist_ok=True)


def get(url, tries=5, accept='application/json'):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': accept})
            with urllib.request.urlopen(req, timeout=30) as r:
                return None if r.status == 204 else json.loads(r.read())
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def season_matches():
    """(match id, league, season) of every finished match."""
    jobs = []
    for lg in LEAGUES:
        for s in SEASONS:
            d = get(f'https://www.fotmob.com/api/data/leagues?id={lg}&season={urllib.parse.quote(s, safe="")}')
            ms = [m for m in d['fixtures']['allMatches'] if m['status'].get('finished') and not m['status'].get('cancelled')]
            print(lg, s, len(ms), 'finished matches', flush=True)
            jobs += [(int(m['id']), lg, s) for m in ms]
    return jobs

def flat_stats(ps):
    out = {}
    for grp in ps.get('stats', []):
        for _, v in (grp.get('stats') or {}).items():
            key = v.get('key')
            st = v.get('stat') or {}
            val = st.get('value')
            if key and isinstance(val, (int, float)):
                out[key] = val
                if 'total' in st and isinstance(st['total'], (int, float)):
                    out[key + '__total'] = st['total']
    return out


def slim(d, league, season):
    g = d['general']
    teams = d['header']['teams']
    content = d['content']
    ev = (content.get('matchFacts', {}).get('events') or {}).get('events') or []
    goals = []
    ph = pa = 0
    for e in ev:
        if e.get('type') != 'Goal':
            continue
        hs, as_ = e.get('homeScore'), e.get('awayScore')
        side = None
        if hs is not None and as_ is not None:
            if hs > ph:
                side = 'h'
            elif as_ > pa:
                side = 'a'
            ph, pa = hs, as_
        goals.append({
            'min': e.get('time'), 'add': e.get('overloadTime'), 'side': side,
            'pid': (e.get('player') or {}).get('id'),
            'pen': 'penalt' in str(e.get('goalDescription') or '').lower() or 'penalt' in str(e.get('eventType') or '').lower(),
            'og': bool(e.get('ownGoal')),
        })
    stats = content.get('playerStats') or {}
    players = []
    lu = content.get('lineup') or {}
    for sideKey, isHome in (('homeTeam', True), ('awayTeam', False)):
        t = lu.get(sideKey) or {}
        for grp, started in (('starters', True), ('subs', False)):
            for p in t.get(grp) or []:
                pid = p['id']
                perf = p.get('performance') or {}
                st = stats.get(str(pid))
                fs = flat_stats(st) if st else {}
                subev = perf.get('substitutionEvents') or []
                players.append({
                    'id': pid, 'name': p.get('name'), 'teamId': t.get('id'), 'home': isHome,
                    'started': started, 'posId': p.get('positionId'), 'usual': p.get('usualPlayingPositionId'),
                    'gk': bool(st and st.get('isGoalkeeper')) if st else (p.get('usualPlayingPositionId') == 0),
                    'rating': perf.get('rating'),
                    'events': [x.get('type') for x in (perf.get('events') or [])],
                    'sub': [(x.get('type'), x.get('time')) for x in subev],
                    'st': fs,
                })
    return {
        'id': int(g['matchId']), 'date': g.get('matchTimeUTCDate'), 'league': league, 'season': season,
        'round': g.get('matchRound'), 'finished': g.get('finished'),
        'h': {'id': teams[0]['id'], 'name': teams[0]['name'], 'score': teams[0].get('score')},
        'a': {'id': teams[1]['id'], 'name': teams[1]['name'], 'score': teams[1].get('score')},
        'goals': goals, 'players': players,
    }


def fetch_match(args):
    mid, league, season = args
    path = os.path.join(M_OUT, f'{mid}.json')
    if os.path.exists(path):
        return 'cached'
    try:
        rec = slim(get(f'https://www.fotmob.com/api/data/matchDetails?matchId={mid}'), league, season)
        with open(path, 'w') as f:
            json.dump(rec, f, separators=(',', ':'))
        return 'ok'
    except Exception as e:
        return f'err {mid} {e}'


def fetch_odds(args):
    mid = args[0]
    path = os.path.join(O_OUT, f'{mid}.json')
    if os.path.exists(path):
        return 'cached'
    try:
        d = get(f'https://www.fotmob.com/api/data/matchOdds?matchId={mid}&ccode3=GBR&bettingProvider=Bet365_default', tries=4)
        sel = (d or {}).get('odds', {}).get('resolvedOddsMarket', {}).get('selections')
        rec = {s['team']: float(s['oddsDecimal']) for s in sel if s.get('oddsDecimal')} if sel else None
        with open(path, 'w') as f:
            json.dump(rec, f)
        return 'ok'
    except Exception as e:
        return f'err {mid} {e}'


def run(fn, jobs, workers):
    errs = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for i, r in enumerate(ex.map(fn, jobs), 1):
            if r.startswith('err'):
                errs += 1; print(r, flush=True)
            if i % 200 == 0:
                print('progress', i, '/', len(jobs), 'errs', errs, flush=True)
    print(fn.__name__, 'done', len(jobs), 'errs', errs, flush=True)


def fetch_mantra_positions():
    for lg in LEAGUES:
        tid = MANTRA_TOURNAMENT[lg]
        # league_id is season-scoped; any active league of the tournament resolves the whole player pool
        league_id = get(f'https://mantrafootball.org/api/leagues?filter[tournament_id]={tid}&page[size]=1')['data'][0]['id']
        players, page = [], 1
        while True:
            d = get(f'https://mantrafootball.org/api/players?filter[league_id]={league_id}&page[number]={page}&page[size]=100')
            players += d['data']
            if page >= d['meta']['page']['total_pages']:
                break
            page += 1
        json.dump(players, open(os.path.join(HERE, 'data', f'mantra_{lg}.json'), 'w'))
        print('mantra', lg, len(players), 'players', flush=True)


if __name__ == '__main__':
    jobs = season_matches()
    print('total', len(jobs), flush=True)
    run(fetch_match, jobs, 8)
    run(fetch_odds, jobs, 4)
    fetch_mantra_positions()
