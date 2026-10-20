"""Activity model with side-specific average rates (home teams compared with home teams, away with away),
validated on held-out leagues for both half totals and half handicaps.

Usage:
  python3 -I fit3.py validate <work2> <prior_csv> <sigma>
  python3 -I fit3.py final    <work2> <prior_csv> <out_json>
"""
import json
import os
import sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model2 as M  # noqa: E402

MODE, W, PRIOR = sys.argv[1], sys.argv[2], sys.argv[3]
ev = pd.read_csv(os.path.join(W, 'ev.csv'))
mt = pd.read_csv(os.path.join(W, 'mt.csv'))
LEAGUES = sorted(mt.league.unique())
NAMES = ['so_own_f3', 'so_own_bx', 'so_own_cr', 'so_opp_f3', 'so_opp_bx']
PSEUDO = 15.0


def side_rates(ev_, mt_):
    mins = (mt_.p1_len.sum() + mt_.p2_len.sum()) / 60.0
    return {s: {g: float((ev_[(ev_.side == s)].code.isin(c)).sum() / mins) for g, c in M.GROUPS.items()} for s in (1, 0)}


def feats(cp, sr, names, mean_total=None):
    cols = []
    side = cp.side.values
    for nm in names:
        kind, who, g = nm.split('_')
        if kind == 'pr':
            cols.append(np.log(cp.prior.values / mean_total))
            continue
        n = cp[f'n_{who}_{g}'].values
        tgt = side if who == 'own' else 1 - side
        r = np.where(tgt == 1, sr[1][g], sr[0][g])
        a = r * PSEUDO
        cols.append(np.log((n + a) / (r * cp.elapsed.values + a)))
    return np.column_stack(cols) if cols else np.zeros((len(cp), 0))


def fit(cp, sr, names, mean_total):
    X = np.column_stack([np.ones(len(cp)), feats(cp, sr, names, mean_total)])
    off = np.log(np.maximum(cp.offset.values, 1e-9))
    b = M.poisson_fit(X, cp.y.values.astype(float), off, ridge=np.r_[0.0, np.full(X.shape[1] - 1, 30.0)])
    b[0] -= np.log(cp.y.values.sum() / np.exp(off).sum())
    return b


def mult(cp, sr, names, b, mean_total):
    return np.exp(np.column_stack([np.ones(len(cp)), feats(cp, sr, names, mean_total)]) @ b)


def sim_pt(P, half, t0, score, reds, last, end, mlt_, sigma, n, rng):
    u = rng.normal(0.0, sigma, n) if sigma > 0 else np.zeros(n)
    tot = {1: np.zeros(n), 0: np.zeros(n)}
    sh, sa = np.full(n, float(score[0])), np.full(n, float(score[1]))
    lc = {1: np.full(n, -1e9 if last[0] is None else last[0]), 0: np.full(n, -1e9 if last[1] is None else last[1])}
    man = {1: np.sign(reds[1] - reds[0]), 0: np.sign(reds[0] - reds[1])}
    ml = {1: mlt_[0] * np.exp(u), 0: mlt_[1] * np.exp(-u)}
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
            lam = b * (P['home'] if side == 1 else 1.0) * P['man'][int(man[side]) + 1] * st[M.state_idx(diff)] * clu * ml[side] * dt
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


