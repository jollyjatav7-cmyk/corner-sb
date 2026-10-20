"""Extract compact corner-related event tables from StatsBomb open data.

Usage: python3 -I extract.py <repo_dir> <out_dir>
"""
import json
import os
import sys
import csv
from multiprocessing import Pool

REPO = sys.argv[1]
OUT = sys.argv[2]
LEAGUES = {(2, 27): 'Premier League', (12, 27): 'Serie A', (11, 27): 'La Liga', (7, 27): 'Ligue 1'}

NON_PLAY = {'Starting XI', 'Half Start', 'Half End', 'Substitution', 'Tactical Shift', 'Player Off',
            'Player On', 'Injury Stoppage', 'Bad Behaviour', 'Referee Ball-Drop', 'Camera On',
            'Camera off', 'Own Goal Against', 'Error'}


def ts_seconds(ts):
    h, m, s = ts.split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


def in_box(loc):
    return loc is not None and loc[0] >= 102 and 18 <= loc[1] <= 62


def process(args):
    league, m = args
    mid = m['match_id']
    path = os.path.join(REPO, 'data', 'events', f'{mid}.json')
    if not os.path.exists(path):
        return None
    ev = json.load(open(path, encoding='utf-8'))
    home = m['home_team']['home_team_name']
    away = m['away_team']['away_team_name']
    rows = []
    corners = []
    for i, e in enumerate(ev):
        t = e['type']['name']
        team = e.get('team', {}).get('name')
        per = e.get('period')
        if per not in (1, 2):
            continue
        base = {'match_id': mid, 'period': per, 'minute': e['minute'], 'second': e['second'],
                't': ts_seconds(e['timestamp']), 'team': team, 'idx': e['index']}
        if t == 'Pass':
            p = e['pass']
            ptype = p.get('type', {}).get('name')
            outcome = p.get('outcome', {}).get('name', 'Complete')
            if ptype == 'Corner':
                corners.append((i, e))
                continue
            if p.get('cross') and ptype not in ('Free Kick', 'Corner', 'Throw-in', 'Goal Kick', 'Kick Off'):
                rows.append({**base, 'kind': 'cross', 'detail': outcome})
            if outcome == 'Complete':
                s, en = e.get('location'), p.get('end_location')
                if s and en:
                    if s[0] < 80 <= en[0]:
                        rows.append({**base, 'kind': 'f3_entry', 'detail': 'pass'})
                    if in_box(en) and not in_box(s):
                        rows.append({**base, 'kind': 'box_entry', 'detail': 'pass'})
        elif t == 'Carry':
            s, en = e.get('location'), e['carry'].get('end_location')
            if s and en:
                if s[0] < 80 <= en[0]:
                    rows.append({**base, 'kind': 'f3_entry', 'detail': 'carry'})
                if in_box(en) and not in_box(s):
                    rows.append({**base, 'kind': 'box_entry', 'detail': 'carry'})
        elif t == 'Shot':
            sh = e['shot']
            out = sh['outcome']['name']
            rows.append({**base, 'kind': 'shot', 'detail': out,
                         'xg': sh.get('statsbomb_xg'), 'pattern': e.get('play_pattern', {}).get('name'),
                         'shot_type': sh.get('type', {}).get('name')})
            if out == 'Goal':
                rows.append({**base, 'kind': 'goal', 'detail': 'shot'})
        elif t == 'Own Goal For':
            rows.append({**base, 'kind': 'goal', 'detail': 'own_goal'})

    # Classify what led to each corner
    for i, e in corners:
        team = e['team']['name']
        per = e['period']
        base = {'match_id': mid, 'period': per, 'minute': e['minute'], 'second': e['second'],
                't': ts_seconds(e['timestamp']), 'team': team, 'idx': e['index']}
        # last play event before the corner
        j = i - 1
        while j >= 0 and (ev[j]['type']['name'] in NON_PLAY or ev[j].get('period') != per):
            j -= 1
        cause = 'other'
        if j >= 0:
            tlast = ts_seconds(ev[j]['timestamp'])
            window = []
            k = j
            while k >= 0 and ev[k].get('period') == per and tlast - ts_seconds(ev[k]['timestamp']) <= 8:
                if ev[k]['type']['name'] not in NON_PLAY:
                    window.append(ev[k])
                k -= 1
            names = [(w['type']['name'], w.get('team', {}).get('name'), w) for w in window]
            shot = [w for n, tm, w in names if n == 'Shot' and tm == team]
            cross = [w for n, tm, w in names if n == 'Pass' and tm == team and w['pass'].get('cross')]
            gk = [w for n, tm, w in names if n == 'Goal Keeper' and tm != team
                  and w['goalkeeper'].get('type', {}).get('name') not in ('Shot Faced', 'Goal Conceded', 'Penalty Conceded')]
            clear = [w for n, tm, w in names if n == 'Clearance' and tm != team]
            block = [w for n, tm, w in names if n == 'Block' and tm != team]
            if shot:
                o = shot[0]['shot']['outcome']['name']
                if o == 'Blocked':
                    cause = 'shot_blocked'
                elif o.startswith('Saved') or gk:
                    cause = 'shot_saved'
                else:
                    cause = 'shot_other'
            elif cross:
                cause = 'cross'
            elif clear:
                cause = 'clearance'
            elif block:
                cause = 'block'
            elif gk:
                cause = 'keeper'
        rows.append({**base, 'kind': 'corner', 'detail': cause,
                     'pattern': e.get('play_pattern', {}).get('name')})

    pend = {1: 0.0, 2: 0.0}
    for e in ev:
        if e.get('period') in pend:
            pend[e['period']] = max(pend[e['period']], ts_seconds(e['timestamp']))
    meta = {'match_id': mid, 'league': league, 'date': m['match_date'], 'home': home, 'away': away,
            'home_score': m['home_score'], 'away_score': m['away_score'],
            'p1_len': round(pend[1], 1), 'p2_len': round(pend[2], 1)}
    return meta, rows


def main():
    jobs = []
    for (cid, sid), league in LEAGUES.items():
        for m in json.load(open(os.path.join(REPO, 'data', 'matches', str(cid), f'{sid}.json'), encoding='utf-8')):
            jobs.append((league, m))
    with Pool(2) as pool:
        res = [r for r in pool.map(process, jobs, chunksize=8) if r]
    os.makedirs(OUT, exist_ok=True)
    cols = ['match_id', 'period', 'minute', 'second', 't', 'team', 'idx', 'kind', 'detail', 'xg', 'pattern', 'shot_type']
    with open(os.path.join(OUT, 'events.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for _, rows in res:
            for r in rows:
                w.writerow(r)
    with open(os.path.join(OUT, 'matches.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['match_id', 'league', 'date', 'home', 'away', 'home_score', 'away_score', 'p1_len', 'p2_len'])
        w.writeheader()
        for meta, _ in res:
            w.writerow(meta)
    print('matches', len(res), 'of', len(jobs))


if __name__ == '__main__':
    main()
