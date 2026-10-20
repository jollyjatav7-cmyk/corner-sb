"""Numbers for the corner-origin report. Usage: python3 -I origins_report.py <work2> <work3> <model_json> <out_json>"""
import json
import os
import sys
import numpy as np
import pandas as pd

W2, W3, MJ, OUT = sys.argv[1:5]
c = pd.read_csv(os.path.join(W3, 'corners.csv'))
p = pd.read_csv(os.path.join(W3, 'poss.csv'))
ev = pd.read_csv(os.path.join(W2, 'ev.csv'))
ex = pd.read_csv(os.path.join(W3, 'ev_extra.csv'))
mt = pd.read_csv(os.path.join(W2, 'mt.csv'))
mj = json.load(open(MJ))
N, NM = len(c), len(mt)
R = {'n_corners': N, 'n_matches': NM, 'per_match': round(N / NM, 2), 'leagues': mt.league.value_counts().to_dict()}

# ---------------------------------------------------------------- 1. how the ball went out
wide = (c.att_y < 18) | (c.att_y > 62)


def origin(r, w):
    k = r.cat
    if k == 'shot_saved':
        return ('shot', '射门被门将扑出底线')
    if k == 'shot_blocked':
        return ('shot', '射门被后卫封堵出底线')
    if k == 'shot_other':
        return ('shot', '射门其他（中柱弹出、折射等）')
    if k.startswith('cross_'):
        return ('cross', {'cross_head': '传中被头球顶出', 'cross_clear': '传中被脚下解围', 'cross_block': '传中出脚瞬间被封堵',
                          'cross_gk': '传中被门将击出/托出', 'cross_other': '传中其他（擦碰出界等）'}[k])
    if k in ('pass_block', 'pass_clear', 'pass_gk', 'pass_int', 'pass_other'):
        if w:
            return ('wide', {'pass_block': '边路低传/倒三角被封堵', 'pass_clear': '边路传球被解围', 'pass_int': '边路传球被拦截出界',
                             'pass_gk': '边路传球被门将处理出界', 'pass_other': '边路传球其他'}[k])
        return ('central', {'pass_block': '中路/禁区内传球被封堵', 'pass_clear': '中路传球被解围', 'pass_int': '直塞/中路传球被拦截出界',
                            'pass_gk': '直塞被门将处理出界', 'pass_other': '中路传球其他'}[k])
    if k == 'dribble':
        return ('duel', {'Dispossessed': '持球被断（抢断后出底线）', 'Dribble': '突破过人时被碰出底线', 'Duel': '对抗/争顶后出底线',
                         'Miscontrol': '停球失误后被防守方碰出'}[r.att_type])
    if k in ('from_corner', 'from_fk', 'from_ti'):
        return ('setpiece', {'from_corner': '角球第一点被顶出→又一个角球', 'from_fk': '任意球传中被顶出', 'from_ti': '界外球（含长传）被顶出'}[k])
    return ('def', '防守方自己处理失误（回传、解围不远等）')


og = [origin(r, w) for r, w in zip(c.itertuples(), wide)]
c['grp'], c['sub'] = [a for a, _ in og], [b for _, b in og]
GRP = {'shot': '射门后被扑/被挡', 'wide': '边路低传/倒三角（未算传中）被挡', 'cross': '传中被解围', 'duel': '突破/对抗/抢断',
       'central': '中路传球/直塞被挡或被截', 'setpiece': '定位球第一点被顶出', 'def': '防守方自身失误'}
grp = c.grp.value_counts()
R['groups'] = [{'key': k, 'name': GRP[k], 'n': int(v), 'pct': round(100 * v / N, 1),
                'subs': [{'name': s, 'n': int(n), 'pct': round(100 * n / N, 1)} for s, n in c[c.grp == k]['sub'].value_counts().items()]}
               for k, v in grp.items()]
# defensive touch
R['def_touch'] = [{'name': n, 'pct': round(100 * v / N, 1)} for n, v in c.def_type.replace({
    'Goal Keeper': '门将', 'Clearance': '解围', 'Block': '封堵', 'Duel': '对抗/抢断', 'Interception': '拦截', 'Ball Recovery': '拿球失误',
    'Pass': '传球失误', 'Miscontrol': '停球失误', '': '无'}).fillna('无').value_counts().items()]