if MODE == 'validate':
    sigma = float(sys.argv[4])
    CHK = [(1, 9), (1, 18), (1, 30), (1, 39), (2, 0), (2, 9), (2, 18), (2, 30), (2, 39)]
    TL = {1: [3.5, 4.5, 5.5], 2: [4.5, 5.5]}
    HL = [-1.5, -0.5, 0.5]
    rng = np.random.default_rng(17)
    ck = ev[ev.code == 'ck']
    rows = []
    for lg in LEAGUES:
        cp = pd.read_pickle(os.path.join(W, f"cp_no_{lg.replace(' ', '')}.pkl"))
        P = cp.attrs['P']
        tr_m = mt[mt.league != lg]
        sr = side_rates(ev[ev.match_id.isin(tr_m.match_id)], tr_m)
        mtot = ck[ck.match_id.isin(tr_m.match_id)].shape[0] / len(tr_m)
        cp = cp.assign(prior=cp.match_id.map(pd.read_csv(PRIOR).set_index('match_id')['exp_total']))
        tr = cp[cp.league != lg]
        bA, bAP, bP = fit(tr, sr, NAMES, mtot), fit(tr, sr, NAMES + ['pr_x_x'], mtot), fit(tr, sr, ['pr_x_x'], mtot)
        te = cp[cp.league == lg]
        te = te[[(h, c) in CHK for h, c in zip(te.half, te.c)]]
        te = te.assign(mA=mult(te, sr, NAMES, bA, mtot), mAP=mult(te, sr, NAMES + ['pr_x_x'], bAP, mtot), mP=mult(te, sr, ['pr_x_x'], bP, mtot))
        for (mid, half, c), g in te.groupby(['match_id', 'half', 'c']):
            if len(g) != 2:
                continue
            h, a = g[g.side == 1].iloc[0], g[g.side == 0].iloc[0]
            t0 = c * 60.0
            cm = ck[(ck.match_id == mid) & (ck.period == half)]
            hh, ha = int(((cm.side == 1) & (cm.t < t0)).sum()), int(((cm.side == 0) & (cm.t < t0)).sum())
            fh, fa = int((cm.side == 1).sum()), int((cm.side == 0).sum())
            last = [None if np.isnan(h.lastc) else h.lastc, None if np.isnan(a.lastc) else a.lastc]
            for key, ml_, sg in (('base', [1.0, 1.0], 0.0), ('act', [h.mA, a.mA], sigma), ('pri', [h.mP, a.mP], 0.0), ('actpri', [h.mAP, a.mAP], sigma)):
                rh, ra = sim_pt(P, half, t0, [h.g_home, h.g_away], [h.r_home, h.r_away], last, h.plen, ml_, sg, 1200, rng)
                tot, d = hh + ha + rh + ra, (hh + rh) - (ha + ra)
                r = {'lg': lg, 'mid': mid, 'half': half, 'c': c, 'model': key, 'mu_h': hh + rh.mean(), 'mu_a': ha + ra.mean(), 'f_h': fh, 'f_a': fa}
                for L in TL[half]:
                    rows.append({**r, 'kind': 'tot', 'line': L, 'p': float((tot > L).mean()), 'win': int(fh + fa > L)})
                for L in HL:
                    rows.append({**r, 'kind': 'hcap', 'line': L, 'p': float((d + L > 0).mean()), 'win': int(fh - fa + L > 0)})
        print(lg, 'done', flush=True)
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(W, f'val3_s{sigma}.csv'), index=False)
    for kind in ('tot', 'hcap'):
        g = df[df.kind == kind]
        br = {m: float(((x.p - x.win) ** 2).mean()) for m, x in g.groupby('model')}
        print(kind, 'Brier', {k: round(v, 4) for k, v in br.items()}, 'improve %', {k: round(100 * (1 - v / br['base']), 2) for k, v in br.items()})
        for half in (1, 2):
            gh = g[g.half == half]
            bh = {m: float(((x.p - x.win) ** 2).mean()) for m, x in gh.groupby('model')}
            print('  H%d' % half, {k: round(100 * (1 - v / bh['base']), 2) for k, v in bh.items()})
        x = g[g.model == 'act'].copy()
        x['bk'] = pd.cut(x.p, [0, .2, .4, .6, .8, 1], include_lowest=True)
        print(x.groupby('bk', observed=True).agg(pred=('p', 'mean'), act=('win', 'mean'), n=('win', 'size')).round(3).to_string())
    one = df[(df.kind == 'hcap') & (df.line == -0.5)]
    print(one.groupby(['model', 'half'])[['mu_h', 'f_h', 'mu_a', 'f_a']].mean().round(2).to_string())

elif MODE == 'final':
    out = sys.argv[4]
    cp = pd.read_pickle(os.path.join(W, 'cp_all.pkl'))
    P = cp.attrs['P']
    sr = side_rates(ev, mt)
    mtot = float((ev.code == 'ck').sum() / len(mt))
    cp = cp.assign(prior=cp.match_id.map(pd.read_csv(PRIOR).set_index('match_id')['exp_total']))
    res = {'base': P, 'ratesSide': {'home': sr[1], 'away': sr[0]}, 'meanTotal': mtot, 'features': NAMES,
           'coefNoPrior': [float(x) for x in fit(cp, sr, NAMES, mtot)],
           'coefPrior': [float(x) for x in fit(cp, sr, NAMES + ['pr_x_x'], mtot)], 'pseudo': PSEUDO}
    json.dump(res, open(out, 'w'), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != 'base'}, indent=1))
