"""Does the pre-match expectation split between the two teams help, beyond the total?
Leave-one-league-out on the 1,517 StatsBomb matches (2015/16, four leagues).

Pre-match expectation per team, like the app's 查／算: own = (own corners won avg + opponent's corners conceded avg) / 2.
  loo = season averages leaving this match out (what the shipped total prior used)
  l10 = last 10 matches before this one, at least 6 (what the app's auto lookup does)
Models (activity features as in the app, plus):
  tot   = log(E_total / mean_total)                (current app, same for both teams)
  split = tot + log(2 * E_own / E_total)           (the team's share of the total)
Metrics: held-out Poisson deviance of each side's remaining corners in the half, and simulated Brier of half totals /
half handicaps (handicap counted from the corner score at the checkpoint, like in-play lines).

Usage: python3 -I fit5.py <work> <work2> <out_dir> <deviance|brier|final> [prior=loo|l10] [sims]
"""
import json
import os
import sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model2 as M  # noqa: E402

W1, W2, OUT, MODE = sys.argv[1:5]
SRC = sys.argv[5] if len(sys.argv) > 5 else 'loo'
NSIM = int(sys.argv[6]) if len(sys.argv) > 6 else 1200
ev = pd.read_csv(os.path.join(W2, 'ev.csv'))
mt = pd.read_csv(os.path.join(W2, 'mt.csv'))
ms = pd.read_csv(os.path.join(W1, 'match_summary.csv'))
LEAGUES = sorted(mt.league.unique())
ACT = ['so_own_f3', 'so_own_bx', 'so_own_cr', 'so_opp_f3', 'so_opp_bx']
PSEUDO = 15.0


def team_priors(ms):
    rows = []
    for r in ms.itertuples():
        rows.append((r.match_id, r.league, r.date, r.home, r.home_c, r.away_c, 1))
        rows.append((r.match_id, r.league, r.date, r.away, r.away_c, r.home_c, 0))
    tf = pd.DataFrame(rows, columns=['match_id', 'league', 'date', 'team', 'f', 'a', 'side'])
    g = tf.groupby(['league', 'team'])
    tf['loo_f'] = (g.f.transform('sum') - tf.f) / (g.f.transform('size') - 1)
    tf['loo_a'] = (g.a.transform('sum') - tf.a) / (g.a.transform('size') - 1)
    tf = tf.sort_values(['team', 'date', 'match_id'])
    for c in ('f', 'a'):
        tf[f'l10_{c}'] = tf.groupby('team')[c].transform(lambda x: x.shift(1).rolling(10, min_periods=6).mean())
    h, a = tf[tf.side == 1].set_index('match_id'), tf[tf.side == 0].set_index('match_id')
    out = pd.DataFrame(index=h.index)
    for s in ('loo', 'l10'):
        out[f'{s}_h'] = (h[f'{s}_f'] + a.loc[h.index, f'{s}_a']) / 2
        out[f'{s}_a'] = (a.loc[h.index, f'{s}_f'] + h[f'{s}_a']) / 2
    return out


PR = team_priors(ms)


def attach(cp):
    eh, ea = cp.match_id.map(PR[f'{SRC}_h']), cp.match_id.map(PR[f'{SRC}_a'])
    own = np.where(cp.side == 1, eh, ea)
    cp = cp.assign(prior=eh + ea, share=own / (eh + ea))
    return cp[np.isfinite(cp.prior)]


def side_rates(ev_, mt_):
    mins = (mt_.p1_len.sum() + mt_.p2_len.sum()) / 60.0
    return {s: {g: float((ev_[(ev_.side == s)].code.isin(c)).sum() / mins) for g, c in M.GROUPS.items()} for s in (1, 0)}


def feats(cp, sr, names, mtot):
    cols = []
    side = cp.side.values
    for nm in names:
        kind, who, g = nm.split('_')
        if kind == 'pr':
            cols.append(np.log(cp.prior.values / mtot)); continue
        if kind == 'ps':
            cols.append(np.log(2 * cp.share.values)); continue
        n = cp[f'n_{who}_{g}'].values
        tgt = side if who == 'own' else 1 - side
        r = np.where(tgt == 1, sr[1][g], sr[0][g])
        a = r * PSEUDO
        cols.append(np.log((n + a) / (r * cp.elapsed.values + a)))
    return np.column_stack(cols) if cols else np.zeros((len(cp), 0))


def fit(cp, sr, names, mtot):
    X = np.column_stack([np.ones(len(cp)), feats(cp, sr, names, mtot)])
    off = np.log(np.maximum(cp.offset.values, 1e-9))
    b = M.poisson_fit(X, cp.y.values.astype(float), off, ridge=np.r_[0.0, np.full(X.shape[1] - 1, 30.0)])
    b[0] -= np.log(cp.y.values.sum() / np.exp(off).sum())
    return b