cl = c[c.def_type == 'Clearance'].def_detail.value_counts()
R['clear_body'] = {'head': int(cl.get('Head', 0)), 'foot': int(cl.get('Right Foot', 0) + cl.get('Left Foot', 0)), 'other': int(cl.get('Other', 0))}
R['zone'] = [{'name': {'six': '小禁区', 'box': '大禁区（小禁区外）', 'wide_deep': '禁区两侧底线附近', 'edge': '禁区前沿', 'far': '更远', 'unknown': '未知'}[k],
              'pct': round(100 * v / N, 1)} for k, v in c.zone.value_counts().items()]

# ---------------------------------------------------------------- 2. which attacks: possession type
PAT = {'Regular Play': '阵地战/常规推进', 'From Throw In': '界外球发起', 'From Free Kick': '任意球发起', 'From Corner': '角球后的二次进攻',
       'From Goal Kick': '球门球发起', 'From Counter': '快速反击', 'From Keeper': '门将手抛/开球', 'From Kick Off': '开球', 'Other': '其他'}
pp = p[p.period.isin([1, 2])]
pat = []
for k, g in pp.groupby('pattern'):
    nck = int(c[c.pattern == k].shape[0])
    pat.append({'key': k, 'name': PAT.get(k, k), 'corners_pct': round(100 * nck / N, 1), 'poss_pct': round(100 * len(g) / len(pp), 1),
                'per100': round(100 * (g.corner > 0).mean(), 2), 'per100_f3': round(100 * (g[g.f3 == 1].corner > 0).mean(), 2),
                'per100_box': round(100 * (g[g.box == 1].corner > 0).mean(), 2), 'n_poss': int(len(g))})
R['patterns'] = sorted(pat, key=lambda x: -x['corners_pct'])
R['poss_overall'] = {'per100': round(100 * (pp.corner > 0).mean(), 2), 'per100_f3': round(100 * (pp[pp.f3 == 1].corner > 0).mean(), 2),
                     'per100_box': round(100 * (pp[pp.box == 1].corner > 0).mean(), 2),
                     'per100_cross': round(100 * (pp[pp.cross == 1].corner > 0).mean(), 2),
                     'per100_shot': round(100 * (pp[pp.shot == 1].corner > 0).mean(), 2)}
# set-piece starts high up the pitch
hi = pp[(pp.start_x >= 80)]
R['sp_high'] = {k: {'n': int(len(g)), 'per100': round(100 * (g.corner > 0).mean(), 2)} for k, g in hi.groupby('pattern') if len(g) > 300}
# possession length of corner-winning possessions vs all reaching the final third
cw = pp[pp.corner > 0]
f3 = pp[pp.f3 == 1]
R['poss_len'] = {'corner_med_pass': float(cw.n_pass.median()), 'corner_med_dur': float(cw.dur.median()),
                 'f3_med_pass': float(f3.n_pass.median()), 'f3_med_dur': float(f3.dur.median())}
bins = [-1, 2, 5, 10, 1000]
lab = ['0–2 脚', '3–5 脚', '6–10 脚', '10 脚以上']
f3b = f3.assign(b=pd.cut(f3.n_pass, bins, labels=lab))
R['by_len'] = [{'name': str(k), 'per100': round(100 * (g.corner > 0).mean(), 2), 'share_f3': round(100 * len(g) / len(f3), 1)}
               for k, g in f3b.groupby('b', observed=True)]
sx = f3.assign(b=pd.cut(f3.start_x, [-1, 40, 80, 121], labels=['本方后场', '中场', '前场'])).dropna(subset=['b'])
R['by_start'] = [{'name': str(k), 'per100': round(100 * (g.corner > 0).mean(), 2), 'share_f3': round(100 * len(g) / len(f3), 1)}
                 for k, g in sx.groupby('b', observed=True)]

# ---------------------------------------------------------------- 3. conversion per action (what one tap is worth)
cnt = ev.code.value_counts()
xc = ex.code.value_counts()
cats = c.cat.value_counts()
conv = [
    ('射门被扑', int(cnt['ss']), int(cats.get('shot_saved', 0))),
    ('射门被挡', int(cnt['sb']), int(cats.get('shot_blocked', 0))),
    ('射门偏出', int(cnt['so']), int(cats.get('shot_other', 0))),
    ('传中（全部）', int(cnt['co'] + cnt['cf']), int(c[c.grp == 'cross'].shape[0])),
]
R['conv'] = [{'name': a, 'n': n, 'corners': k, 'per100': round(100 * k / n, 1)} for a, n, k in conv]
# corner within the same possession after each kind of event (team-level)
R['conv_poss'] = [
    {'name': '进入前场的一次进攻', 'per100': R['poss_overall']['per100_f3']},
    {'name': '打进禁区的一次进攻', 'per100': R['poss_overall']['per100_box']},
    {'name': '有传中的一次进攻', 'per100': R['poss_overall']['per100_cross']},
    {'name': '有射门的一次进攻', 'per100': R['poss_overall']['per100_shot']},
]

