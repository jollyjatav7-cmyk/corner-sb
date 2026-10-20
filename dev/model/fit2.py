"""Fit and validate the v2 model.

Usage:
  python3 -I fit2.py select   <work2> <prior_csv>     # leave-one-league-out deviance for feature sets
  python3 -I fit2.py validate <work2> <prior_csv> <feature_set>   # simulated Brier, base vs activity
  python3 -I fit2.py final    <work2> <prior_csv> <feature_set> <out_json>
"""
import json
import os
import sys
import time
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model2 as M  # noqa: E402

MODE, W, PRIOR_CSV = sys.argv[1], sys.argv[2], sys.argv[3]
ev = pd.read_csv(os.path.join(W, 'ev.csv'))
mt = pd.read_csv(os.path.join(W, 'mt.csv'))
pr = pd.read_csv(PRIOR_CSV).set_index('match_id')['exp_total'].to_dict()
LEAGUES = sorted(mt.league.unique())
CPS = list(range(0, 45, 3))

slots_p = os.path.join(W, 'slots2.pkl')
if os.path.exists(slots_p):
    slots = pd.read_pickle(slots_p)
else:
    slots = M.build_slots(ev, mt)
    slots.to_pickle(slots_p)

FS = {
    'none': [],
    'so_own': ['so_own_f3', 'so_own_bx', 'so_own_cr', 'so_own_sbs', 'so_own_ck'],
    'so_both': ['so_own_f3', 'so_own_bx', 'so_own_cr', 'so_own_sbs', 'so_own_ck',
                'so_opp_f3', 'so_opp_bx', 'so_opp_cr', 'so_opp_sbs', 'so_opp_ck'],
    'so_both_sh': ['so_own_f3', 'so_own_bx', 'so_own_cr', 'so_own_sh', 'so_own_ck',
                   'so_opp_f3', 'so_opp_bx', 'so_opp_cr', 'so_opp_sh', 'so_opp_ck'],
    'so_re': ['so_own_f3', 'so_own_bx', 'so_own_cr', 'so_own_sbs', 'so_own_ck',
              'so_opp_f3', 'so_opp_bx', 'so_opp_cr', 'so_opp_sbs', 'so_opp_ck',
              're_own_f3', 're_own_bx', 're_own_cr', 're_own_sbs', 're_opp_f3', 're_opp_bx'],
    'core': ['so_own_f3', 'so_own_bx', 'so_own_cr', 'so_opp_f3', 'so_opp_bx'],
}


def cp_for(train_leagues, tag):
    p = os.path.join(W, f'cp_{tag}.pkl')
    if os.path.exists(p):
        return pd.read_pickle(p)
    P = M.fit_base(slots[slots.league.isin(train_leagues)])
    rates = M.activity_rates(ev[ev.match_id.isin(mt[mt.league.isin(train_leagues)].match_id)],
                             mt[mt.league.isin(train_leagues)])
    cp = M.build_checkpoints(ev, mt, P, rates, CPS, prior=pr)
    cp.attrs['P'] = P
    cp.attrs['rates'] = rates
    pd.to_pickle(cp, p)
    return cp


def fit_act(cp, names, rates, mean_total, ridge=30.0):
    X = M.feature_matrix(cp, rates, names, mean_total=mean_total)
    X = np.column_stack([np.ones(len(cp)), X])
    pen = np.r_[0.0, np.full(X.shape[1] - 1, ridge)]
    off = np.log(np.maximum(cp.offset.values, 1e-9))
    b = M.poisson_fit(X, cp.y.values.astype(float), off, ridge=pen)
    # the base simulator is already calibrated, so remove the offset's own bias (intercept-only fit)
    c0 = np.log(cp.y.values.sum() / np.exp(off).sum())
    b = b.copy()
    b[0] -= c0
    return b


def predict_mult(cp, names, b, rates, mean_total):
    X = M.feature_matrix(cp, rates, names, mean_total=mean_total)
    X = np.column_stack([np.ones(len(cp)), X])
    return np.exp(X @ b)


def deviance(y, mu):
    mu = np.maximum(mu, 1e-12)
    t = np.where(y > 0, y * np.log(np.where(y > 0, y, 1) / mu), 0.0)
    return float(2 * np.sum(t - (y - mu)))


if MODE == 'select':
    res = {}
    for lg in LEAGUES:
        t = time.time()
        cp = cp_for([x for x in LEAGUES if x != lg], 'no_' + lg.replace(' ', ''))
        rates, P = cp.attrs['rates'], cp.attrs['P']
        tr, te = cp[cp.league != lg], cp[cp.league == lg]
        mtot = ev[(ev.code == 'ck') & ev.match_id.isin(mt[mt.league != lg].match_id)].shape[0] / (mt.league != lg).sum()
        for nm, names in list(FS.items()) + [(k + '+pr', v + ['pr_x_x']) for k, v in FS.items() if k in ('none', 'so_both', 'core')]:
            b = fit_act(tr, names, rates, mtot)
            mu = te.offset.values * predict_mult(te, names, b, rates, mtot)
            for half in (1, 2):
                msk = te.half.values == half
                res.setdefault(nm, {}).setdefault(half, []).append(deviance(te.y.values[msk], mu[msk]))
        print(lg, 'done', round(time.time() - t, 1), 's', flush=True)
    base = {h: sum(res['none'][h]) for h in (1, 2)}
    for nm, d in res.items():
        print(f'{nm:14s}', ' '.join(f'H{h}: {100 * (1 - sum(d[h]) / base[h]):6.2f}%' for h in (1, 2)))

