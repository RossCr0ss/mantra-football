#!/usr/bin/env python3
"""
Fetch previous-season FotMob player stats for a league and rank players by a
composite auction-value score. Read-only — hits FotMob's public endpoints only.

Usage:
    python3 fetch_and_score.py --league 47 [--season 2025/2026] [--min-minutes 700] [--out /path/prefix]

If --season is omitted, the script auto-detects the most recent COMPLETED
season (the top entry of the league's `seasons` list, which only contains
seasons with a decided winner — the upcoming/in-progress season never has one).
"""
import argparse
import gzip
import json
import re
import sys
import time
import urllib.request
import urllib.parse

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.fotmob.com/',
    'Origin': 'https://www.fotmob.com',
    'Accept-Encoding': 'gzip',
}

GROUP_MAP = {'keepers': 'GK', 'defenders': 'DEF', 'midfielders': 'MID', 'attackers': 'FWD'}
USUAL_POS = {0: 'GK', 1: 'DEF', 2: 'MID', 3: 'FWD'}

# CDN key -> (field, useSubStatValue). NOTE: expected_goals is intentionally
# False here — FotMob swaps the meaning for this one key: StatValue is the
# real xG total, SubStatValue is actually just the goals total (verified
# empirically against 2025/26 Premier League data; every other key follows
# the documented convention where SubStatValue = season total).
CDN_STAT_CONFIG = [
    ('goals', 'goals', False),
    ('goal_assist', 'assists', False),
    ('mins_played', 'minutesPlayedCdn', False),
    ('expected_goals', 'expectedGoals', False),
    ('ontarget_scoring_att', 'shots', True),
    ('total_att_assist', 'chancesCreated', False),
    ('big_chance_created', 'bigChancesCreated', True),
    ('big_chance_missed', 'bigChancesMissed', True),
    ('total_tackle', 'tackles', True),
    ('interception', 'interceptions', True),
    ('effective_clearance', 'clearances', True),
    ('outfielder_block', 'blockedShots', True),
    ('poss_won_att_3rd', 'possessionWonFinal3rd', True),
    ('clean_sheet', 'cleanSheets', False),
    ('saves', 'saves', True),
    ('goals_conceded', 'goalsConceded', True),
    ('fouls', 'foulsCommitted', True),
]


def fetch_json(url, retries=3, warn=True):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw = resp.read()
                if resp.info().get('Content-Encoding') == 'gzip':
                    raw = gzip.decompress(raw)
                return json.loads(raw)
        except Exception as e:
            if attempt == retries - 1:
                if warn:
                    print(f"WARN fetch failed {url}: {e}", file=sys.stderr)
                return None
            time.sleep(1)


def extract_table_rows(table_data):
    """Handles both standard (table.all) and playoff/group (tables[].table.all) shapes."""
    if not table_data:
        return []
    single = table_data.get('table')
    if single and single.get('all'):
        return single['all']
    subs = table_data.get('tables') or []
    seen, rows = set(), []
    for sub in subs:
        for row in (sub.get('table') or {}).get('all') or []:
            rid = int(row['id'])
            if rid not in seen:
                seen.add(rid)
                rows.append(row)
    return rows


