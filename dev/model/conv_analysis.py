"""Does the corner conversion of shots, low balls from the wing and cut-backs change with the situation or the team?
Input: conv_events.csv (conv_events.py) and corners.csv (extract3.py).
Usage: python3 -I conv_analysis.py <conv_events.csv> <corners.csv> <out_json>
"""
import json
import sys
import numpy as np
import pandas as pd
from scipy.stats import chi2, norm

EV, CK, OUT = sys.argv[1:4]
d = pd.read_csv(EV)
ck = pd.read_csv(CK)
R = {'n_matches': int(d.match_id.nunique())}
KINDS = ['shot', 'low', 'cutback', 'high']
NAME = {'shot': '射门', 'low': '边路低平球', 'cutback': '倒三角', 'high': '边路高球传中'}

# ---------------------------------------------------------------- labels
d['state'] = pd.cut(d.score_diff, [-9, -2, -1, 0, 1, 9], labels=['落后2球+', '落后1球', '平局', '领先1球', '领先2球+'])
def tbin(r):
    m = r.minute
    if r.period == 1:
        return '0–15' if m < 15 else '15–30' if m < 30 else '30–45+'
    return '45–60' if m < 60 else '60–75' if m < 75 else '75–90+'
d['tbin'] = d.apply(tbin, axis=1)
q = np.quantile(pd.concat([d.drop_duplicates(['league', 'team']).str_att]), [1 / 3, 2 / 3])
tier = lambda v: np.where(v >= q[1], '强队', np.where(v <= q[0], '弱队', '中游'))
d['att_tier'] = tier(d.str_att)
d['def_tier'] = tier(d.str_def)
gap = d.str_att - d.str_def
d['match_up'] = np.where(gap >= 0.5, '明显占优', np.where(gap <= -0.5, '明显处下风', '实力接近'))
d['half'] = np.where(d.period == 1, '上半场', '下半场')
d['side'] = np.where(d.home == 1, '主场', '客场')
R['tier_cut'] = [round(float(x), 2) for x in q]

# ---------------------------------------------------------------- 1. overall and what happens next
RES = {'corner': '角球', 'goal': '进球', 'goal_kick': '球门球（多为射偏）', 'lost': '对方拿到球（门将没收、后卫解围后控制）',
       'keep': '本队继续控球（到人或抢到第二点）', 'throw_in': '界外球', 'free_kick': '任意球', 'corner_later': '角球（但来自之后的动作）', 'unclear': '其他'}
R['overall'] = {}
for k in KINDS:
    g = d[d.kind == k]
    R['overall'][k] = {'n': int(len(g)), 'per_team_match': round(len(g) / (2 * R['n_matches']), 2), 'conv': round(100 * g.corner.mean(), 1),
                       'next': {RES[r]: round(100 * v, 1) for r, v in g.res.value_counts(normalize=True).items()}}
s = d[d.kind == 'shot']
R['shot_by_result'] = {r: {'n': int(len(g)), 'conv': round(100 * g.corner.mean(), 1)} for r, g in s.groupby('shot_res')}
R['shot_share'] = {r: round(100 * v, 1) for r, v in s.shot_res.value_counts(normalize=True).items()}

# ---------------------------------------------------------------- 2. by situation (raw), chi-square test
def table(g, col, order=None):
    out = []
    levels = order or sorted(g[col].dropna().unique())
    for lv in levels:
        x = g[g[col] == lv]
        if len(x) < 30:
            continue
        p = x.corner.mean()
        se = np.sqrt(p * (1 - p) / len(x))
        out.append({'level': str(lv), 'n': int(len(x)), 'conv': round(100 * p, 1), 'lo': round(100 * (p - 1.96 * se), 1), 'hi': round(100 * (p + 1.96 * se), 1)})
    ct = pd.crosstab(g[col], g.corner)
    exp = np.outer(ct.sum(axis=1), ct.sum(axis=0)) / ct.values.sum()
    stat = float(((ct.values - exp) ** 2 / exp).sum())
    return {'rows': out, 'p': float(chi2.sf(stat, (ct.shape[0] - 1) * (ct.shape[1] - 1)))}

FACT = [('state', ['落后2球+', '落后1球', '平局', '领先1球', '领先2球+']), ('tbin', ['0–15', '15–30', '30–45+', '45–60', '60–75', '75–90+']),
        ('half', ['上半场', '下半场']), ('side', ['主场', '客场']), ('att_tier', ['强队', '中游', '弱队']), ('def_tier', ['强队', '中游', '弱队']),
        ('match_up', ['明显占优', '实力接近', '明显处下风'])]