elif MODE == 'validate':
    fs = sys.argv[4]
    names = FS[fs]
    rng = np.random.default_rng(11)
    CHK = [(1, 9), (1, 18), (1, 30), (1, 39), (2, 0), (2, 9), (2, 18), (2, 30), (2, 39)]
    LINES = {1: [3.5, 4.5, 5.5], 2: [4.5, 5.5]}
    out = []
    for lg in LEAGUES:
        t = time.time()
        cp = cp_for([x for x in LEAGUES if x != lg], 'no_' + lg.replace(' ', ''))
        rates, P = cp.attrs['rates'], cp.attrs['P']
        mtot = ev[(ev.code == 'ck') & ev.match_id.isin(mt[mt.league != lg].match_id)].shape[0] / (mt.league != lg).sum()
        tr = cp[cp.league != lg]
        bA = fit_act(tr, names, rates, mtot)
        bP = fit_act(tr, ['pr_x_x'], rates, mtot)
        bAP = fit_act(tr, names + ['pr_x_x'], rates, mtot)
        te = cp[(cp.league == lg)]
        te = te[[(h, c) in CHK for h, c in zip(te.half, te.c)]]
        mA = predict_mult(te, names, bA, rates, mtot)
        mP = predict_mult(te, ['pr_x_x'], bP, rates, mtot)
        mAP = predict_mult(te, names + ['pr_x_x'], bAP, rates, mtot)
        te = te.assign(mA=mA, mP=mP, mAP=mAP)
        ckt = ev[(ev.code == 'ck')]
        for (mid, half, c), g in te.groupby(['match_id', 'half', 'c']):
            if len(g) != 2:
                continue
            h, a = g[g.side == 1].iloc[0], g[g.side == 0].iloc[0]
            t0 = c * 60.0
            cm = ckt[(ckt.match_id == mid) & (ckt.period == half)]
            have = int((cm.t < t0).sum())
            final = int(len(cm))
            last = [None if np.isnan(h.lastc) else h.lastc, None if np.isnan(a.lastc) else a.lastc]
            sims = {}
            for key, mult in (('base', [1.0, 1.0]), ('act', [h.mA, a.mA]), ('pri', [h.mP, a.mP]), ('actpri', [h.mAP, a.mAP])):
                sims[key] = M.simulate(P, half, t0, [h.g_home, h.g_away], [h.r_home, h.r_away], last, h.plen, mult, 1200, rng)
            for line in LINES[half]:
                row = {'league': lg, 'match_id': mid, 'half': half, 'c': c, 'line': line, 'over': int(final > line)}
                for k, s in sims.items():
                    row['p_' + k] = float(((have + s) > line).mean())
                    row['mu_' + k] = float(have + s.mean())
                row['final'] = final
                out.append(row)
        print(lg, 'validated', round(time.time() - t, 1), 's', flush=True)
    df = pd.DataFrame(out)
    df.to_csv(os.path.join(W, f'val_{fs}.csv'), index=False)
    summ = []
    for (half, c), g in df.groupby(['half', 'c']):
        r = {'half': half, 'c': c}
        for k in ('base', 'act', 'pri', 'actpri'):
            r[k] = round(float(((g['p_' + k] - g.over) ** 2).mean()), 4)
        for k in ('base', 'act', 'pri', 'actpri'):
            r['mu_' + k] = round(float(g.drop_duplicates('match_id')['mu_' + k].mean()), 3)
        r['mu_final'] = round(float(g.drop_duplicates('match_id').final.mean()), 3)
        summ.append(r)
    s = pd.DataFrame(summ)
    print(s.to_string(index=False))
    tot = {k: float(((df['p_' + k] - df.over) ** 2).mean()) for k in ('base', 'act', 'pri', 'actpri')}
    print('overall Brier', {k: round(v, 4) for k, v in tot.items()})
    print('improvement vs base %', {k: round(100 * (1 - v / tot['base']), 2) for k, v in tot.items()})
    df['bucket'] = pd.cut(df.p_act, bins=np.linspace(0, 1, 11), include_lowest=True)
    print(df.groupby('bucket', observed=True).agg(n=('over', 'size'), pred=('p_act', 'mean'), act=('over', 'mean')).round(3).to_string())
    json.dump({'by_checkpoint': summ, 'overall': tot}, open(os.path.join(W, f'val_{fs}.json'), 'w'), indent=1)

elif MODE == 'final':
    fs, out_p = sys.argv[4], sys.argv[5]
    names = FS[fs]
    cp = cp_for(LEAGUES, 'all')
    rates, P = cp.attrs['rates'], cp.attrs['P']
    mtot = float((ev.code == 'ck').sum() / len(mt))
    bA = fit_act(cp, names, rates, mtot)
    bAP = fit_act(cp, names + ['pr_x_x'], rates, mtot)
    bP = fit_act(cp, ['pr_x_x'], rates, mtot)
    res = {'base': P, 'rates': rates, 'meanTotal': mtot, 'features': names,
           'coefNoPrior': [float(x) for x in bA], 'coefPrior': [float(x) for x in bAP], 'coefPriorOnly': [float(x) for x in bP],
           'pseudo': 15.0}
    json.dump(res, open(out_p, 'w'), indent=1)
    print(json.dumps(res, indent=1))