def resolve_season(league_id, season_name):
    base = fetch_json(f"https://www.fotmob.com/api/data/leagues?id={league_id}")
    if base is None:
        print("FATAL: could not fetch league base data", file=sys.stderr)
        sys.exit(1)

    if not season_name:
        # Prefer allAvailableSeasons[1] (index 0 is always the current/upcoming
        # season) over seasons[0] (the most recent entry with a tagged winner) —
        # some competitions (confirmed: Ukrainian Premier League 2025/2026) have
        # a fully-populated just-finished season with real stats, but FotMob
        # hasn't tagged a winner for it yet, so seasons[0] skips an entire year
        # back to stale data. allAvailableSeasons is just the season-name list
        # with no winner requirement, so it doesn't have this gap.
        available = base.get('allAvailableSeasons') or []
        if len(available) >= 2:
            season_name = available[1]
            print(f"Auto-detected most recent season (allAvailableSeasons[1]): {season_name}", file=sys.stderr)
        else:
            seasons = base.get('seasons') or []
            if not seasons:
                print("FATAL: no completed seasons found; pass --season explicitly", file=sys.stderr)
                sys.exit(1)
            season_name = seasons[0]['seasonName']
            print(f"Auto-detected most recent completed season (seasons[0] fallback): {season_name}", file=sys.stderr)

    encoded = urllib.parse.quote(season_name, safe='')
    data = fetch_json(f"https://www.fotmob.com/api/data/leagues?id={league_id}&season={encoded}")
    if data is None:
        print("FATAL: could not fetch season-scoped league data", file=sys.stderr)
        sys.exit(1)

    rows = extract_table_rows(data['table'][0]['data'])
    if not rows:
        print("FATAL: no teams found in table for this season", file=sys.stderr)
        sys.exit(1)

    # Pull the numeric season ID out of any stat's fetchAllUrl (e.g. .../season/27110/goals.json)
    season_id = None
    for section in (data.get('stats') or {}).get('players', []):
        m = re.search(r'/season/(\d+)/', section.get('fetchAllUrl', ''))
        if m:
            season_id = m.group(1)
            break
    if not season_id:
        print("FATAL: could not extract numeric season ID from stats.players[].fetchAllUrl", file=sys.stderr)
        sys.exit(1)

    teams = {int(r['id']): r['name'] for r in rows}
    print(f"Season '{season_name}' -> seasonId {season_id}, {len(teams)} teams", file=sys.stderr)
    return season_id, teams


def fetch_cdn_stats(league_id, season_id):
    print("Fetching CDN stat lists...", file=sys.stderr)
    cdn_data = {}
    for key, field, use_sub in CDN_STAT_CONFIG:
        data = fetch_json(f"https://data.fotmob.com/stats/{league_id}/season/{season_id}/{key}.json", warn=False)
        m = {}
        if data:
            lst = (data.get('TopLists') or [{}])[0].get('StatList') or []
            for entry in lst:
                pid = entry.get('ParticiantId')
                if pid is None:
                    continue
                val = entry.get('SubStatValue') if use_sub else entry.get('StatValue')
                if val is None:
                    val = entry.get('StatValue') if use_sub else entry.get('SubStatValue')
                if val is not None:
                    m[pid] = val
        cdn_data[field] = m
        print(f"  {key} -> {field}: {len(m)} players", file=sys.stderr)

    rating_data = fetch_json(f"https://data.fotmob.com/stats/{league_id}/season/{season_id}/rating.json", warn=False)
    rating_map = {}
    if rating_data:
        lst = (rating_data.get('TopLists') or [{}])[0].get('StatList') or []
        for e in lst:
            pid = e.get('ParticiantId')
            if pid is not None:
                rating_map[pid] = {
                    'seasonRating': e.get('StatValue'),
                    'leagueRank': e.get('Rank'),
                    'matchesPlayed': e.get('MatchesPlayed'),
                    'minutesPlayed': e.get('MinutesPlayed'),
                }
    print(f"  rating.json -> {len(rating_map)} players (may be empty/403 for some leagues, e.g. Ukraine)", file=sys.stderr)
    return cdn_data, rating_map


def fetch_squads(teams):
    print(f"Fetching squads for {len(teams)} teams...", file=sys.stderr)
    players = {}
    for tid, tname in teams.items():
        data = fetch_json(f"https://www.fotmob.com/api/data/teams?id={tid}")
        if not data:
            continue
        squad = (data.get('squad') or {}).get('squad')
        count = 0
        if squad:
            for grp in squad:
                pos = GROUP_MAP.get(grp.get('title'))
                if not pos:
                    continue
                for m in grp.get('members', []):
                    pid = m.get('id')
                    if pid is None:
                        continue
                    players[pid] = {
                        'playerId': pid, 'name': m.get('name'), 'teamId': tid, 'teamName': tname,
                        'positionGroup': pos, 'positionLabel': m.get('positionIdsDesc') or pos,
                        'age': m.get('age'), 'goals_squad': m.get('goals'), 'assists_squad': m.get('assists'),
                        'yellowCards': m.get('ycards'), 'redCards': m.get('rcards'),
                    }
                    count += 1
        else:
            # Fallback for smaller clubs FotMob doesn't maintain a full squad for
            # (e.g. most Ukrainian Premier League teams outside Shakhtar/Dynamo).
            lineup = (data.get('overview') or {}).get('lastLineupStats') or {}
            entries = (lineup.get('starters') or []) + (lineup.get('subs') or [])
            seen = set()
            for p in entries:
                pid = p.get('id')
                if pid is None or pid in seen:
                    continue
                seen.add(pid)
                pos = USUAL_POS.get(p.get('usualPlayingPositionId'), 'MID')
                players[pid] = {
                    'playerId': pid, 'name': p.get('name'), 'teamId': tid, 'teamName': tname,
                    'positionGroup': pos, 'positionLabel': pos, 'age': p.get('age'),
                    'goals_squad': 0, 'assists_squad': 0, 'yellowCards': 0, 'redCards': 0,
                }
                count += 1
            if count:
                print(f"  team {tid} ({tname}): used lastLineupStats fallback ({count} players, no season stats)", file=sys.stderr)
        print(f"  team {tid} ({tname}): {count} players", file=sys.stderr)
        time.sleep(0.15)
    return players