R['by'] = {}
for k in KINDS:
    g = d[d.kind == k]
    R['by'][k] = {f: table(g, f, o) for f, o in FACT}
    R['by'][k]['zone'] = table(g, 'zone')
    if k == 'shot':
        R['by'][k]['body'] = table(g, 'body')
        # among shots that hit someone (blocked or saved): is the situation still different?
        hit = g[g.shot_res.isin(['blocked', 'saved'])]
        R['by']['shot_hit'] = {f: table(hit, f, o) for f, o in FACT}
        R['by']['shot_hit']['zone'] = table(hit, 'zone')
        R['by']['shot_hit']['shot_res'] = table(hit, 'shot_res')
        R['by']['shot_mix'] = {f: {str(lv): {r: round(100 * v, 1) for r, v in x.shot_res.value_counts(normalize=True).items()}
                                   for lv, x in g.groupby(f, observed=True)} for f, _ in FACT[:2]}
        R['by']['shot_mix']['zone_by_state'] = {str(lv): {r: round(100 * v, 1) for r, v in x.zone.value_counts(normalize=True).items()}
                                                for lv, x in g.groupby('state', observed=True)}
    else:
        R['by'][k]['pressured'] = table(g, 'pressured')

# ---------------------------------------------------------------- 3. adjusted (logistic regression): situation effects with location etc. held fixed
def logit(X, y, it=50):
    b = np.zeros(X.shape[1])
    for _ in range(it):
        p = 1 / (1 + np.exp(-X @ b))
        W = p * (1 - p)
        H = X.T @ (X * W[:, None]) + 1e-6 * np.eye(X.shape[1])
        step = np.linalg.solve(H, X.T @ (y - p))
        b += step
        if np.abs(step).max() < 1e-8:
            break
    p = 1 / (1 + np.exp(-X @ b))
    ll = float(np.sum(y * np.log(p + 1e-12) + (1 - y) * np.log(1 - p + 1e-12)))
    H = X.T @ (X * (p * (1 - p))[:, None])
    return b, np.sqrt(np.diag(np.linalg.inv(H))), ll

def design(g, k, drop=None):
    cols, names = [np.ones(len(g))], ['c']
    def dummies(col, base, levels):
        for lv in levels:
            if lv != base and 0 < (g[col] == lv).sum() < len(g):
                cols.append((g[col] == lv).astype(float).values); names.append(f'{col}={lv}')
    groups = {}
    blocks = [('state', '平局', FACT[0][1]), ('tbin', '0–15', FACT[1][1])]
    if k == 'shot':
        blocks += [('zone', 'box_c', ['box_c', 'box_w', 'outside']), ('body', 'foot', ['foot', 'head'])]
    else:
        blocks += [('zone', 'deep', ['deep', 'byline'])]
    for col, base, lv in blocks:
        if col == drop:
            continue
        n0 = len(names); dummies(col, base, lv); groups[col] = list(range(n0, len(names)))
    for col in ('home', 'str_att', 'str_def') + (('set_piece',) if k == 'shot' else ('pressured',)):
        if col == drop or (drop == 'strength' and col.startswith('str')):
            continue
        cols.append(g[col].astype(float).values); names.append(col); groups[col] = [len(names) - 1]
    return np.column_stack(cols), names, groups

R['adjusted'] = {}
for k in KINDS + ['shot_hit']:
    g = d[d.kind == 'shot'] if k == 'shot_hit' else d[d.kind == k]
    if k == 'shot_hit':
        g = g[g.shot_res.isin(['blocked', 'saved'])]
    kk = 'shot' if k == 'shot_hit' else k
    X, names, groups = design(g, kk)
    y = g.corner.values.astype(float)
    b, se, ll = logit(X, y)
    out = {'n': int(len(g)), 'or': {n: {'or': round(float(np.exp(bb)), 2), 'lo': round(float(np.exp(bb - 1.96 * s)), 2), 'hi': round(float(np.exp(bb + 1.96 * s)), 2),
                                        'p': round(float(2 * norm.sf(abs(bb / s))), 4)} for n, bb, s in zip(names, b, se) if n != 'c'}, 'lr_p': {}}
    for f in ('state', 'tbin', 'strength', 'home', 'zone'):
        X0, _, _ = design(g, kk, drop=f)
        _, _, ll0 = logit(X0, y)
        df = X.shape[1] - X0.shape[1]
        out['lr_p'][f] = round(float(chi2.sf(2 * (ll - ll0), df)), 4) if df > 0 else None
    R['adjusted'][k] = out

