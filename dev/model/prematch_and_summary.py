"""Corner analysis on extracted StatsBomb tables.

Usage: python3 -I analyze.py <data_dir> <out_json>
"""
import json
import sys
import os
import numpy as np
import pandas as pd

D = sys.argv[1]
OUT = sys.argv[2]
ev = pd.read_csv(os.path.join(D, 'events.csv'))
mt = pd.read_csv(os.path.join(D, 'matches.csv'))
R = {}

LEAGUE_ZH = {'Premier League': '英超', 'La Liga': '西甲', 'Serie A': '意甲', 'Ligue 1': '法甲'}

# ---------- helpers ----------
ev['abs_min'] = ev['minute'] + ev['second'] / 60.0
corners = ev[ev.kind == 'corner'].copy()
corners = corners.merge(mt[['match_id', 'league', 'home', 'away']], on='match_id')
corners['side'] = np.where(corners.team == corners.home, 'home', 'away')

# ---------- 1. match totals ----------
cm = corners.groupby('match_id').size().rename('total')
ch = corners[corners.side == 'home'].groupby('match_id').size().rename('home_c')
ca = corners[corners.side == 'away'].groupby('match_id').size().rename('away_c')
m = mt.set_index('match_id').join([cm, ch, ca]).fillna({'total': 0, 'home_c': 0, 'away_c': 0})
m[['total', 'home_c', 'away_c']] = m[['total', 'home_c', 'away_c']].astype(int)
R['n_matches'] = int(len(m))
R['n_corners'] = int(m.total.sum())
R['mean_total'] = round(m.total.mean(), 2)
R['median_total'] = float(m.total.median())
R['sd_total'] = round(m.total.std(), 2)
R['p10_p90'] = [float(m.total.quantile(.1)), float(m.total.quantile(.9))]
R['home_mean'] = round(m.home_c.mean(), 2)
R['away_mean'] = round(m.away_c.mean(), 2)
R['dist'] = m.total.value_counts().sort_index().to_dict()
R['dist'] = {int(k): int(v) for k, v in R['dist'].items()}
R['over_lines'] = {f'{x}.5': round(float((m.total > x).mean() * 100), 1) for x in range(6, 14)}
R['by_league'] = []
for lg, g in m.groupby('league'):
    R['by_league'].append({'league': LEAGUE_ZH[lg], 'matches': int(len(g)), 'mean': round(g.total.mean(), 2),
                           'home': round(g.home_c.mean(), 2), 'away': round(g.away_c.mean(), 2),
                           'over9_5': round(float((g.total > 9).mean() * 100), 1)})

