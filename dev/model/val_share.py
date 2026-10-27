"""Usage: python3 -I val_share.py <out.pkl> [sims per setting]   (needs work2/ from fit2.py, cp_no_*.pkl)
Handicap probabilities are a bit too sure (StatsBomb: says 75% -> 72%, 85% -> 81%). Test adding uncertainty to the simulation:
share noise z ~ N(0, s^2): home x e^(z - s^2/2), away x e^(-z - s^2/2)  (who gets on top; keeps the expected total)
common noise w: both x e^(u - w^2/2), u ~ N(0, w^2)                      (high- or low-corner game)
Leave-one-league-out: activity + pre-match coefficients fitted on three leagues, tested on the fourth.
Lines: half handicap counted from 0:0 and from now (live), half totals."""
import os, sys, json, time
import numpy as np, pandas as pd
sys.path.insert(0, '/home/claude/corner-sb/dev/model')
import model2 as M
W = '/home/claude/work2'
ev = pd.read_csv(f'{W}/ev.csv'); mt = pd.read_csv(f'{W}/mt.csv')
LEAGUES = sorted(mt.league.unique())
NAMES = ['so_own_f3', 'so_own_bx', 'so_own_cr', 'so_opp_f3', 'so_opp_bx', 'pr_x_x']
CHK = [(1, 0), (1, 9), (1, 18), (1, 27), (1, 36), (2, 0), (2, 9), (2, 18), (2, 27), (2, 36)]
SET = [(0, 0), (0.15, 0), (0.25, 0), (0.35, 0), (0.45, 0), (0.55, 0), (0.25, 0.15), (0.35, 0.15), (0, 0.15)]
NB = int(sys.argv[2]) if len(sys.argv) > 2 else 600

def fit_act(cp, rates, mtot):
    X = np.column_stack([np.ones(len(cp)), M.feature_matrix(cp, rates, NAMES, mean_total=mtot)])
    off = np.log(np.maximum(cp.offset.values, 1e-9))
    b = M.poisson_fit(X, cp.y.values.astype(float), off, ridge=np.r_[0.0, np.full(len(NAMES), 30.0)])
    b[0] -= np.log(cp.y.values.sum() / np.exp(off).sum())
    return b