def per90(total, minutes):
    if total is None or not minutes or minutes <= 0:
        return 0.0
    return total / (minutes / 90.0)


def num(v, default=0.0):
    return v if isinstance(v, (int, float)) else default


def guess_native_positions(fotmob_label, group):
    """Per-token classifier for Mantra 'native' positions from a FotMob positionLabel
    (e.g. "RB,CB,LB", "CAM,CDM", "RW,CAM"). This intentionally does NOT reuse
    apps/web/src/lib/mantraPositions.ts's guessMantraPositions verbatim — that
    function has two bugs that matter here (confirmed by reading its source):
      1. It only ever inspects the FIRST token of a multi-token label (no comma
         split), so "RB,CB,LB" falls through to the DEF default ('CB') and
         "CAM,CDM" falls through to the MID default ('CM').
      2. For the FWD group it only checks for 'second'/'shadow'/'ss'/'a' and
         otherwise defaults to ST — it never checks for wing/AM tokens, so wide
         forwards with no explicit "ST" token (e.g. a winger labeled "RW,CAM")
         get misclassified as ST.
    Both bugs are harmless for the app's own use (it's just an initial suggestion
    a human then corrects in the UI), but here the native-position SET directly
    determines which goal-bonus/clean-sheet-bonus tier a player falls into, so
    getting it right matters. This version recognizes each token on its own
    merits regardless of FotMob's coarse group bucket, falling back to that
    group's default only when a token isn't recognized at all.
    Returns a set of Mantra position codes, e.g. {'CB', 'RB'} or {'AM', 'W'}.
    """
    if group == 'GK':
        return {'GK'}
    tokens = [t.strip().lower() for t in fotmob_label.split(',') if t.strip()] or ['']
    out = set()
    for l in tokens:
        if 'right wing' in l or l == 'rwb': out.update(['RB', 'WB'])
        elif 'left wing' in l or l == 'lwb': out.update(['LB', 'WB'])
        elif l in ('wb', 'e'): out.add('WB')
        elif l in ('lw', 'rw', 'lm', 'rm', 'w') or 'wing' in l: out.add('W')
        elif l in ('am', 'cam', 't') or 'attacking' in l: out.add('AM')
        elif l in ('dm', 'cdm') or 'defensive' in l: out.add('DM')
        elif l in ('ss', 'a') or 'second' in l or 'shadow' in l: out.add('FW')
        elif l in ('st', 'cf'): out.add('ST')
        elif l in ('rb', 'dd'): out.add('RB')
        elif l in ('lb', 'ds'): out.add('LB')
        elif l == 'cb': out.add('CB')
        elif l == 'cm': out.add('CM')
        elif l == 'm': out.add('DM' if group == 'MID' else 'CM')
        else: out.add({'DEF': 'CB', 'MID': 'CM', 'FWD': 'ST'}[group])
    return out


