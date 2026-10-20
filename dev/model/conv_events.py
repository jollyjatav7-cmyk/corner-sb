"""Corner conversion of the three biggest corner sources: shots, low balls from the wing, cut-backs.

One row per event (StatsBomb 2015/16, EPL / La Liga / Serie A / Ligue 1, 1,517 matches) with what happened next
(corner, goal, goal kick, defenders took the ball, attackers kept the ball ...) and the situation:
score state of the attacking team, minute, home/away, both teams' season strength, location, body part.

Event definitions
  shot      every shot except penalties
  low       open-play pass from the wing in the last third (x >= 90, y < 18 or y > 62), played along the ground or
            low (StatsBomb height Ground Pass / Low Pass), going toward goal or inside (not a cut-back)
  high      the same from the wing but lofted (High Pass) - for comparison
  cutback   open-play pass marked cut_back by StatsBomb (pulled back from near the byline)
A corner counts for an event when the corner's last attacking touch (same rule as extract3.py) is that event.

Usage: python3 -I conv_events.py <statsbomb_repo> <out_csv> <n_procs>
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
SAVED = {'Saved', 'Saved Off T', 'Saved To Post', 'Saved Off Target', 'Saved to Post'}   # StatsBomb spells the last two this way


def ts(e):
    h, m, x = e['timestamp'].split(':')
    return int(h) * 3600 + int(m) * 60 + float(x)


def last_attack(chain, A):
    """Same rule as extract3.classify: the attacking team's last on-ball action before the corner, unless the
    defending side had the ball under control in between."""
    for e in chain:
        team = e.get('team', {}).get('name')
        typ = e['type']['name']
        if team != A:
            if typ == 'Pass' and 'outcome' not in e['pass']:
                return None
            continue
        if typ in ATTACK:
            return e
    return None


def first_def_touch(ev, i, A):
    """Type of the opponent's first on-ball event within 2 s after event i (None if the attackers touch it first)."""
    t0 = ts(ev[i])
    for x in ev[i + 1:i + 8]:
        if ts(x) - t0 > 2:
            return None
        typ = x['type']['name']
        if typ in ('Ball Receipt*', 'Pressure'):
            continue
        return typ if x.get('team', {}).get('name') != A else None
    return None


def outcome(ev, i, A, corner_src):
    """What happened right after event i of team A: the first decisive event (look up to 90 s ahead, restarts can be slow)."""
    e = ev[i]
    if e['type']['name'] == 'Shot' and e['shot']['outcome']['name'] == 'Goal':
        return 'goal'
    if e['id'] in corner_src:
        return 'corner'
    t0, per = ts(e), e['period']
    for j in range(i + 1, min(i + 60, len(ev))):
        x = ev[j]
        if x.get('period') != per or ts(x) - t0 > 90:
            break
        typ = x['type']['name']
        team = x.get('team', {}).get('name')
        if typ == 'Pass':
            pt = x['pass'].get('type', {}).get('name')
            if pt == 'Goal Kick':
                return 'goal_kick'
            if pt == 'Throw-in':
                return 'throw_in'
            if pt == 'Corner':
                return 'corner_later'      # a corner came, but from a later touch
            if pt in ('Free Kick', 'Kick Off'):
                return 'free_kick'
            return 'keep' if team == A else 'lost'
        if typ in ('Shot', 'Carry', 'Dribble'):
            return 'keep' if team == A else 'lost'
        if typ == 'Goal Keeper':
            gt = x.get('goalkeeper', {}).get('type', {}).get('name', '')
            go = x.get('goalkeeper', {}).get('outcome', {}).get('name', '')
            if gt in ('Collected', 'Keeper Sweeper') and go in ('Success', 'Claim', 'Collected Twice', 'Clear', ''):
                return 'lost'
            if gt in ('Shot Saved', 'Save', 'Smother') and go in ('Success', 'Collected Twice', 'Success In Play'):
                return 'lost'
            continue
        if typ == 'Ball Recovery' and not x.get('ball_recovery', {}).get('recovery_failure'):
            return 'keep' if team == A else 'lost'
    return 'unclear'


