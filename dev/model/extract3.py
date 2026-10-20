"""Where corners come from, and extra in-play inputs a person could tap.

Outputs (in <out_dir>):
  corners.csv  one row per corner: the attacking action that led to it, the defensive touch that sent the ball out,
               possession type (counter, throw-in, free kick, corner chain...), zones, timing, score state
  poss.csv     one row per possession: type, how deep it got, crosses/shots, whether it won a corner
  ev_extra.csv extra event codes per team (same format as ev.csv):
               ct counter-attack reaching the final third   ti throw-in taken in the final third
               fk free kick taken in the final third         cl clearance by the opponent in its own third
               cb clearance by the opponent inside its box   tb ball received in the opponent box (open play)
               dr successful dribble in the final third      pr pressure applied in the final third

Coordinates: StatsBomb 120x80, every team attacking left to right in its own events.
Usage: python3 -I extract3.py <repo_dir> <out_dir> <n_procs>
"""
import csv
import json
import os
import sys
from multiprocessing import Pool

REPO, OUT, NP = sys.argv[1], sys.argv[2], int(sys.argv[3])
LEAGUES = {(2, 27): 'Premier League', (12, 27): 'Serie A', (11, 27): 'La Liga', (7, 27): 'Ligue 1'}
SET_PIECE = {'Corner', 'Free Kick', 'Throw-in', 'Goal Kick', 'Kick Off'}
SKIP = {'Ball Receipt*', 'Pressure', 'Substitution', 'Tactical Shift', 'Injury Stoppage', 'Referee Ball-Drop',
        'Player Off', 'Player On', 'Bad Behaviour', 'Starting XI', 'Half Start', 'Half End', 'Foul Committed',
        'Foul Won', 'Shield', 'Error', 'Camera On', 'Camera off', 'Offside', '50/50'}
ATTACK = {'Shot', 'Pass', 'Carry', 'Dribble', 'Duel', 'Miscontrol', 'Dispossessed'}
SAVED = {'Saved', 'Saved Off T', 'Saved To Post'}


def ts(s):
    h, m, x = s.split(':')
    return int(h) * 3600 + int(m) * 60 + float(x)


def in_box(p):
    return p is not None and p[0] >= 102 and 18 <= p[1] <= 62


def zone(p):
    if p is None:
        return 'unknown'
    x, y = p
    if x >= 114 and 30 <= y <= 50:
        return 'six'
    if x >= 102 and 18 <= y <= 62:
        return 'box'
    if x >= 102:
        return 'wide_deep'
    if x >= 90:
        return 'edge'
    return 'far'


def mirror(p):
    return None if p is None else [120 - p[0], 80 - p[1]]


def classify(chain, A):
    """chain: on-ball events before the corner, most recent first. Returns (category, attacking event, defensive event)."""
    a_last = b_last = None
    for e in chain:
        team = e.get('team', {}).get('name')
        typ = e['type']['name']
        if team != A:
            if b_last is None:
                b_last = e
            if typ == 'Pass' and 'outcome' not in e['pass']:
                break  # the defending side had the ball under control: the corner came from their own play
            continue
        if typ in ATTACK:
            a_last = e
            break
    bt = b_last['type']['name'] if b_last else None
    gk = b_last.get('goalkeeper', {}).get('type', {}).get('name') if bt == 'Goal Keeper' else None
    if a_last is None:
        if bt == 'Clearance':
            return 'def_clear', None, b_last
        if bt == 'Pass':
            return 'def_pass', None, b_last
        if bt == 'Goal Keeper':
            return 'def_gk', None, b_last
        return 'def_other', None, b_last
    at = a_last['type']['name']
    if at == 'Shot':
        oc = a_last['shot']['outcome']['name']
        if oc in SAVED or gk in ('Shot Saved', 'Save', 'Shot Saved Off Target', 'Shot Saved to Post'):
            return 'shot_saved', a_last, b_last
        if oc == 'Blocked':
            return 'shot_blocked', a_last, b_last
        return 'shot_other', a_last, b_last
    if at == 'Pass':
        p = a_last['pass']
        ptype = p.get('type', {}).get('name')
        if ptype == 'Corner':
            return 'from_corner', a_last, b_last
        if ptype == 'Free Kick':
            return 'from_fk', a_last, b_last
        if ptype == 'Throw-in':
            return 'from_ti', a_last, b_last
        if ptype in ('Goal Kick', 'Kick Off'):
            return 'pass_other', a_last, b_last
        if p.get('cross'):
            if bt == 'Clearance':
                bp = b_last.get('clearance', {}).get('body_part', {}).get('name', '')
                return ('cross_head' if bp == 'Head' or b_last.get('clearance', {}).get('head') else 'cross_clear'), a_last, b_last
            if bt == 'Block':
                return 'cross_block', a_last, b_last
            if bt == 'Goal Keeper':
                return 'cross_gk', a_last, b_last
            return 'cross_other', a_last, b_last
        if bt == 'Block':
            return 'pass_block', a_last, b_last
        if bt == 'Clearance':
            return 'pass_clear', a_last, b_last
        if bt == 'Goal Keeper':
            return 'pass_gk', a_last, b_last
        if bt == 'Interception':
            return 'pass_int', a_last, b_last
        return 'pass_other', a_last, b_last
    return 'dribble', a_last, b_last