# ---------------------------------------------------------------- 4. clustering (corner chains)
cs = c.sort_values(['match_id', 'period', 'side', 't'])
nxt = cs.groupby(['match_id', 'period', 'side']).t.shift(-1) - cs.t
R['chain'] = {'next_within_60': round(100 * (nxt <= 60).mean(), 1), 'next_within_180': round(100 * (nxt <= 180).mean(), 1),
              'from_corner_pattern_pct': round(100 * (c.pattern == 'From Corner').mean(), 1)}
# what Poisson would give: rate per team per minute in that half
team_rate = N / (2 * (mt.p1_len.sum() + mt.p2_len.sum()) / 60.0)
R['chain']['poisson_180'] = round(100 * (1 - np.exp(-team_rate * 3)), 1)
R['chain']['clu_factor'] = mj['base']['clu']
R['gap_out_to_kick_med'] = float(c.gap_out_to_kick.median())

# ---------------------------------------------------------------- 5. time and match state (fitted base model)
b = mj['base']
R['bins'] = b['bin']
R['home_factor'] = b['home']
R['state'] = dict(zip(['落后2球+', '落后1球', '平局', '领先1球', '领先2球+'], b['state']))
R['man'] = dict(zip(['少一人', '人数相同', '多一人'], b['man']))
c['home'] = c.side == 1
R['home_share'] = round(100 * c.home.mean(), 1)
R['half_split'] = {int(k): int(v) for k, v in c.period.value_counts().items()}
# per 15-minute rate (corners per minute per match), stoppage time apart
rows = []
for half in (1, 2):
    g = c[c.period == half]
    off = 45 if half == 2 else 0
    for a, z in [(0, 15), (15, 30), (30, 45), (45, 60)]:
        m = g[(g.minute - off >= a) & (g.minute - off < z)]
        L = mt.p1_len if half == 1 else mt.p2_len
        exposure = np.clip(L / 60.0 - a, 0, z - a).sum()
        if exposure > 0:
            rows.append({'half': half, 'from': a + off, 'to': z + off if z < 60 else None, 'rate90': round(len(m) / exposure * 90, 2)})
R['by_time'] = rows

# ---------------------------------------------------------------- 6. which match stats go with many corners (team-match level)
codes = pd.concat([ev, ex.replace({'code': {'pr': 'ps'}})])
tm = codes.groupby(['match_id', 'side', 'code']).size().unstack(fill_value=0)
tm['cr'] = tm.get('co', 0) + tm.get('cf', 0)
tm['sh'] = tm[['sb', 'ss', 'so', 'sg']].sum(axis=1)
tm['sbs'] = tm[['sb', 'ss']].sum(axis=1)
opp = tm.reset_index().assign(side=lambda d: 1 - d.side).set_index(['match_id', 'side'])
LAB = {'f3': '进入前场次数', 'bx': '进入禁区次数', 'cr': '传中次数', 'co': '传中到人', 'cf': '传中没到人', 'sh': '射门', 'sbs': '射门被扑/被挡',
       'ti': '前场界外球', 'fk': '前场任意球', 'cl': '对手后场解围', 'cb': '对手禁区内解围', 'tb': '禁区内接球', 'dr': '前场成功过人',
       'ps': '前场逼抢', 'ct': '反击打到前场'}
corr = []
for k, nm in LAB.items():
    if k in tm:
        corr.append({'key': k, 'name': nm, 'r_own': round(float(np.corrcoef(tm[k], tm['ck'])[0, 1]), 3),
                     'r_opp': round(float(np.corrcoef(opp.loc[tm.index, k], tm['ck'])[0, 1]), 3), 'mean': round(float(tm[k].mean()), 2)})
R['corr'] = sorted(corr, key=lambda x: -x['r_own'])
R['ck_mean_team'] = round(float(tm['ck'].mean()), 2)
json.dump(R, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(json.dumps(R, ensure_ascii=False, indent=1)[:9000])
