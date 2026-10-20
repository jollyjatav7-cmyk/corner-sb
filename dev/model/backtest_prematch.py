"""Out-of-sample check of the pre-match corner pipeline used for the 2026-10-20 report.

For each league in turn: fit the goals model and the corner model (last-10 indices + expected-goal supremacy)
on the other three leagues, predict the held-out league's matches, then compare
  - mean predicted vs actual corners (overall, by how strong both teams are)
  - calibration of P(over line) for full-match and first-half totals under Poisson
  - the same with extra spread (negative binomial, size k fitted on the held-out predictions)
  - the old "both teams strong +10%" rule, tested league by league (dropped: worse out of sample)
  - spread of the misses per half (sizes of the random effects in tonight.py)
Writes <out_json> and backtest_rows.csv (one row per held-out match) next to it.
Usage: python3 -I backtest_prematch.py <work2> <out_json>
"""
import json
import os
import sys
import numpy as np
import pandas as pd
from scipy.stats import poisson, nbinom
from scipy.optimize import minimize_scalar

W, OUT = sys.argv[1], sys.argv[2]
OUT_FINAL = OUT
HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = ['x', W, os.path.join(os.path.dirname(OUT), '_pf_tmp.json')]
src = open(os.path.join(HERE, 'prematch_fit.py'), encoding='utf-8').read()
src = src.split('# ---------------------------------------------------------------- strength')[0]   # data + base fits only
src = src.replace("print(json.dumps({k: v for k, v in R.items() if k != 'league_mean'}, indent=1))", '')
exec(src)

ev = pd.read_csv(os.path.join(W, 'ev.csv'))
ck1 = ev[(ev.code == 'ck') & (ev.period == 1)].groupby(['match_id', 'side']).size().rename('ck_h1').reset_index()
d = d.merge(ck1, on=['match_id', 'side'], how='left').fillna({'ck_h1': 0})
d['gd10'] = d.L10_g - d.L10_g_a
og = d[['match_id', 'team', 'gd10']].rename(columns={'team': 'opp', 'gd10': 'ogd10'})
d = d.merge(og, on=['match_id', 'opp'], how='left')
XS = ['home', 'xF_ck', 'xA_ck', 'xF_sh', 'xA_sh', 'xF_cr', 'xA_cr', 'sup']
GX = ['home', 'xF_g', 'xA_g']
parts = []
for lg in LEAGUES:
    tr = d[d.league != lg].copy()
    bg = fit(tr, 'g', GX)
    d['lg_T'] = bg[0] + sum(b * d[x] for b, x in zip(bg[1:], GX))
    oo = d[['match_id', 'team', 'lg_T']].rename(columns={'team': 'opp', 'lg_T': 'lg_O'})
    dd = d.drop(columns=[c for c in ('lg_O', 'sup') if c in d.columns]).merge(oo, on=['match_id', 'opp'])
    dd['sup'] = dd.lg_T - dd.lg_O
    tr, te = dd[dd.league != lg], dd[dd.league == lg].copy()
    b = fit(tr, 'ck', XS)
    te['pred'] = te.league.map(lg_mean['ck']) * np.exp(b[0] + sum(c * te[x] for c, x in zip(b[1:], XS)))
    share = tr.ck_h1.sum() / tr.ck.sum()
    te['pred_h1'] = te.pred * share
    parts.append(te[['match_id', 'league', 'side', 'ck', 'ck_h1', 'pred', 'pred_h1', 'gd10', 'ogd10']])
p = pd.concat(parts)
h, a = p[p.side == 1].set_index('match_id'), p[p.side == 0].set_index('match_id')
m = h.join(a, lsuffix='_h', rsuffix='_a', how='inner')
m['y'] = m.ck_h + m.ck_a
m['mu'] = m.pred_h + m.pred_a
m['y1'] = m.ck_h1_h + m.ck_h1_a
m['mu1'] = m.pred_h1_h + m.pred_h1_a
m['gmin'] = np.minimum(m.gd10_h, m.gd10_a)
m.to_csv(os.path.join(os.path.dirname(OUT_FINAL), 'backtest_rows.csv'))
R = {'n_matches': int(len(m)), 'mean_actual': round(float(m.y.mean()), 3), 'mean_pred': round(float(m.mu.mean()), 3),
     'mean_actual_h1': round(float(m.y1.mean()), 3), 'mean_pred_h1': round(float(m.mu1.mean()), 3)}
R['by_strength'] = [{'gmin': str(k), 'n': int(len(g)), 'actual': round(float(g.y.mean()), 2), 'pred': round(float(g.mu.mean()), 2),
                     'ratio': round(float(g.y.sum() / g.mu.sum()), 3)} for k, g in m.groupby(pd.cut(m.gmin, [-9, -0.5, 0, 0.3, 0.6, 9]), observed=True)]
R['by_pred'] = [{'pred': str(k), 'n': int(len(g)), 'actual': round(float(g.y.mean()), 2), 'pred': round(float(g.mu.mean()), 2)}
                for k, g in m.groupby(pd.qcut(m.mu, 5), observed=True)]