def mult(cp, sr, names, b, mtot):
    return np.exp(np.column_stack([np.ones(len(cp)), feats(cp, sr, names, mtot)]) @ b)


def dev(y, mu):
    y = y.astype(float)
    return 2 * np.sum(np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / mu), 0) - (y - mu))


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


MODELS = {'none': [], 'tot': ['pr_x_x'], 'split': ['pr_x_x', 'ps_x_x'], 'act': ACT, 'act+tot': ACT + ['pr_x_x'], 'act+split': ACT + ['pr_x_x', 'ps_x_x']}


def load(lg):
    cp = pd.read_pickle(os.path.join(W2, f"cp_no_{lg.replace(' ', '')}.pkl"))
    tr_m = mt[mt.league != lg]
    sr = side_rates(ev[ev.match_id.isin(tr_m.match_id)], tr_m)
    mtot = ev[(ev.code == 'ck') & ev.match_id.isin(tr_m.match_id)].shape[0] / len(tr_m)
    return attach(cp), sr, mtot, cp.attrs['P']


if MODE == 'deviance':
    res, coefs = [], []
    for lg in LEAGUES:
        cp, sr, mtot, P = load(lg)
        tr, te = cp[cp.league != lg], cp[cp.league == lg]
        for name, names in MODELS.items():
            b = fit(tr, sr, names, mtot) if names else None
            mu = te.offset.values * (mult(te, sr, names, b, mtot) if names else np.exp(fit(tr, sr, [], mtot)[0]))
            for sub, mask in (('all', np.ones(len(te), bool)), ('start', (te.c.values == 0)), ('H1', te.half.values == 1), ('H2', te.half.values == 2)):
                res.append({'lg': lg, 'model': name, 'sub': sub, 'dev': dev(te.y.values[mask], mu[mask]), 'n': int(mask.sum())})
            if names:
                coefs.append({'lg': lg, 'model': name, **{nm: round(float(x), 3) for nm, x in zip(['b0'] + names, b)}})
        print(lg, 'done', flush=True)
    r = pd.DataFrame(res).groupby(['sub', 'model']).dev.sum().unstack('sub')
    imp = (1 - r.div(r.loc['none'])) * 100
    print('prior source', SRC, '| held-out deviance improvement vs no model (%)')
    print(imp.round(3).to_string())
    print('split vs tot, act+split vs act+tot (deviance change %):')
    print(((r.loc['split'] / r.loc['tot'] - 1) * 100).round(3).to_dict(), ((r.loc['act+split'] / r.loc['act+tot'] - 1) * 100).round(3).to_dict())
    print(pd.DataFrame(coefs).to_string())
    json.dump({'src': SRC, 'improve_pct': imp.round(4).to_dict(), 'coefs': coefs}, open(os.path.join(OUT, f'fit5_dev_{SRC}.json'), 'w'), indent=1)