def goal_bonus_tier(native_positions):
    """Mantra Football goal-bonus rule: depends on the scorer's NATIVE positions,
    not the slot they were deployed in. ST/FW present -> +2 (cheapest — it's the
    'expected' thing for a forward to do); else AM/W present -> +2.5; else (pure
    CB/RB/LB/WB/DM/CM/GK — a defender or holding mid scoring) -> +3. This is the
    opposite of naive fantasy intuition: a goal from a DM is worth 50% more than
    the same goal from a striker."""
    if native_positions & {'ST', 'FW'}:
        return 2.0
    if native_positions & {'AM', 'W'}:
        return 2.5
    return 3.0


def clean_sheet_bonus_tier(native_positions):
    """GK +1.5, RB/CB/LB +1.0, WB/DM +0.5, everyone else (CM/AM/W/FW/ST) +0."""
    if 'GK' in native_positions:
        return 1.5
    if native_positions & {'RB', 'CB', 'LB'}:
        return 1.0
    if native_positions & {'WB', 'DM'}:
        return 0.5
    return 0.0


def score_players(players, min_minutes):
    """Estimates average Mantra Football points per match using the ACTUAL
    published scoring rules (base score + goal/assist/CS/card bonuses/maluses +
    GK save/concession bonus-malus), not a generic proxy. Season aggregates are
    used to approximate what is really a per-match calculation, so treat this as
    a ranking signal, not an exact prediction — see caveats in SKILL.md:
      - Clean-sheet rate (cleanSheets/matchesPlayed) approximates the per-match
        eligibility check (60+ min, native position AND module slot both
        qualifying, zero goals conceded while on the pitch).
      - GK save bonus is tiered per match (+1 for 6+ saves, +0.5 for 3-5) but we
        only have a season total, so it's bucketed off the season AVERAGE saves
        per match — this smooths out variance a real per-match tier wouldn't.
      - Card and penalty edge cases (second-yellow-then-red, missed penalties by
        outfield takers, own goals, earned/conceded penalties) aren't in the
        FotMob CDN dataset and are omitted — a small undercount for the few
        players those apply to.
    """
    scored, dropped = [], []
    for p in players.values():
        minutes = p.get('minutesPlayed') or p.get('minutesPlayedCdn') or 0
        mp = p.get('matchesPlayed') or 0
        rating = p.get('seasonRating')
        group = p.get('positionGroup')

        if mp < 1 or not rating:
            continue

        native = guess_native_positions(p.get('positionLabel') or '', group)
        gBonus = goal_bonus_tier(native)
        csBonus = clean_sheet_bonus_tier(native)

        goals = num(p.get('goals'), num(p.get('goals_squad')))
        assists = num(p.get('assists'), num(p.get('assists_squad')))
        yc = num(p.get('yellowCards'))
        rc = num(p.get('redCards'))
        cs = num(p.get('cleanSheets'))
        csRate = cs / mp

        perMatch = (
            rating
            + (goals / mp) * gBonus
            + (assists / mp) * 1.0
            + csRate * csBonus
            - (yc / mp) * 0.5
            - (rc / mp) * 2.0
        )

        gcMalus = savesBonus = 0.0
        if group == 'GK':
            saves = num(p.get('saves'))
            gc = num(p.get('goalsConceded'))
            savesPerMatch = saves / mp
            gcMalus = (gc / mp) * 1.0
            savesBonus = 1.0 if savesPerMatch >= 6 else (0.5 if savesPerMatch >= 3 else 0.0)
            perMatch = perMatch - gcMalus + savesBonus

        rec = dict(p)
        rec.update({
            'goals': goals, 'assists': assists, 'minutesPlayed': minutes, 'matchesPlayed': mp,
            'nativePositions': '/'.join(sorted(native)), 'goalBonus': gBonus, 'csBonus': csBonus,
            'csRate': round(csRate, 2), 'gcMalus': round(gcMalus, 2), 'savesBonus': savesBonus,
            'mantraPerMatch': round(perMatch, 2),
        })
        (dropped if minutes < min_minutes else scored).append(rec)

    scored.sort(key=lambda r: -r['mantraPerMatch'])
    dropped.sort(key=lambda r: -r['mantraPerMatch'])
    return scored, dropped