def sim_pt(P, half, t0, score, reds, last, end, mh, ma, rng):
    n = len(mh)
    tot = {1: np.zeros(n), 0: np.zeros(n)}
    sh, sa = np.full(n, float(score[0])), np.full(n, float(score[1]))
    lc = {1: np.full(n, -1e9 if last[0] is None else last[0]), 0: np.full(n, -1e9 if last[1] is None else last[1])}
    man = {1: np.sign(reds[1] - reds[0]), 0: np.sign(reds[0] - reds[1])}
    mlt = {1: mh, 0: ma}
    st = np.array(P['state'])
    t = float(t0)
    while t < end - 1e-9:
        mi = int(t // 60); step = min(60.0 - (t - mi * 60), end - t); dt = step / 60.0
        b = P['bin'][(half - 1) * 10 + min(mi // 5, 9)]
        for side in (1, 0):
            diff = (sh - sa) if side == 1 else (sa - sh)
            clu = np.where(t - lc[side] <= P['cluSec'], P['clu'], 1.0)
            lam = b * (P['home'] if side == 1 else 1.0) * P['man'][int(man[side]) + 1] * st[M.state_idx(diff)] * clu * mlt[side] * dt
            k = rng.poisson(lam); tot[side] += k
            lc[side] = np.where(k > 0, t + step / 2, lc[side])
            g = rng.poisson(P['goal'][half - 1][side] * dt, n)
            if side == 1: sh = sh + g
            else: sa = sa + g
        t += step
    return tot[1], tot[0]

rng = np.random.default_rng(7)
z0 = rng.standard_normal(NB); u0 = rng.standard_normal(NB)
rows = []
ck = ev[ev.code == 'ck']
for lg in LEAGUES:
    t1 = time.time()
    cp = pd.read_pickle(f"{W}/cp_no_{lg.replace(' ', '')}.pkl"); P, rates = cp.attrs['P'], cp.attrs['rates']
    cp = cp[cp.prior.notna()]
    mtot = ev[(ev.code == 'ck') & ev.match_id.isin(mt[mt.league != lg].match_id)].shape[0] / (mt.league != lg).sum()
    b = fit_act(cp[cp.league != lg], rates, mtot)
    te = cp[cp.league == lg]; te = te[[(h, c) in CHK for h, c in zip(te.half, te.c)]]
    te = te.assign(m=np.exp(np.column_stack([np.ones(len(te)), M.feature_matrix(te, rates, NAMES, mean_total=mtot)]) @ b))
    for (mid, half, c), g in te.groupby(['match_id', 'half', 'c']):
        if len(g) != 2: continue
        h, a = g[g.side == 1].iloc[0], g[g.side == 0].iloc[0]
        t0 = c * 60.0
        cm = ck[(ck.match_id == mid) & (ck.period == half)]
        hh, ha = int(((cm.side == 1) & (cm.t < t0)).sum()), int(((cm.side == 0) & (cm.t < t0)).sum())
        fh, fa = int((cm.side == 1).sum()), int((cm.side == 0).sum())
        last = [None if np.isnan(h.lastc) else h.lastc, None if np.isnan(a.lastc) else a.lastc]
        mh = np.concatenate([h.m * np.exp(s * z0 - s * s / 2 + w * u0 - w * w / 2) for s, w in SET])
        ma = np.concatenate([a.m * np.exp(-s * z0 - s * s / 2 + w * u0 - w * w / 2) for s, w in SET])
        rh, ra = sim_pt(P, half, t0, [h.g_home, h.g_away], [h.r_home, h.r_away], last, h.plen, mh, ma, rng)
        for k, sw in enumerate(SET):
            sl = slice(k * NB, (k + 1) * NB)
            dnow = rh[sl] - ra[sl]; tot = rh[sl] + ra[sl]
            for line in (-1.5, -0.5, 0.5, 1.5):
                rows.append((lg, half, c, k, 'hc0', line, float((dnow + hh - ha + line > 0).mean()), int(fh - fa + line > 0)))
                rows.append((lg, half, c, k, 'hcnow', line, float((dnow + line > 0).mean()), int((fh - hh) - (fa - ha) + line > 0)))
            for line in (0.5, 1.5, 2.5, 3.5, 4.5, 5.5):
                if hh + ha < line + 1 and line < hh + ha + 7:
                    rows.append((lg, half, c, k, 'tot', line, float((tot + hh + ha > line).mean()), int(fh + fa > line)))
    print(lg, 'done', round(time.time() - t1), 's', flush=True)
df = pd.DataFrame(rows, columns=['lg', 'half', 'c', 'k', 'kind', 'line', 'p', 'win'])
df.to_pickle(sys.argv[1])
eps = 1e-3
df['ll'] = -(df.win * np.log(np.clip(df.p, eps, 1 - eps)) + (1 - df.win) * np.log(np.clip(1 - df.p, eps, 1 - eps)))
df['br'] = (df.p - df.win) ** 2
for kind in ('hc0', 'hcnow', 'tot'):
    d = df[df.kind == kind]
    base = d[d.k == 0].groupby('lg').ll.sum()
    print(kind)
    for k, sw in enumerate(SET):
        x = d[d.k == k]
        per = (1 - x.groupby('lg').ll.sum() / base) * 100
        print(f'  s={sw[0]:.2f} w={sw[1]:.2f}  logloss {x.ll.mean():.5f}  Brier {x.br.mean():.5f}  vs none ' + ' '.join(f'{v:+.2f}%' for v in per.values))