def process(job):
    league, m = job
    mid = m['match_id']
    ev = json.load(open(os.path.join(REPO, 'data', 'events', f'{mid}.json'), encoding='utf-8'))
    home = m['home_team']['home_team_name']
    side = lambda t: 1 if t == home else 0
    score = {1: 0, 0: 0}
    corners, extra = [], []
    last_ck = {}
    # possessions
    poss = {}
    for e in ev:
        per = e.get('period')
        if per not in (1, 2):
            continue
        pid = e.get('possession')
        pt = e.get('possession_team', {}).get('name')
        if pid is None or pt is None:
            continue
        P = poss.setdefault(pid, {'match_id': mid, 'period': per, 'poss': pid, 'side': side(pt), 'team': pt,
                                  'pattern': e.get('play_pattern', {}).get('name', ''), 'start_t': ts(e['timestamp']),
                                  'start_x': None, 'n_pass': 0, 'f3': 0, 'box': 0, 'cross': 0, 'shot': 0, 'corner': 0,
                                  'end_t': 0.0, 'counter_f3_t': None, 'score_diff': None})
        P['end_t'] = ts(e['timestamp'])
        team = e.get('team', {}).get('name')
        loc = e.get('location')
        if team == pt and loc is not None:
            if P['start_x'] is None:
                P['start_x'] = round(loc[0], 1)
            if loc[0] >= 80:
                P['f3'] = 1
                if P['pattern'] == 'From Counter' and P['counter_f3_t'] is None:
                    P['counter_f3_t'] = ts(e['timestamp'])
            if in_box(loc):
                P['box'] = 1
        if team == pt and e['type']['name'] == 'Pass':
            P['n_pass'] += 1
            pp = e['pass']
            if pp.get('cross') and pp.get('type', {}).get('name') not in SET_PIECE:
                P['cross'] = 1
            en = pp.get('end_location')
            if 'outcome' not in pp and en is not None:
                if en[0] >= 80:
                    P['f3'] = 1
                if in_box(en):
                    P['box'] = 1
        if team == pt and e['type']['name'] == 'Shot':
            P['shot'] = 1
    # walk events
    onball = []
    for i, e in enumerate(ev):
        per = e.get('period')
        if per not in (1, 2):
            continue
        typ = e['type']['name']
        team = e.get('team', {}).get('name')
        t = ts(e['timestamp'])
        loc = e.get('location')
        s = side(team) if team else None
        if typ == 'Shot' and e['shot']['outcome']['name'] == 'Goal':
            score[s] += 1
        if typ == 'Own Goal For':
            score[s] += 1
        # extra codes
        code = None
        if typ == 'Pass':
            ptype = e['pass'].get('type', {}).get('name')
            if ptype == 'Throw-in' and loc and loc[0] >= 80:
                code = 'ti'
            elif ptype == 'Free Kick' and loc and loc[0] >= 80:
                code = 'fk'
        elif typ == 'Shot' and e['shot'].get('type', {}).get('name') == 'Free Kick' and loc and loc[0] >= 80:
            code = 'fk'
        elif typ == 'Clearance' and loc:
            # the opponent of the clearing side benefits; count it for the attacking team
            if loc[0] <= 18 and 18 <= loc[1] <= 62:
                extra.append({'match_id': mid, 'period': per, 't': round(t, 2), 'side': 1 - s, 'code': 'cb'})
            if loc[0] <= 40:
                extra.append({'match_id': mid, 'period': per, 't': round(t, 2), 'side': 1 - s, 'code': 'cl'})
        elif typ == 'Ball Receipt*' and 'ball_receipt' not in e and in_box(loc) and e.get('play_pattern', {}).get('name') in ('Regular Play', 'From Counter', 'From Goal Kick', 'From Keeper', 'From Kick Off'):
            code = 'tb'
        elif typ == 'Dribble' and e['dribble'].get('outcome', {}).get('name') == 'Complete' and loc and loc[0] >= 80:
            code = 'dr'
        elif typ == 'Pressure' and loc and loc[0] >= 80:
            code = 'pr'
        if code:
            extra.append({'match_id': mid, 'period': per, 't': round(t, 2), 'side': s, 'code': code})
        # corners
        if typ == 'Pass' and e['pass'].get('type', {}).get('name') == 'Corner':
            chain = [x for x in onball[-8:] if x.get('period') == per][::-1]
            cat, a, b = classify(chain, team)
            pa = a if a is not None else (chain[0] if chain else None)
            pid = a.get('possession') if a is not None else None
            P = poss.get(pid) if pid is not None else None
            if P is not None:
                P['corner'] += 1
            dloc = None
            if b is not None and b.get('location'):
                dloc = mirror(b['location'])
            elif a is not None:
                dloc = a.get('location')
            cross_y = a['location'][1] if (a is not None and a['type']['name'] == 'Pass' and a.get('location')) else None
            prev = last_ck.get((per, s))
            corners.append({
                'match_id': mid, 'league': league, 'period': per, 'minute': e['minute'], 't': round(t, 1), 'side': s,
                'cat': cat, 'pattern': pa.get('play_pattern', {}).get('name', '') if pa else '',
                'att_type': a['type']['name'] if a is not None else '', 'def_type': b['type']['name'] if b is not None else '',
                'def_detail': (b.get('clearance', {}).get('body_part', {}).get('name', '') if b is not None and b['type']['name'] == 'Clearance'
                               else b.get('goalkeeper', {}).get('type', {}).get('name', '') if b is not None and b['type']['name'] == 'Goal Keeper' else ''),
                'zone': zone(dloc), 'att_x': round(a['location'][0], 1) if a is not None and a.get('location') else '',
                'att_y': round(a['location'][1], 1) if a is not None and a.get('location') else '',
                'corner_y': round(loc[1], 1) if loc else '', 'cross_y': round(cross_y, 1) if cross_y is not None else '',
                'poss_n_pass': P['n_pass'] if P else '', 'poss_dur': round((a and ts(a['timestamp']) or t) - P['start_t'], 1) if P else '',
                'poss_start_x': P['start_x'] if P else '', 'score_diff': score[s] - score[1 - s],
                'since_prev': round(t - prev, 1) if prev is not None else '', 'gap_out_to_kick': round(t - ts(chain[0]['timestamp']), 1) if chain else ''})
            last_ck[(per, s)] = t
        if typ not in SKIP:
            onball.append(e)
    for P in poss.values():
        if P['counter_f3_t'] is not None:
            extra.append({'match_id': mid, 'period': P['period'], 't': round(P['counter_f3_t'], 2), 'side': P['side'], 'code': 'ct'})
        P['dur'] = round(P['end_t'] - P['start_t'], 1)
    plist = [{k: v for k, v in P.items() if k not in ('team', 'counter_f3_t', 'score_diff', 'end_t')} for P in poss.values()]
    return corners, plist, extra


if __name__ == '__main__':
    jobs = []
    for (cid, sid), lg in LEAGUES.items():
        for m in json.load(open(os.path.join(REPO, 'data', 'matches', str(cid), f'{sid}.json'), encoding='utf-8')):
            jobs.append((lg, m))
    os.makedirs(OUT, exist_ok=True)
    files = {k: open(os.path.join(OUT, k + '.csv'), 'w', newline='', encoding='utf-8') for k in ('corners', 'poss', 'ev_extra')}
    writers = {}
    done = 0
    with Pool(NP) as pool:
        for corners, plist, extra in pool.imap_unordered(process, jobs, chunksize=4):
            for k, rows in (('corners', corners), ('poss', plist), ('ev_extra', extra)):
                if not rows:
                    continue
                if k not in writers:
                    writers[k] = csv.DictWriter(files[k], fieldnames=list(rows[0].keys()))
                    writers[k].writeheader()
                writers[k].writerows(rows)
            done += 1
            if done % 100 == 0:
                print('done', done, flush=True)
    for f in files.values():
        f.close()
    print('matches', done)
