"""Half corner model v2: base minute model (time, home, score, red cards, recent corner)
plus a checkpoint model that scales each team's remaining corner rate by its logged activity.

Library module; see fit2.py for fitting and validation.
"""
import numpy as np
import pandas as pd

CLUSTER = 180.0
GROUPS = {'f3': ['f3'], 'bx': ['bx', 'co'], 'cr': ['co', 'cf'], 'sh': ['sb', 'ss', 'so', 'sg'],
          'sbs': ['sb', 'ss'], 'ck': ['ck']}
GOAL = ['sg', 'og']


def state_idx(diff):
    return np.select([diff <= -2, diff == -1, diff == 0, diff == 1], [0, 1, 2, 3], 4)


# ---------------------------------------------------------------- base minute model
def build_slots(ev, mt):
    evg = {k: g for k, g in ev.groupby('match_id')}
    out = []
    for m in mt.itertuples():
        e = evg.get(m.match_id, ev.iloc[0:0])
        cg = {1: 0, 0: 0}
        cr = {1: 0, 0: 0}
        for half, plen in ((1, m.p1_len), (2, m.p2_len)):
            eh = e[e.period == half]
            nmin = int(np.ceil(plen / 60.0))
            starts = np.arange(nmin) * 60.0
            ends = np.minimum(starts + 60.0, plen)
            edges = np.append(starts, plen + 1.0)
            gb, rb, gt_all = {}, {}, {}
            for side in (1, 0):
                gt = np.sort(eh[(eh.side == side) & eh.code.isin(GOAL)].t.values)
                rt = np.sort(eh[(eh.side == side) & (eh.code == 'rc')].t.values)
                gt_all[side] = gt
                gb[side] = cg[side] + np.searchsorted(gt, starts, 'left')
                rb[side] = cr[side] + np.searchsorted(rt, starts, 'left')
            for side in (1, 0):
                ct = np.sort(eh[(eh.side == side) & (eh.code == 'ck')].t.values)
                n_c = np.histogram(ct, bins=edges)[0]
                n_g = np.histogram(gt_all[side], bins=edges)[0]
                idx = np.searchsorted(ct, starts, 'left') - 1
                lastc = np.where(idx >= 0, ct[np.clip(idx, 0, None)] if len(ct) else -1e9, -1e9)
                man = rb[1 - side] - rb[side]
                mi = np.arange(nmin)
                out.append(pd.DataFrame({
                    'match_id': m.match_id, 'league': m.league, 'half': half, 'minute': mi, 'side': side,
                    'expo': (ends - starts) / 60.0, 'bin': (half - 1) * 10 + np.minimum(mi // 5, 9),
                    'state': state_idx(gb[side] - gb[1 - side]), 'man': np.sign(man),
                    'cluster': ((starts - lastc) <= CLUSTER).astype(int), 'corners': n_c, 'goals': n_g}))
            for side in (1, 0):
                cg[side] += int(((eh.side == side) & eh.code.isin(GOAL)).sum())
                cr[side] += int(((eh.side == side) & (eh.code == 'rc')).sum())
    return pd.concat(out, ignore_index=True)


def base_design(df):
    X = np.zeros((len(df), 28))
    X[np.arange(len(df)), df.bin.values] = 1
    X[:, 20] = df.side.values
    st = df.state.values
    for j, s in enumerate((0, 1, 3, 4)):
        X[:, 21 + j] = st == s
    X[:, 25] = df.cluster.values
    X[:, 26] = df.man.values < 0
    X[:, 27] = df.man.values > 0
    return X


def poisson_fit(X, y, offset, ridge=None, iters=50):
    """IRLS Poisson regression; ridge is a vector of penalties per column (0 = none)."""
    k = X.shape[1]
    R = np.diag(ridge) if ridge is not None else np.zeros((k, k))
    beta = np.zeros(k)
    if ridge is None:
        beta[:] = 0
    mu0 = max(y.sum() / np.exp(offset).sum(), 1e-9)
    # start from the mean rate spread over the first column block
    eta = offset + np.log(mu0)
    for _ in range(iters):
        mu = np.exp(eta)
        z = eta - offset + (y - mu) / mu
        XtW = X.T * mu
        new = np.linalg.solve(XtW @ X + R + 1e-9 * np.eye(k), XtW @ z)
        if np.max(np.abs(new - beta)) < 1e-10:
            beta = new
            break
        beta = new
        eta = X @ beta + offset
    return beta


def fit_base(slots):
    X = base_design(slots)
    beta = poisson_fit(X, slots.corners.values.astype(float), np.log(slots.expo.values))
    g = slots.groupby(['half', 'side'])
    gr = (g.goals.sum() / g.expo.sum())
    hl = slots[slots.side == 1].groupby(['match_id', 'half']).expo.sum().groupby('half').mean()
    e = np.exp(beta)
    return {
        'bin': [float(x) for x in e[:20]], 'home': float(e[20]),
        'state': [float(e[21]), float(e[22]), 1.0, float(e[23]), float(e[24])],
        'clu': float(e[25]), 'cluSec': CLUSTER, 'man': [float(e[26]), 1.0, float(e[27])],
        'goal': [[float(gr[(1, 0)]), float(gr[(1, 1)])], [float(gr[(2, 0)]), float(gr[(2, 1)])]],
        'halfLen': [float(hl[1]), float(hl[2])],
    }


def base_rate(P, half, mi, side, state, man, clu):
    r = P['bin'][(half - 1) * 10 + min(mi // 5, 9)]
    r *= P['home'] if side == 1 else 1.0
    r *= P['state'][state] * P['man'][int(np.sign(man)) + 1]
    return r * (P['clu'] if clu else 1.0)


def expected_remaining(P, half, t0, end, side, state, man, lastc):
    """Analytic expectation of a team's remaining corners with the current state held fixed."""
    tot = 0.0
    t = t0
    while t < end - 1e-9:
        mi = int(t // 60)
        step = min(60.0 - (t - mi * 60), end - t)
        clu = lastc is not None and (t - lastc) <= CLUSTER
        tot += base_rate(P, half, mi, side, state, man, clu) * step / 60.0
        t += step
    return tot


# ---------------------------------------------------------------- activity features
def activity_rates(ev, mt):
    team_min = 2 * (mt.p1_len.sum() + mt.p2_len.sum()) / 60.0
    return {g: float(ev.code.isin(c).sum() / team_min) for g, c in GROUPS.items()}


def features(counts, elapsed, rates, pseudo):
    """counts: dict group -> (own, opp); elapsed: team minutes so far. Returns dict of log-ratios."""
    f = {}
    for g, (own, opp) in counts.items():
        exp_ = rates[g] * elapsed
        a = rates[g] * pseudo
        f['own_' + g] = np.log((own + a) / (exp_ + a))
        f['opp_' + g] = np.log((opp + a) / (exp_ + a))
    return f


def build_checkpoints(ev, mt, P, rates, cps, recent=10.0, prior=None):
    codes = {c: i for i, c in enumerate(sorted(ev.code.unique()))}
    gidx = {g: np.array([codes[c] for c in cl if c in codes]) for g, cl in GROUPS.items()}
    goal_i = np.array([codes[c] for c in GOAL if c in codes])
    ck_i, rc_i = codes['ck'], codes.get('rc', -1)
    evg = {k: g for k, g in ev.groupby('match_id')}
    rows = []
    for m in mt.itertuples():
        e = evg.get(m.match_id, ev.iloc[0:0])
        per = e.period.values
        tt = e.t.values
        sd = e.side.values
        cd = e.code.map(codes).values
        isgoal = np.isin(cd, goal_i)
        isck = cd == ck_i
        isrc = cd == rc_i
        ing = {g: np.isin(cd, ix) for g, ix in gidx.items()}
        p1 = m.p1_len
        for half, plen in ((1, m.p1_len), (2, m.p2_len)):
            inh = per == half
            prevm = per < half
            for c in cps:
                t0 = c * 60.0
                if t0 >= plen - 30:
                    continue
                nowm = inh & (tt < t0)
                sof = prevm | nowm
                recm = nowm & (tt >= t0 - recent * 60)
                elapsed = (p1 / 60.0 if half == 2 else 0.0) + c
                rel = min(c, recent)
                goals = {s: int((sof & isgoal & (sd == s)).sum()) for s in (1, 0)}
                reds = {s: int((sof & isrc & (sd == s)).sum()) for s in (1, 0)}
                for side in (1, 0):
                    own, opp = sd == side, sd == 1 - side
                    lcm = nowm & isck & own
                    lastc = float(tt[lcm].max()) if lcm.any() else None
                    st = int(state_idx(np.array(goals[side] - goals[1 - side])))
                    man = reds[1 - side] - reds[side]
                    off = expected_remaining(P, half, t0, plen, side, st, man, lastc)
                    y = int((inh & isck & own & (tt >= t0)).sum())
                    row = {'match_id': m.match_id, 'league': m.league, 'half': half, 'c': c, 'side': side,
                           'offset': off, 'y': y, 'elapsed': elapsed, 'rel': rel, 'state': st, 'man': man,
                           'lastc': lastc if lastc is not None else np.nan, 'plen': plen,
                           'g_home': goals[1], 'g_away': goals[0], 'r_home': reds[1], 'r_away': reds[0]}
                    for g, msk in ing.items():
                        row['n_own_' + g] = int((sof & msk & own).sum())
                        row['n_opp_' + g] = int((sof & msk & opp).sum())
                        row['r_own_' + g] = int((recm & msk & own).sum())
                        row['r_opp_' + g] = int((recm & msk & opp).sum())
                    if prior is not None:
                        row['prior'] = prior.get(m.match_id, np.nan)
                    rows.append(row)
    return pd.DataFrame(rows)


def feature_matrix(cp, rates, names, pseudo=15.0, rpseudo=10.0, mean_total=None):
    cols = []
    for nm in names:
        kind, who, g = nm.split('_')  # e.g. so_own_bx (so far) / re_opp_f3 (recent) / pr_x_x
        if kind == 'pr':
            cols.append(np.log(cp.prior.values / mean_total))
            continue
        if kind == 'so':
            n = cp[f'n_{who}_{g}'].values
            el = cp.elapsed.values
            a = rates[g] * pseudo
        else:
            n = cp[f'r_{who}_{g}'].values
            el = cp.rel.values
            a = rates[g] * rpseudo
        cols.append(np.log((n + a) / (rates[g] * el + a)))
    return np.column_stack(cols) if cols else np.zeros((len(cp), 0))


# ---------------------------------------------------------------- simulator (mirrors the app)
def simulate_pt(P, half, t0, score, reds, last, end, mult, n, rng, share_sd=0.0):
    """Like simulate, but returns (home_remaining, away_remaining) and applies the app's who-gets-on-top noise:
    each run draws z ~ N(0, share_sd^2), home x e^(z - sd^2/2), away x e^(-z - sd^2/2) (see make_model_js.py shareSd)."""
    z = rng.standard_normal(n) * share_sd
    mh = mult[0] * np.exp(z - share_sd ** 2 / 2)
    ma = mult[1] * np.exp(-z - share_sd ** 2 / 2)
    tot = {1: np.zeros(n), 0: np.zeros(n)}
    sh, sa = np.full(n, float(score[0])), np.full(n, float(score[1]))
    lc = {1: np.full(n, -1e9 if last[0] is None else last[0]), 0: np.full(n, -1e9 if last[1] is None else last[1])}
    man = {1: np.sign(reds[1] - reds[0]), 0: np.sign(reds[0] - reds[1])}
    mlt = {1: mh, 0: ma}
    st_arr = np.array(P['state'])
    t = float(t0)
    while t < end - 1e-9:
        mi = int(t // 60)
        step = min(60.0 - (t - mi * 60), end - t)
        dt = step / 60.0
        b = P['bin'][(half - 1) * 10 + min(mi // 5, 9)]
        for side in (1, 0):
            diff = (sh - sa) if side == 1 else (sa - sh)
            clu = np.where(t - lc[side] <= P['cluSec'], P['clu'], 1.0)
            lam = b * (P['home'] if side == 1 else 1.0) * P['man'][int(man[side]) + 1] * st_arr[state_idx(diff)] * clu * mlt[side] * dt
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


def simulate(P, half, t0, score, reds, last, end, mult, n, rng):
    """Corners still to come in this half (both teams). score/reds/last/mult are [home, away]."""
    total = np.zeros(n)
    sh = np.full(n, float(score[0]))
    sa = np.full(n, float(score[1]))
    lc = {1: np.full(n, -1e9 if last[0] is None else last[0]), 0: np.full(n, -1e9 if last[1] is None else last[1])}
    man = {1: np.sign(reds[1] - reds[0]), 0: np.sign(reds[0] - reds[1])}
    mlt = {1: mult[0], 0: mult[1]}
    st_arr = np.array(P['state'])
    t = float(t0)
    while t < end - 1e-9:
        mi = int(t // 60)
        step = min(60.0 - (t - mi * 60), end - t)
        dt = step / 60.0
        b = P['bin'][(half - 1) * 10 + min(mi // 5, 9)]
        for side in (1, 0):
            diff = (sh - sa) if side == 1 else (sa - sh)
            stm = st_arr[state_idx(diff)]
            clu = np.where(t - lc[side] <= P['cluSec'], P['clu'], 1.0)
            lam = b * (P['home'] if side == 1 else 1.0) * P['man'][int(man[side]) + 1] * stm * clu * mlt[side] * dt
            k = rng.poisson(lam)
            total += k
            lc[side] = np.where(k > 0, t + step / 2, lc[side])
            g = rng.poisson(P['goal'][half - 1][side] * dt, n)
            if side == 1:
                sh = sh + g
            else:
                sa = sa + g
        t += step
    return total
