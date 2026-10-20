"""Held-out check of per-team half corners and half handicap probabilities.
Usage: python3 -I val_hcap.py <work2>
"""
import os
import sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model2 as M  # noqa: E402

W = sys.argv[1]
ev = pd.read_csv(os.path.join(W, 'ev.csv'))
mt = pd.read_csv(os.path.join(W, 'mt.csv'))
NAMES = ['so_own_f3', 'so_own_bx', 'so_own_cr', 'so_opp_f3', 'so_opp_bx']
CHK = [(1, 0), (1, 18), (1, 30), (2, 0), (2, 18), (2, 30)]
LEAGUES = sorted(mt.league.unique())


def fit_act(cp, rates):
    X = np.column_stack([np.ones(len(cp)), M.feature_matrix(cp, rates, NAMES)])
    off = np.log(np.maximum(cp.offset.values, 1e-9))
    b = M.poisson_fit(X, cp.y.values.astype(float), off, ridge=np.r_[0.0, np.full(len(NAMES), 30.0)])
    b[0] -= np.log(cp.y.values.sum() / np.exp(off).sum())
    return b


def sim_pt(P, half, t0, score, reds, last, end, mult, n, rng):
    """Like M.simulate but returns (home_remaining, away_remaining)."""
    tot = {1: np.zeros(n), 0: np.zeros(n)}
    sh, sa = np.full(n, float(score[0])), np.full(n, float(score[1]))
    lc = {1: np.full(n, -1e9 if last[0] is None else last[0]), 0: np.full(n, -1e9 if last[1] is None else last[1])}
    man = {1: np.sign(reds[1] - reds[0]), 0: np.sign(reds[0] - reds[1])}
    mlt = {1: mult[0], 0: mult[1]}
    st = np.array(P['state'])
    t = float(t0)
    while t < end - 1e-9:
        mi = int(t // 60)
        step = min(60.0 - (t - mi * 60), end - t)
        dt = step / 60.0
        b = P['bin'][(half - 1) * 10 + min(mi // 5, 9)]
        for side in (1, 0):
            diff = (sh - sa) if side == 1 else (sa - sh)
            clu = np.where(t - lc[side] <= P['cluSec'], P['clu'], 1.0)
            lam = b * (P['home'] if side == 1 else 1.0) * P['man'][int(man[side]) + 1] * st[M.state_idx(diff)] * clu * mlt[side] * dt
            k = rng.poisson(lam)
            tot[side] += k
            lc[side] = np.where(k > 0, t + step / 2, lc[side])
            g = rng.poisson(P['goal'][half - 1][side] * dt, n)
            if side == 1:
                sh = sh + g
            else:
                sa = sa + g
        t += step
    return tot[1], tot[0]


rng = np.random.default_rng(5)
rows = []
ck = ev[ev.code == 'ck']
for lg in LEAGUES:
    cp = pd.read_pickle(os.path.join(W, f"cp_no_{lg.replace(' ', '')}.pkl"))
    P, rates = cp.attrs['P'], cp.attrs['rates']
    b = fit_act(cp[cp.league != lg], rates)
    te = cp[cp.league == lg]
    te = te[[(h, c) in CHK for h, c in zip(te.half, te.c)]]
    te = te.assign(m=np.exp(np.column_stack([np.ones(len(te)), M.feature_matrix(te, rates, NAMES)]) @ b))
    for (mid, half, c), g in te.groupby(['match_id', 'half', 'c']):
        if len(g) != 2:
            continue
        h, a = g[g.side == 1].iloc[0], g[g.side == 0].iloc[0]
        t0 = c * 60.0
        cm = ck[(ck.match_id == mid) & (ck.period == half)]
        hh, ha = int(((cm.side == 1) & (cm.t < t0)).sum()), int(((cm.side == 0) & (cm.t < t0)).sum())
        fh, fa = int((cm.side == 1).sum()), int((cm.side == 0).sum())
        last = [None if np.isnan(h.lastc) else h.lastc, None if np.isnan(a.lastc) else a.lastc]
        for key, mult in (('base', [1.0, 1.0]), ('act', [h.m, a.m])):
            rh, ra = sim_pt(P, half, t0, [h.g_home, h.g_away], [h.r_home, h.r_away], last, h.plen, mult, 1200, rng)
            d = (hh + rh) - (ha + ra)
            for line in (-1.5, -0.5, 0.5, 1.5):  # home handicap
                rows.append({'half': half, 'c': c, 'model': key, 'line': line, 'p': float((d + line > 0).mean()),
                             'win': int((fh - fa) + line > 0), 'mu_h': float(hh + rh.mean()), 'mu_a': float(ha + ra.mean()),
                             'f_h': fh, 'f_a': fa})
    print(lg, 'done', flush=True)
df = pd.DataFrame(rows)
df.to_csv(os.path.join(W, 'val_hcap.csv'), index=False)
for key, g in df.groupby('model'):
    print(key, 'Brier', round(float(((g.p - g.win) ** 2).mean()), 4))
one = df[(df.model == 'act') & (df.line == -0.5)]
print(one.groupby(['half', 'c'])[['mu_h', 'f_h', 'mu_a', 'f_a']].mean().round(2))
a = df[df.model == 'act'].copy()
a['bk'] = pd.cut(a.p, np.linspace(0, 1, 11), include_lowest=True)
print(a.groupby('bk', observed=True).agg(n=('win', 'size'), pred=('p', 'mean'), act=('win', 'mean')).round(3))
for (half, c), g in df.groupby(['half', 'c']):
    bb = ((g[g.model == 'base'].p.values - g[g.model == 'base'].win.values) ** 2).mean()
    aa = ((g[g.model == 'act'].p.values - g[g.model == 'act'].win.values) ** 2).mean()
    print(half, c, 'base', round(bb, 4), 'act', round(aa, 4), 'improve %', round(100 * (1 - aa / bb), 1))