def process(job):
    league, m, strength = job
    mid = m['match_id']
    path = os.path.join(REPO, 'data', 'events', f'{mid}.json')
    if not os.path.exists(path):
        return []
    ev = json.load(open(path, encoding='utf-8'))
    home = m['home_team']['home_team_id']        # ids: the event files and the match list do not always spell names alike
    away = m['away_team']['away_team_id']
    names = {home: m['home_team']['home_team_name'], away: m['away_team']['away_team_name']}
    # pass 1: which events produced corners (the corner's last attacking touch)
    corner_src = set()
    onball = []
    for e in ev:
        if e.get('period') not in (1, 2):
            continue
        typ = e['type']['name']
        if typ == 'Pass' and e['pass'].get('type', {}).get('name') == 'Corner':
            chain = [x for x in onball[-8:] if x.get('period') == e['period']][::-1]
            a = last_attack(chain, e.get('team', {}).get('name'))
            if a is not None:
                corner_src.add(a['id'])
        if typ not in SKIP:
            onball.append(e)
    # pass 2: candidate events with situation and outcome
    rows = []
    score = {home: 0, away: 0}
    reds = {home: 0, away: 0}
    for i, e in enumerate(ev):
        per = e.get('period')
        if per not in (1, 2):
            continue
        typ = e['type']['name']
        team = e.get('team', {}).get('name')
        tid = e.get('team', {}).get('id')
        if typ == 'Bad Behaviour' and e.get('bad_behaviour', {}).get('card', {}).get('name') in ('Red Card', 'Second Yellow'):
            reds[tid] = reds.get(tid, 0) + 1
        if typ == 'Foul Committed' and e.get('foul_committed', {}).get('card', {}).get('name') in ('Red Card', 'Second Yellow'):
            reds[tid] = reds.get(tid, 0) + 1
        kind = None
        loc = e.get('location')
        extra = {}
        if typ == 'Shot' and e['shot'].get('type', {}).get('name') != 'Penalty':
            kind = 'shot'
            oc = e['shot']['outcome']['name']
            extra['shot_res'] = 'blocked' if oc == 'Blocked' else 'saved' if oc in SAVED else 'goal' if oc == 'Goal' else 'off'
            extra['body'] = 'head' if e['shot'].get('body_part', {}).get('name') == 'Head' else 'foot'
            extra['set_piece'] = 1 if e['shot'].get('type', {}).get('name') == 'Free Kick' or e.get('play_pattern', {}).get('name') in ('From Corner', 'From Free Kick') else 0
        elif typ == 'Pass' and loc:
            p = e['pass']
            if p.get('type', {}).get('name') in SET_PIECE:
                pass
            elif p.get('cut_back'):
                kind = 'cutback'
            else:
                en = p.get('end_location') or loc
                wide = loc[0] >= 90 and (loc[1] < 18 or loc[1] > 62)
                into_box = en[0] >= 102 and 18 <= en[1] <= 62
                # a blocked or cut-out delivery ends where the defender touched it, often still out wide
                stopped = 'outcome' in p and first_def_touch(ev, i, team) in ('Block', 'Clearance', 'Interception', 'Goal Keeper')
                inward = abs(en[1] - 40) < abs(loc[1] - 40) - 1 or p.get('cross')
                if wide and inward and (into_box or stopped):
                    h = p.get('height', {}).get('name')
                    kind = 'low' if h in ('Ground Pass', 'Low Pass') else 'high'
            if kind:
                extra['reached'] = 1 if 'outcome' not in p else 0
                extra['pressured'] = 1 if e.get('under_pressure') else 0
        opp = away if tid == home else home
        sd = score.get(tid, 0) - score.get(opp, 0)          # score before this event
        if (typ == 'Shot' and e['shot']['outcome']['name'] == 'Goal') or typ == 'Own Goal For':
            score[tid] = score.get(tid, 0) + 1
        if typ == 'Pass' and e['pass'].get('type', {}).get('name') == 'Corner':
            kind = 'corner_evt'          # the corners themselves (for "busy spells without a corner")
        if not kind:
            continue
        res = outcome(ev, i, team, corner_src) if kind != 'corner_evt' else ''
        x, y = loc
        zone = ('box_c' if x >= 102 and 30 <= y <= 50 else 'box_w' if x >= 102 and 18 <= y <= 62 else 'outside') if kind == 'shot' else \
               ('byline' if x >= 108 else 'deep')
        rows.append({'match_id': mid, 'league': league, 'period': per, 'minute': e['minute'], 't': round(ts(e), 1), 'kind': kind, 'team': names[tid], 'opp': names[opp],
                     'home': 1 if tid == home else 0, 'score_diff': sd, 'man_diff': reds.get(opp, 0) - reds.get(tid, 0),
                     'str_att': strength[(league, tid)], 'str_def': strength[(league, opp)], 'zone': zone,
                     'x': round(x, 1), 'y': round(y, 1), 'res': res, 'corner': 1 if res == 'corner' else 0,
                     'shot_res': extra.get('shot_res', ''), 'body': extra.get('body', ''), 'set_piece': extra.get('set_piece', ''),
                     'reached': extra.get('reached', ''), 'pressured': extra.get('pressured', '')})
    return rows


if __name__ == '__main__':
    jobs, table = [], {}
    for (cid, sid), lg in LEAGUES.items():
        ms = json.load(open(os.path.join(REPO, 'data', 'matches', str(cid), f'{sid}.json'), encoding='utf-8'))
        for m in ms:
            h, a = m['home_team']['home_team_id'], m['away_team']['away_team_id']
            for t, gf, ga in ((h, m['home_score'], m['away_score']), (a, m['away_score'], m['home_score'])):
                r = table.setdefault((lg, t), [0, 0])
                r[0] += gf - ga
                r[1] += 1
        jobs += [(lg, m) for m in ms]
    strength = {k: v[0] / v[1] for k, v in table.items()}   # season goal difference per game
    jobs = [(lg, m, strength) for lg, m in jobs]
    n = 0
    with open(OUT, 'w', newline='', encoding='utf-8') as f, Pool(NP) as pool:
        w = None
        for rows in pool.imap_unordered(process, jobs, chunksize=4):
            if rows:
                if w is None:
                    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                    w.writeheader()
                w.writerows(rows)
            n += 1
            if n % 200 == 0:
                print('done', n, flush=True)
    print('matches', n)