# ---------- 2. timing ----------
def bin_label(row):
    if row.period == 1:
        if row.minute >= 45:
            return '45+'
        b = int(row.minute // 5) * 5
        return f'{b}-{b+5}'
    else:
        if row.minute >= 90:
            return '90+'
        b = int(row.minute // 5) * 5
        return f'{b}-{b+5}'

order = [f'{b}-{b+5}' for b in range(0, 45, 5)] + ['45+'] + [f'{b}-{b+5}' for b in range(45, 90, 5)] + ['90+']
corners['bin'] = corners.apply(bin_label, axis=1)
cnt = corners.groupby('bin').size().reindex(order).fillna(0)
# minutes played in each bin (stoppage from actual period lengths)
st1 = ((m.p1_len / 60.0) - 45).clip(lower=0)
st2 = ((m.p2_len / 60.0) - 45).clip(lower=0)
mins = {b: 5.0 * len(m) for b in order}
mins['45+'] = float(st1.sum())
mins['90+'] = float(st2.sum())
R['stoppage_avg'] = [round(float(st1.mean()), 1), round(float(st2.mean()), 1)]
R['timing'] = [{'bin': b, 'corners': int(cnt[b]), 'per_match': round(cnt[b] / len(m), 3),
                'rate_per_10min': round(cnt[b] / mins[b] * 10, 3)} for b in order]
R['half_share'] = {'h1': int((corners.period == 1).sum()), 'h2': int((corners.period == 2).sum())}
R['overall_rate_per_10min'] = round(len(corners) / (m.p1_len.sum() / 60 + m.p2_len.sum() / 60) * 10, 3)

# ---------- 3. causes ----------
cz = {'shot_blocked': '射门被封堵', 'shot_saved': '射门被门将扑出', 'shot_other': '射门（其他）',
      'cross': '传中被挡出或解围', 'clearance': '对方大脚解围', 'block': '传球被挡出',
      'keeper': '门将出击处理', 'other': '突破或对抗中被破坏'}
cc = corners.detail.value_counts()
R['causes'] = [{'cause': cz.get(k, k), 'key': k, 'n': int(v), 'pct': round(v / len(corners) * 100, 1)} for k, v in cc.items()]

# ---------- 4. game state ----------
goals = ev[ev.kind == 'goal'].merge(mt[['match_id', 'home', 'away']], on='match_id')
goals['side'] = np.where(goals.team == goals.home, 'home', 'away')
state_expo = {}
state_corn = {}

def state_name(diff):
    if diff == 0:
        return '平局'
    if diff == 1:
        return '领先1球'
    if diff >= 2:
        return '领先2球+'
    if diff == -1:
        return '落后1球'
    return '落后2球+'

gby = {k: g.sort_values(['period', 't']) for k, g in goals.groupby('match_id')}
cby = {k: g for k, g in corners.groupby('match_id')}
for mid, row in m.iterrows():
    gl = gby.get(mid, pd.DataFrame(columns=goals.columns))
    cl = cby.get(mid, pd.DataFrame(columns=corners.columns))
    hs = as_ = 0
    for per, plen in ((1, row.p1_len), (2, row.p2_len)):
        gp = gl[gl.period == per]
        cuts = [0.0] + list(gp.t.values) + [plen]
        sides = list(gp.side.values)
        for k in range(len(cuts) - 1):
            a, b = cuts[k], cuts[k + 1]
            dur = max(b - a, 0) / 60.0
            for side, diff in (('home', hs - as_), ('away', as_ - hs)):
                s = state_name(diff)
                sel = cl[(cl.period == per) & (cl.side == side) & (cl.t >= a) & (cl.t < b if k < len(cuts) - 2 else cl.t <= b + 1)]
                for key in (s, (s, per)):
                    state_expo[key] = state_expo.get(key, 0) + dur
                    state_corn[key] = state_corn.get(key, 0) + len(sel)
            if k < len(sides):
                if sides[k] == 'home':
                    hs += 1
                else:
                    as_ += 1
st_order = ['落后2球+', '落后1球', '平局', '领先1球', '领先2球+']
R['game_state'] = [{'state': s, 'team_minutes': round(state_expo[s]), 'corners': int(state_corn[s]),
                    'rate_per_10min': round(state_corn[s] / state_expo[s] * 10, 3),
                    'rate_h1': round(state_corn[(s, 1)] / state_expo[(s, 1)] * 10, 3) if state_expo.get((s, 1)) else None,
                    'rate_h2': round(state_corn[(s, 2)] / state_expo[(s, 2)] * 10, 3) if state_expo.get((s, 2)) else None,
                    'minutes_h1': round(state_expo.get((s, 1), 0)), 'minutes_h2': round(state_expo.get((s, 2), 0))}
                   for s in st_order]

# ---------- 5. team strength ----------
pts = {}
for _, r in mt.iterrows():
    hp = 3 if r.home_score > r.away_score else (1 if r.home_score == r.away_score else 0)
    ap = 3 if r.away_score > r.home_score else (1 if r.home_score == r.away_score else 0)
    pts[(r.league, r.home)] = pts.get((r.league, r.home), 0) + hp
    pts[(r.league, r.away)] = pts.get((r.league, r.away), 0) + ap
m['hp'] = [pts[(lg, h)] for lg, h in zip(m.league, m.home)]
m['ap'] = [pts[(lg, a)] for lg, a in zip(m.league, m.away)]
m['strong_c'] = np.where(m.hp >= m.ap, m.home_c, m.away_c)
m['weak_c'] = np.where(m.hp >= m.ap, m.away_c, m.home_c)
m['gap'] = (m.hp - m.ap).abs()
R['strength'] = {'strong_mean': round(m.strong_c.mean(), 2), 'weak_mean': round(m.weak_c.mean(), 2)}
bins = [-1, 10, 25, 45, 200]
labels = ['0-10分', '11-25分', '26-45分', '46分+']
m['gap_bin'] = pd.cut(m.gap, bins=bins, labels=labels)
R['strength_gap'] = []
for lb, g in m.groupby('gap_bin', observed=True):
    R['strength_gap'].append({'gap': lb, 'matches': int(len(g)), 'total': round(g.total.mean(), 2),
                              'strong': round(g.strong_c.mean(), 2), 'weak': round(g.weak_c.mean(), 2)})

# ---------- 6. clustering ----------
cs = corners.sort_values(['match_id', 'period', 't'])
lam = R['overall_rate_per_10min'] / 10.0  # corners per minute, both teams
nxt_any, nxt_same, n_base = 0, 0, 0
for (mid, per), g in cs.groupby(['match_id', 'period']):
    plen = m.loc[mid, 'p1_len'] if per == 1 else m.loc[mid, 'p2_len']
    ts = g.t.values
    tm = g.team.values
    for i in range(len(ts)):
        if ts[i] + 180 > plen:
            continue
        n_base += 1
        later = [(ts[j], tm[j]) for j in range(i + 1, len(ts)) if ts[j] - ts[i] <= 180]
        if later:
            nxt_any += 1
        if any(t_ == tm[i] for _, t_ in later):
            nxt_same += 1
base_any = 1 - np.exp(-lam * 3)
R['cluster'] = {'n': n_base, 'p_any_3min': round(nxt_any / n_base * 100, 1), 'p_same_3min': round(nxt_same / n_base * 100, 1),
                'baseline_any_3min': round(base_any * 100, 1), 'baseline_same_3min': round((1 - np.exp(-lam / 2 * 3)) * 100, 1)}

# ---------- 7. early corners vs final total ----------
early = corners[(corners.period == 1) & (corners.minute < 10)].groupby('match_id').size()
m['early10'] = early.reindex(m.index).fillna(0).astype(int)
early6 = corners[(corners.period == 1) & (corners.minute < 6)].groupby('match_id').size()
m['early6'] = early6.reindex(m.index).fillna(0).astype(int)
R['early10'] = []
for k, g in m.groupby(m.early10.clip(upper=3)):
    R['early10'].append({'early': f'{k}' + ('+' if k == 3 else ''), 'matches': int(len(g)), 'final_mean': round(g.total.mean(), 2),
                         'rest_mean': round((g.total - g.early10).mean(), 2), 'over9_5': round(float((g.total > 9).mean() * 100), 1)})
R['early6'] = {'with': round(m[m.early6 > 0].total.mean(), 2), 'without': round(m[m.early6 == 0].total.mean(), 2),
               'with_rest': round((m[m.early6 > 0].total - m[m.early6 > 0].early6).mean(), 2),
               'without_rest': round(m[m.early6 == 0].total.mean(), 2),
               'n_with': int((m.early6 > 0).sum())}

# ---------- 8. halftime predictors of 2H corners ----------
def per_match_half(kind, per, extra=None):
    s = ev[(ev.kind == kind) & (ev.period == per)]
    if extra is not None:
        s = s[extra(s)]
    return s.groupby('match_id').size().reindex(m.index).fillna(0)

h1 = pd.DataFrame(index=m.index)
h1['corners'] = per_match_half('corner', 1)
h1['shots'] = per_match_half('shot', 1)
h1['blocked_or_saved'] = per_match_half('shot', 1, lambda s: s.detail.isin(['Blocked', 'Saved', 'Saved To Post', 'Saved Off T']))
h1['crosses'] = per_match_half('cross', 1)
h1['box_entries'] = per_match_half('box_entry', 1)
h1['f3_entries'] = per_match_half('f3_entry', 1)
y = per_match_half('corner', 2)
R['h2_mean'] = round(float(y.mean()), 2)

def r2(cols):
    X = np.column_stack([np.ones(len(h1))] + [h1[c].values for c in cols])
    beta, *_ = np.linalg.lstsq(X, y.values, rcond=None)
    pred = X @ beta
    return 1 - ((y.values - pred) ** 2).sum() / ((y.values - y.mean()) ** 2).sum(), beta

name_zh = {'corners': '上半场角球数', 'shots': '上半场射门数', 'blocked_or_saved': '上半场被挡/被扑射门',
           'crosses': '上半场运动战传中', 'box_entries': '上半场进入禁区次数', 'f3_entries': '上半场进入前场三分之一次数'}
R['ht_single'] = []
for c in name_zh:
    rr, _ = r2([c])
    corr = float(np.corrcoef(h1[c], y)[0, 1])
    R['ht_single'].append({'feature': name_zh[c], 'key': c, 'corr': round(corr, 3), 'r2': round(rr * 100, 1),
                           'h1_mean': round(float(h1[c].mean()), 1)})
rr_all, beta_all = r2(['corners', 'crosses', 'box_entries', 'shots'])
rr_c, _ = r2(['corners'])
R['ht_combined'] = {'r2_corners_only': round(rr_c * 100, 1), 'r2_combined': round(rr_all * 100, 1)}

# ---------- 9. 15-minute windows, team level: activity -> next-window corners ----------
def win(row):
    if row.period == 1:
        return min(int(row.minute // 15), 2)
    return 3 + min(int((row.minute - 45) // 15), 2)

ev2 = ev.merge(mt[['match_id', 'home', 'away']], on='match_id')
ev2['w'] = ev2.apply(win, axis=1)
ev2['side'] = np.where(ev2.team == ev2.home, 'home', 'away')
kinds = ['corner', 'cross', 'box_entry', 'shot', 'f3_entry']
tab = ev2[ev2.kind.isin(kinds)].groupby(['match_id', 'side', 'w', 'kind']).size().unstack('kind').fillna(0)
idx = pd.MultiIndex.from_product([m.index, ['home', 'away'], range(6)], names=['match_id', 'side', 'w'])
tab = tab.reindex(idx).fillna(0)
tab = tab.reset_index()
tab['next_corners'] = tab.groupby(['match_id', 'side']).corner.shift(-1)
pairs = tab.dropna(subset=['next_corners'])
pairs = pairs[pairs.w != 2]  # don't bridge half-time
R['window_corr'] = []
for k, zh in (('corner', '本时段角球'), ('cross', '本时段传中'), ('box_entry', '本时段进入禁区'),
              ('shot', '本时段射门'), ('f3_entry', '本时段进入前场')):
    R['window_corr'].append({'feature': zh, 'key': k, 'corr': round(float(np.corrcoef(pairs[k], pairs.next_corners)[0, 1]), 3)})
# tercile table for box entries
q = pd.qcut(pairs.box_entry.rank(method='first'), 4, labels=['最少25%', '较少', '较多', '最多25%'])
R['box_quartiles'] = []
for lb, g in pairs.groupby(q, observed=True):
    R['box_quartiles'].append({'group': lb, 'box_range': f'{int(g.box_entry.min())}-{int(g.box_entry.max())}',
                               'next_corners': round(float(g.next_corners.mean()), 2), 'n': int(len(g))})
q2 = pd.qcut(pairs.cross.rank(method='first'), 4, labels=['最少25%', '较少', '较多', '最多25%'])
R['cross_quartiles'] = []
for lb, g in pairs.groupby(q2, observed=True):
    R['cross_quartiles'].append({'group': lb, 'cross_range': f'{int(g.cross.min())}-{int(g.cross.max())}',
                                 'next_corners': round(float(g.next_corners.mean()), 2), 'n': int(len(g))})

# ---------- 10. corners -> shots / goals ----------
shots = ev[ev.kind == 'shot']
R['from_corner'] = {
    'shots_from_corner_pattern': int((shots.pattern == 'From Corner').sum()),
    'goals_from_corner_pattern': int(((shots.pattern == 'From Corner') & (shots.detail == 'Goal')).sum()),
    'all_goals': int((ev.kind == 'goal').sum()),
}
R['from_corner']['goals_per_100_corners'] = round(R['from_corner']['goals_from_corner_pattern'] / len(corners) * 100, 1)
R['from_corner']['share_of_goals'] = round(R['from_corner']['goals_from_corner_pattern'] / R['from_corner']['all_goals'] * 100, 1)

# ---------- 11. pre-match team profile (leave-one-out season averages) ----------
rows = []
for mid, r in m.iterrows():
    rows.append({'match_id': mid, 'league': r.league, 'team': r.home, 'for': r.home_c, 'against': r.away_c})
    rows.append({'match_id': mid, 'league': r.league, 'team': r.away, 'for': r.away_c, 'against': r.home_c})
tf = pd.DataFrame(rows)
agg = tf.groupby(['league', 'team']).agg(n=('for', 'size'), f=('for', 'sum'), a=('against', 'sum'))

def loo(lg, team, mid, col):
    g = agg.loc[(lg, team)]
    row = tf[(tf.match_id == mid) & (tf.team == team)].iloc[0]
    return (g[col] - row['for' if col == 'f' else 'against']) / (g.n - 1)

exp_home, exp_away = [], []
for mid, r in m.iterrows():
    exp_home.append((loo(r.league, r.home, mid, 'f') + loo(r.league, r.away, mid, 'a')) / 2)
    exp_away.append((loo(r.league, r.away, mid, 'f') + loo(r.league, r.home, mid, 'a')) / 2)
m['exp_total'] = np.array(exp_home) + np.array(exp_away)
R['prematch_corr'] = round(float(np.corrcoef(m.exp_total, m.total)[0, 1]), 3)
R['prematch_r2'] = round(float(np.corrcoef(m.exp_total, m.total)[0, 1] ** 2 * 100), 1)
eb = pd.cut(m.exp_total, bins=[0, 9, 10, 11, 12, 99], labels=['低于9', '9-10', '10-11', '11-12', '12以上'])
R['prematch_buckets'] = []
for lb, g in m.groupby(eb, observed=True):
    R['prematch_buckets'].append({'exp': lb, 'matches': int(len(g)), 'actual_mean': round(g.total.mean(), 2),
                                  'over9_5': round(float((g.total > 9).mean() * 100), 1)})
# combined halftime model: pre-match expectation + first-half stats -> second-half corners
h1['exp_total'] = m.exp_total
rr_pre, _ = r2(['exp_total'])
rr_pre_c, _ = r2(['exp_total', 'corners'])
rr_pre_all, _ = r2(['exp_total', 'corners', 'box_entries', 'crosses', 'shots'])
R['ht_with_prematch'] = {'r2_prematch_only': round(rr_pre * 100, 1), 'r2_prematch_plus_h1_corners': round(rr_pre_c * 100, 1),
                         'r2_prematch_plus_all_h1': round(rr_pre_all * 100, 1)}
R['h1_h2_corr'] = round(float(np.corrcoef(h1.corners, y)[0, 1]), 3)

json.dump(R, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
m.reset_index().to_csv(os.path.join(D, 'match_summary.csv'), index=False)
print(json.dumps(R, ensure_ascii=False, indent=1))