def has_per_match_data(players):
    """Checks whether enough players have matchesPlayed + seasonRating to make
    the per-match Mantra formula meaningful. Some leagues (confirmed: Ukrainian
    Premier League) return a 403 on rating.json entirely, and their smaller
    clubs' squad endpoints fall back to lastLineupStats (which carries no
    season stats at all) — in that combination literally 0% of players get
    matchesPlayed, so score_players() would silently drop everyone. Returns
    False when coverage is too thin (<5% of players) to trust."""
    vals = list(players.values())
    if not vals:
        return False
    with_data = sum(1 for p in vals if p.get('matchesPlayed') and p.get('seasonRating'))
    return with_data / len(vals) >= 0.05


def score_players_totals(players):
    """Fallback ranking for leagues without usable per-match data (see
    has_per_match_data). Ranks by season TOTAL goals/assists/clean-sheets
    weighted by the same native-position-aware bonus tiers as score_players,
    since that's the only reliably-available signal — no rating, no minutes,
    no per-90 rates. This is a much cruder signal than mantraPerMatch: a
    player's total naturally reflects both quality AND how much they played,
    conflated together with no way to separate the two. Treat totals as
    "how much this player already contributed", not "how good are they per
    match" — a squad player with 8 goals in 10 starts and one with 8 goals in
    30 appearances look identical here.
    """
    scored = []
    for p in players.values():
        group = p.get('positionGroup')
        native = guess_native_positions(p.get('positionLabel') or '', group)
        gBonus = goal_bonus_tier(native)
        csBonus = clean_sheet_bonus_tier(native)

        goals = num(p.get('goals'), num(p.get('goals_squad')))
        assists = num(p.get('assists'), num(p.get('assists_squad')))
        cs = num(p.get('cleanSheets'))

        if goals == 0 and assists == 0 and cs == 0:
            continue  # no signal at all for this player — nothing to rank on

        total = goals * gBonus + assists * 1.0 + cs * csBonus
        rec = dict(p)
        rec.update({
            'goals': goals, 'assists': assists,
            'nativePositions': '/'.join(sorted(native)), 'goalBonus': gBonus, 'csBonus': csBonus,
            'mantraPerMatch': round(total, 1),  # same key name so print_table works unmodified; it's a SEASON TOTAL here, not a per-match rate
        })
        scored.append(rec)

    scored.sort(key=lambda r: -r['mantraPerMatch'])
    return scored


def defence_bonus_tier(avg_rating):
    """Maps a defensive block's average base rating to the team-wide defence
    bonus (added once per match to the WHOLE lineup's score, not per player)."""
    if avg_rating >= 8.00: return 5
    if avg_rating >= 7.75: return 4
    if avg_rating >= 7.50: return 3
    if avg_rating >= 7.25: return 2
    if avg_rating >= 7.00: return 1
    return 0


def print_defence_clusters(scored, min_defenders=4, top_n=8):
    """The defence bonus is calculated from the AVERAGE base rating of the 4
    defenders actually in your module — so it rewards owning several
    high-rated defenders from the SAME strong defensive team over spreading one
    great pick across otherwise-average defenders (one weak link drags the
    whole average, and therefore the whole team's bonus, down). This groups
    scored defenders by team and reports each team's best-N-defender average
    and resulting bonus tier, so a team with several 7.2+ rated defenders is
    visibly a better cluster buy than a single 7.5-rated defender elsewhere."""
    by_team = {}
    for r in scored:
        if r['positionGroup'] == 'DEF':
            by_team.setdefault(r['teamName'], []).append(r)
    clusters = []
    for team, defs in by_team.items():
        defs = sorted(defs, key=lambda r: -r['seasonRating'])
        if len(defs) < min_defenders:
            continue
        top = defs[:min_defenders]
        avg = sum(r['seasonRating'] for r in top) / len(top)
        clusters.append((team, avg, top))
    clusters.sort(key=lambda c: -c[1])
    print(f"\n=== DEFENCE BONUS CLUSTERS (best {min_defenders} DEF per team by rating) ===")
    print(f"{'Team':<24}{'Avg rating':>12}{'Bonus tier':>12}   Players")
    for team, avg, top in clusters[:top_n]:
        names = ', '.join(f"{r['name']} ({r['seasonRating']:.2f})" for r in top)
        print(f"{team:<24}{avg:>12.2f}{defence_bonus_tier(avg):>12}   {names}")