# ---------------------------------------------------------------- 4. teams: do some teams convert (or concede) more than chance allows?
def hetero(g, col):
    t = g.groupby(['league', col]).corner.agg(['sum', 'count'])
    p = g.corner.mean()
    n, k = t['count'].values, t['sum'].values
    stat = float(np.sum((k - n * p) ** 2 / (n * p * (1 - p))))
    T = len(t)
    Q = float(np.sum(n * (k / n - p) ** 2))
    denom = n.sum() - np.sum(n ** 2) / n.sum()
    tau2 = max(0.0, (Q - (T - 1) * p * (1 - p)) / denom)
    # split-half: odd vs even matches of the same team
    g2 = g.assign(h=(g.match_id.rank(method='dense').astype(int) % 2))
    sp = g2.groupby(['league', col, 'h']).corner.mean().unstack()
    r = float(sp[0].corr(sp[1]))
    rates = (k / n)
    shrunk = p + (rates - p) * (tau2 / (tau2 + p * (1 - p) / n)) if tau2 > 0 else np.full(T, p)
    order = np.argsort(shrunk)
    teams = [f'{a[1]}' for a in t.index]
    return {'teams': T, 'p_mean': round(100 * p, 1), 'chi2_p': float(chi2.sf(stat, T - 1)), 'sd_true_pts': round(100 * np.sqrt(tau2), 2),
            'range80': [round(100 * (p - 1.2816 * np.sqrt(tau2)), 1), round(100 * (p + 1.2816 * np.sqrt(tau2)), 1)],
            'split_half_r': round(r, 2), 'raw_min_max': [round(100 * float(rates.min()), 1), round(100 * float(rates.max()), 1)],
            'low': [(teams[i], round(100 * float(shrunk[i]), 1), int(n[i])) for i in order[:4]],
            'high': [(teams[i], round(100 * float(shrunk[i]), 1), int(n[i])) for i in order[::-1][:4]]}

R['teams'] = {}
for k in KINDS + ['shot_hit']:
    g = d[d.kind == 'shot'] if k == 'shot_hit' else d[d.kind == k]
    if k == 'shot_hit':
        g = g[g.shot_res.isin(['blocked', 'saved'])]
    R['teams'][k] = {'attacking': hetero(g, 'team'), 'defending': hetero(g, 'opp')}

# ---------------------------------------------------------------- 5. busy spells: 5+ shots / low balls / cut-backs within 10 minutes
three = d[d.kind.isin(['shot', 'low', 'cutback'])].copy()
p_kind = three.groupby('kind').corner.mean().to_dict()
ckk = d[d.kind == 'corner_evt']
ckidx = {key: np.sort(g.t.values) for key, g in ckk.groupby(['match_id', 'period', 'home'])}
spells = []
for (mid, per, home), g in three.sort_values('t').groupby(['match_id', 'period', 'home']):
    tt = g.t.values
    i = 0
    while i < len(tt):
        j = np.searchsorted(tt, tt[i] + 600, side='right')
        if j - i >= 5:
            w = g.iloc[i:j]
            cts = ckidx.get((mid, per, home), np.array([]))
            n_ck = int(((cts >= tt[i]) & (cts <= tt[i] + 630)).sum())
            sh = w[w.kind == 'shot']
            spells.append({'n': j - i, 'n_shot': int(len(sh)), 'n_low': int((w.kind == 'low').sum()), 'n_cut': int((w.kind == 'cutback').sum()),
                           'ck_from_these': int(w.corner.sum()), 'ck_any': n_ck,
                           'p0_kind': float(np.prod([1 - p_kind[x] for x in w.kind])),
                           'sh_off_goal': float(sh.shot_res.isin(['off', 'goal']).mean()) if len(sh) else np.nan,
                           'sh_outside': float((sh.zone == 'outside').mean()) if len(sh) else np.nan,
                           'sh_hit': float(sh.shot_res.isin(['blocked', 'saved']).mean()) if len(sh) else np.nan,
                           'del_keep': float((w[w.kind != 'shot'].res == 'keep').mean()) if (w.kind != 'shot').any() else np.nan,
                           'lost_share': float((w.res == 'lost').mean()), 'state': float(w.score_diff.iloc[0]), 'gap': float((w.str_att - w.str_def).iloc[0])})
            i = j
        else:
            i += 1
sp = pd.DataFrame(spells)
R['spells'] = {'n': int(len(sp)), 'per_match': round(len(sp) / R['n_matches'], 2), 'mean_events': round(float(sp.n.mean()), 1),
               'zero_from_these_pct': round(100 * float((sp.ck_from_these == 0).mean()), 1), 'zero_any_pct': round(100 * float((sp.ck_any == 0).mean()), 1),
               'expected_zero_pct': round(100 * float(sp.p0_kind.mean()), 1),
               'by_size': [{'n_events': int(k), 'spells': int(len(g)), 'zero_any_pct': round(100 * float((g.ck_any == 0).mean()), 1),
                            'expected_zero_pct': round(100 * float(g.p0_kind.mean()), 1)} for k, g in sp.assign(k=np.minimum(sp.n, 9)).groupby('k')],
               'compare': {lab: {c: round(float(g[c].mean()) * (100 if c not in ('n', 'n_shot', 'n_low', 'n_cut', 'gap', 'state') else 1), 1)
                                 for c in ('n', 'n_shot', 'n_low', 'n_cut', 'sh_off_goal', 'sh_outside', 'sh_hit', 'del_keep', 'lost_share', 'gap', 'state')}
                           for lab, g in (('没有角球', sp[sp.ck_any == 0]), ('有角球', sp[sp.ck_any > 0]))}}
json.dump(R, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: R[k] for k in ('overall', 'shot_by_result', 'spells')}, ensure_ascii=False, indent=1))
