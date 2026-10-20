"""Screen extra tappable inputs: does adding each one to the current five activity features improve
held-out predictions of the remaining corners in the half? Leave-one-league-out, Poisson deviance.

Usage: python3 -I fit4.py <work2> <work3>
"""
import os
import sys
import time
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model2 as M  # noqa: E402

W2, W3 = sys.argv[1], sys.argv[2]
ev = pd.read_csv(os.path.join(W2, 'ev.csv'))
mt = pd.read_csv(os.path.join(W2, 'mt.csv'))
ex = pd.read_csv(os.path.join(W3, 'ev_extra.csv')).replace({'code': {'pr': 'ps'}})
LEAGUES = sorted(mt.league.unique())
PSEUDO = 15.0
CORE = ['so_own_f3', 'so_own_bx', 'so_own_cr', 'so_opp_f3', 'so_opp_bx']
NEW = {'ct': ['ct'], 'ti': ['ti'], 'fk': ['fk'], 'cl': ['cl'], 'cb': ['cb'], 'tb': ['tb'], 'dr': ['dr'], 'ps': ['ps'],
       'sh': ['sb', 'ss', 'so', 'sg'], 'sbs': ['sb', 'ss'], 'ck': ['ck'], 'sp': ['ti', 'fk']}
GROUPS = {**M.GROUPS, **NEW}
allev = pd.concat([ev, ex], ignore_index=True)


def add_counts(cp):
    """Add n_own_<g> / n_opp_<g> for the new groups to an existing checkpoint table."""
    need = [g for g in NEW if f'n_own_{g}' not in cp.columns]
    if not need:
        return cp
    e = allev[allev.code.isin(sorted({c for g in need for c in NEW[g]}))]
    evg = {k: g for k, g in e.groupby('match_id')}
    out = {f'n_{w}_{g}': np.zeros(len(cp), dtype=np.int32) for g in need for w in ('own', 'opp')}
    for mid, idx in cp.groupby('match_id').indices.items():
        g_ = evg.get(mid)
        if g_ is None:
            continue
        per, tt, sd, cd = g_.period.values, g_.t.values, g_.side.values, g_.code.values
        rows = cp.iloc[idx]
        for j, (half, c, side) in zip(idx, zip(rows.half.values, rows.c.values, rows.side.values)):
            sof = (per < half) | ((per == half) & (tt < c * 60.0))
            for g in need:
                m = sof & np.isin(cd, NEW[g])
                out[f'n_own_{g}'][j] = int((m & (sd == side)).sum())
                out[f'n_opp_{g}'][j] = int((m & (sd != side)).sum())
    return cp.assign(**out)


def side_rates(ev_, mt_):
    mins = (mt_.p1_len.sum() + mt_.p2_len.sum()) / 60.0
    return {s: {g: float((ev_[(ev_.side == s)].code.isin(c)).sum() / mins) for g, c in GROUPS.items()} for s in (1, 0)}


def feats(cp, sr, names):
    cols = []
    side = cp.side.values
    for nm in names:
        _, who, g = nm.split('_')
        n = cp[f'n_{who}_{g}'].values
        tgt = side if who == 'own' else 1 - side
        r = np.where(tgt == 1, sr[1][g], sr[0][g])
        a = r * PSEUDO
        cols.append(np.log((n + a) / (r * cp.elapsed.values + a)))
    return np.column_stack(cols) if cols else np.zeros((len(cp), 0))


def fit(cp, sr, names):
    X = np.column_stack([np.ones(len(cp)), feats(cp, sr, names)])
    off = np.log(np.maximum(cp.offset.values, 1e-9))
    b = M.poisson_fit(X, cp.y.values.astype(float), off, ridge=np.r_[0.0, np.full(X.shape[1] - 1, 30.0)])
    return b


def deviance(y, mu):
    mu = np.maximum(mu, 1e-12)
    t = np.where(y > 0, y * np.log(np.where(y > 0, y, 1) / mu), 0.0)
    return float(2 * np.sum(t - (y - mu)))


SETS = {'none': [], 'core': CORE}
for g in NEW:
    SETS[f'+{g}(own)'] = CORE + [f'so_own_{g}']
    SETS[f'+{g}(both)'] = CORE + [f'so_own_{g}', f'so_opp_{g}']
SETS['+ti+fk+ct(own)'] = CORE + ['so_own_ti', 'so_own_fk', 'so_own_ct']
SETS['+all(own)'] = CORE + [f'so_own_{g}' for g in ('ct', 'ti', 'fk', 'cl', 'tb', 'dr', 'ps', 'sbs', 'ck')]

res, coefs = {}, {}
for lg in LEAGUES:
    t = time.time()
    p = os.path.join(W3, f"cpx_no_{lg.replace(' ', '')}.pkl")
    if os.path.exists(p):
        cp = pd.read_pickle(p)
    else:
        cp = add_counts(pd.read_pickle(os.path.join(W2, f"cp_no_{lg.replace(' ', '')}.pkl")))
        cp.to_pickle(p)
    tr_m = mt[mt.league != lg]
    sr = side_rates(allev[allev.match_id.isin(tr_m.match_id)], tr_m)
    tr, te = cp[cp.league != lg], cp[cp.league == lg]
    for nm, names in SETS.items():
        b = fit(tr, sr, names)
        coefs.setdefault(nm, []).append(b[1:])
        mu = te.offset.values * np.exp(np.column_stack([np.ones(len(te)), feats(te, sr, names)]) @ b)
        for half in (1, 2):
            msk = te.half.values == half
            res.setdefault(nm, {}).setdefault(half, []).append(deviance(te.y.values[msk], mu[msk]))
    print(lg, 'done', round(time.time() - t, 1), 's', flush=True)

base = {h: sum(res['none'][h]) for h in (1, 2)}
core = {h: sum(res['core'][h]) for h in (1, 2)}
rows = []
for nm, d in res.items():
    rows.append({'set': nm,
                 'H1_vs_none_%': round(100 * (1 - sum(d[1]) / base[1]), 3), 'H2_vs_none_%': round(100 * (1 - sum(d[2]) / base[2]), 3),
                 'H1_vs_core_%': round(100 * (1 - sum(d[1]) / core[1]), 3), 'H2_vs_core_%': round(100 * (1 - sum(d[2]) / core[2]), 3),
                 'leagues_better': sum(int(a < b) for h in (1, 2) for a, b in zip(d[h], res['core'][h])),
                 'coef_new': ' '.join(f'{x:+.3f}' for x in np.mean(coefs[nm], axis=0)[len(CORE):]) if nm not in ('none', 'core') else ''})
out = pd.DataFrame(rows)
out.to_csv(os.path.join(W3, 'screen.csv'), index=False)
print(out.to_string(index=False))