elif MODE == 'brier':
    CHK = [(1, 0), (1, 9), (1, 18), (1, 30), (1, 39), (2, 0), (2, 9), (2, 18), (2, 30), (2, 39)]
    TL = {1: [3.5, 4.5, 5.5], 2: [4.5, 5.5]}
    HL = [-1.5, -0.5, 0.5]
    rng = np.random.default_rng(23)
    ck = ev[ev.code == 'ck']
    rows = []
    for lg in LEAGUES:
        cp, sr, mtot, P = load(lg)
        tr = cp[cp.league != lg]
        bT, bS = fit(tr, sr, MODELS['act+tot'], mtot), fit(tr, sr, MODELS['act+split'], mtot)
        te = cp[cp.league == lg]
        te = te[[(h, c) in CHK for h, c in zip(te.half, te.c)]]
        te = te.assign(mT=mult(te, sr, MODELS['act+tot'], bT, mtot), mS=mult(te, sr, MODELS['act+split'], bS, mtot))
        for (mid, half, c), g in te.groupby(['match_id', 'half', 'c']):
            if len(g) != 2:
                continue
            h, a = g[g.side == 1].iloc[0], g[g.side == 0].iloc[0]
            t0 = c * 60.0
            cm = ck[(ck.match_id == mid) & (ck.period == half)]
            hh, ha = int(((cm.side == 1) & (cm.t < t0)).sum()), int(((cm.side == 0) & (cm.t < t0)).sum())
            fh, fa = int((cm.side == 1).sum()), int((cm.side == 0).sum())
            last = [None if np.isnan(h.lastc) else h.lastc, None if np.isnan(a.lastc) else a.lastc]
            for key, ml_ in (('tot', [h.mT, a.mT]), ('split', [h.mS, a.mS])):
                rh, ra = sim_pt(P, half, t0, [h.g_home, h.g_away], [h.r_home, h.r_away], last, h.plen, ml_, 0.0, NSIM, rng)
                tot, d = hh + ha + rh + ra, rh - ra          # handicap from the corner score at the checkpoint
                r = {'lg': lg, 'mid': mid, 'half': half, 'c': c, 'model': key, 'share': h.share}
                for L in TL[half]:
                    rows.append({**r, 'kind': 'tot', 'line': L, 'p': float((tot > L).mean()), 'win': int(fh + fa > L)})
                for L in HL:
                    rows.append({**r, 'kind': 'hcap', 'line': L, 'p': float((d + L > 0).mean()), 'win': int((fh - hh) - (fa - ha) + L > 0)})
        print(lg, 'done', flush=True)
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(OUT, f'fit5_brier_{SRC}.csv'), index=False)
    out = {}
    for kind in ('tot', 'hcap'):
        g = df[df.kind == kind]
        for part, x in (('all', g), ('H1', g[g.half == 1]), ('H2', g[g.half == 2]), ('start', g[g.c == 0]),
                        ('uneven', g[(g.share - 0.5).abs() >= 0.06])):
            br = x.groupby('model').apply(lambda z: float(((z.p - z.win) ** 2).mean()), include_groups=False)
            out[f'{kind}_{part}'] = {'tot': round(br['tot'], 5), 'split': round(br['split'], 5), 'change_pct': round(100 * (br['split'] / br['tot'] - 1), 3), 'n': int(len(x) / 2)}
    # bootstrap over matches for the handicap difference
    g = df[df.kind == 'hcap'].copy()
    g['se'] = (g.p - g.win) ** 2
    pm = g.pivot_table(index=['mid', 'half', 'c', 'line'], columns='model', values='se').reset_index()
    pm['d'] = pm.split - pm.tot
    per = pm.groupby('mid').d.mean()
    bs = [per.sample(len(per), replace=True, random_state=i).mean() for i in range(400)]
    out['hcap_diff_ci'] = [round(float(np.percentile(bs, 2.5)), 6), round(float(np.percentile(bs, 97.5)), 6)]
    print(json.dumps(out, indent=1))
    json.dump(out, open(os.path.join(OUT, f'fit5_brier_{SRC}.json'), 'w'), indent=1)

elif MODE == 'final':
    cp = attach(pd.read_pickle(os.path.join(W2, 'cp_all.pkl')))
    sr = side_rates(ev, mt)
    mtot = float((ev.code == 'ck').sum() / len(mt))
    b = fit(cp, sr, MODELS['act+split'], mtot)
    print(json.dumps({'coefSplit': [float(x) for x in b], 'features': MODELS['act+split'], 'src': SRC}))
    json.dump({'coefSplit': [float(x) for x in b]}, open(os.path.join(OUT, f'fit5_final_{SRC}.json'), 'w'), indent=1)

elif MODE == 'cross':
    # current app: total-prior coefficients fitted with season (loo) priors, but the user's number comes from the last 10 matches
    res = []
    for lg in LEAGUES:
        cp0 = pd.read_pickle(os.path.join(W2, f"cp_no_{lg.replace(' ', '')}.pkl"))
        tr_m = mt[mt.league != lg]
        sr = side_rates(ev[ev.match_id.isin(tr_m.match_id)], tr_m)
        mtot = ev[(ev.code == 'ck') & ev.match_id.isin(tr_m.match_id)].shape[0] / len(tr_m)
        SRC = 'loo'; cpL = attach(cp0)
        SRC = 'l10'; cp10 = attach(cp0)
        bL = fit(cpL[cpL.league != lg], sr, MODELS['act+tot'], mtot)
        b10 = fit(cp10[cp10.league != lg], sr, MODELS['act+tot'], mtot)
        bS = fit(cp10[cp10.league != lg], sr, MODELS['act+split'], mtot)
        te = cp10[cp10.league == lg]
        for name, names, b in (('app_now(loo coef)', MODELS['act+tot'], bL), ('tot(l10 coef)', MODELS['act+tot'], b10), ('split(l10 coef)', MODELS['act+split'], bS)):
            mu = te.offset.values * mult(te, sr, names, b, mtot)
            for sub, mask in (('all', np.ones(len(te), bool)), ('H1', te.half.values == 1), ('start', te.c.values == 0)):
                res.append({'model': name, 'sub': sub, 'dev': dev(te.y.values[mask], mu[mask])})
    r = pd.DataFrame(res).groupby(['sub', 'model']).dev.sum().unstack('sub')
    print(((r / r.loc['app_now(loo coef)'] - 1) * 100).round(3).to_string())