def nb_ll(y, mu, k):
    pr = k / (k + mu)
    return float(nbinom.logpmf(y, k, pr).sum())


def fit_k(y, mu):
    r = minimize_scalar(lambda lk: -nb_ll(y, mu, np.exp(lk)), bounds=(0, 8), method='bounded')
    return float(np.exp(r.x)), -float(r.fun)


def over_p(mu, L, k=None):
    if k is None:
        return 1 - poisson.cdf(np.floor(L), mu)
    return 1 - nbinom.cdf(np.floor(L), k, k / (k + mu))


for key, y, mu, lines in (('ft', m.y.values, m.mu.values, [7.5, 8.5, 9.5, 10.5, 11.5, 12.5]), ('h1', m.y1.values, m.mu1.values, [2.5, 3.5, 4.5, 5.5, 6.5])):
    k, ll_nb = fit_k(y, mu)
    ll_po = float(poisson.logpmf(y, mu).sum())
    out = {'k': round(k, 2), 'loglik_poisson': round(ll_po, 1), 'loglik_nb': round(ll_nb, 1), 'var_ratio_actual': round(float(np.var(y - mu) / np.mean(mu)), 3), 'lines': {}}
    for L in lines:
        win = (y > L).astype(float)
        pp, pn = over_p(mu, L), over_p(mu, L, k)
        cal = []
        for lo, hi in ((0, .3), (.3, .45), (.45, .55), (.55, .7), (.7, 1.01)):
            s = (pp >= lo) & (pp < hi)
            if s.sum() >= 30:
                cal.append({'bin': f'{lo:.2f}-{hi:.2f}', 'n': int(s.sum()), 'pred_poisson': round(float(pp[s].mean()), 3), 'pred_nb': round(float(pn[s].mean()), 3), 'actual': round(float(win[s].mean()), 3)})
        out['lines'][str(L)] = {'actual_rate': round(float(win.mean()), 3), 'mean_p_poisson': round(float(pp.mean()), 3), 'mean_p_nb': round(float(pn.mean()), 3),
                                'brier_poisson': round(float(((pp - win) ** 2).mean()), 4), 'brier_nb': round(float(((pn - win) ** 2).mean()), 4), 'calibration': cal}
    R[key] = out
# both-strong correction: does +10% improve the held-out log-likelihood for those matches?
s = m.gmin > 0.6
k = R['ft']['k']
R['strong_fix'] = {'n': int(s.sum()), 'll_without': round(nb_ll(m.y[s].values, m.mu[s].values, k), 2), 'll_with_10pct': round(nb_ll(m.y[s].values, 1.1 * m.mu[s].values, k), 2)}
# the honest test: estimate the boost on three leagues, apply it to the fourth (it was dropped: worse at every threshold)
L, y, mu, g = m.league_h.values, m.y.values, m.mu.values, m.gmin.values
R['strong_fix_lolo'] = {}
for thr in (0.3, 0.6, 0.8, 1.0):
    sel, ll_fix, ll_none, per = g > thr, 0.0, 0.0, {}
    for lg in np.unique(L):
        tr, te = (L != lg) & sel, (L == lg) & sel
        r = y[tr].sum() / mu[tr].sum() if tr.sum() else 1.0
        ll_fix += nb_ll(y[te], mu[te] * r, k)
        ll_none += nb_ll(y[te], mu[te], k)
        per[lg] = {'n': int(te.sum()), 'actual_over_pred': round(float(y[te].sum() / max(mu[te].sum(), 1e-9)), 3)}
    R['strong_fix_lolo'][str(thr)] = {'n': int(sel.sum()), 'll_with_fix': round(ll_fix, 2), 'll_without': round(ll_none, 2), 'by_league': per}
# spread of (actual - predicted) per half, for the simulation's random effects (tonight.py, mode 'calib')
d1 = (m.ck_h1_h - m.ck_h1_a) - (m.pred_h1_h - m.pred_h1_a)
d2 = ((m.ck_h - m.ck_h1_h) - (m.ck_a - m.ck_h1_a)) - ((m.pred_h - m.pred_h1_h) - (m.pred_a - m.pred_h1_a))
t1 = (m.ck_h1_h + m.ck_h1_a) - m.mu1
t2 = (m.y - m.y1) - (m.mu - m.mu1)
R['spread'] = {'ft': [round(float(np.var(m.y - m.mu) / m.mu.mean()), 3), round(float(np.var(d1 + d2) / m.mu.mean()), 3)],
               'h1': [round(float(t1.var() / m.mu1.mean()), 3), round(float(d1.var() / m.mu1.mean()), 3)],
               'h2': [round(float(t2.var() / (m.mu - m.mu1).mean()), 3), round(float(d2.var() / (m.mu - m.mu1).mean()), 3)],
               'cov12': [round(float(np.cov(t1, t2)[0, 1]), 3), round(float(np.cov(d1, d2)[0, 1]), 3)],
               'note': 'variance / mean of (actual - predicted): [total, home minus away]; cov12 = first-half vs second-half covariance'}
json.dump(R, open(OUT_FINAL, 'w'), indent=1)
print(json.dumps(R, indent=1))