def print_table(rows, title):
    print(f"\n=== {title} ===")
    header = f"{'Name':<24} {'Team':<20} {'Nat':<10} {'MP':>3} {'Rtg':>5} {'G':>3} {'A':>3} {'GB':>4} {'CSB':>4} {'/match':>7}"
    print(header)
    for r in rows:
        print(f"{r['name']:<24} {r['teamName']:<20} {r.get('nativePositions',''):<10} {r.get('matchesPlayed') or 0:>3} "
              f"{r.get('seasonRating') or 0:>5.2f} {r.get('goals') or 0:>3.0f} {r.get('assists') or 0:>3.0f} "
              f"{r.get('goalBonus',0):>4} {r.get('csBonus',0):>4} {r['mantraPerMatch']:>7.2f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--league', type=int, required=True, help='FotMob league ID, e.g. 47 for Premier League')
    ap.add_argument('--season', default=None, help='Season name, e.g. "2025/2026". Auto-detects most recent completed season if omitted.')
    ap.add_argument('--min-minutes', type=int, default=700)
    ap.add_argument('--out', default='./fotmob-league-players', help='Output file path prefix (writes <out>.json)')
    args = ap.parse_args()

    season_id, teams = resolve_season(args.league, args.season)
    cdn_data, rating_map = fetch_cdn_stats(args.league, season_id)
    players = fetch_squads(teams)
    print(f"Total players collected: {len(players)}", file=sys.stderr)

    for pid, p in players.items():
        for field, m in cdn_data.items():
            p[field] = m.get(pid)
        rd = rating_map.get(pid, {})
        p['seasonRating'] = rd.get('seasonRating')
        p['leagueRank'] = rd.get('leagueRank')
        p['matchesPlayed'] = rd.get('matchesPlayed')
        p['minutesPlayed'] = rd.get('minutesPlayed') or p.get('minutesPlayedCdn')

    if has_per_match_data(players):
        scored, dropped = score_players(players, args.min_minutes)
        print_table(scored[:40], "TOP 40 OVERALL (est. Mantra points/match)")
        for grp in ['GK', 'DEF', 'MID', 'FWD']:
            print_table([r for r in scored if r['positionGroup'] == grp][:15], f"TOP 15 {grp}")
        print_table([r for r in dropped if (r.get('minutesPlayed') or 0) >= 300][:10],
                    "BREAKOUT WATCH (300-{}min, high per-90 output)".format(args.min_minutes))
        print_defence_clusters(scored)
    else:
        print("\n!!! WARNING: this league has no usable per-match data (rating.json is "
              "likely 403, and/or most clubs' squads fall back to lastLineupStats with no "
              "season stats at all). Falling back to TOTALS-ONLY ranking: season goals + "
              "assists + clean sheets, weighted by the same position-bonus tiers, with NO "
              "rating/minutes component. This conflates 'played a lot' with 'good' — treat it "
              "as a much cruder signal, and cross-check any pick against actual football "
              "knowledge of the league before trusting it.", file=sys.stderr)
        scored = score_players_totals(players)
        dropped = []
        print_table(scored[:40], "TOP 40 OVERALL (SEASON TOTALS — no per-match data available)")
        for grp in ['GK', 'DEF', 'MID', 'FWD']:
            print_table([r for r in scored if r['positionGroup'] == grp][:15], f"TOP 15 {grp} (totals)")
        no_signal = sum(1 for p in players.values()
                         if not num(p.get('goals'), num(p.get('goals_squad')))
                         and not num(p.get('assists'), num(p.get('assists_squad')))
                         and not num(p.get('cleanSheets')))
        print(f"\n{no_signal} of {len(players)} players have ZERO goals/assists/clean-sheets on "
              f"record (no CDN coverage, e.g. lastLineupStats-fallback defenders/GKs) — they are "
              f"NOT in the tables above at all, not just ranked low. Don't read their absence as "
              f"'bad', it means 'no data'.", file=sys.stderr)

    out_path = f"{args.out}.json"
    with open(out_path, 'w') as f:
        json.dump(scored + dropped, f)
    print(f"\nSaved full dataset ({len(scored) + len(dropped)} players) to {out_path}", file=sys.stderr)


if __name__ == '__main__':
    main()
