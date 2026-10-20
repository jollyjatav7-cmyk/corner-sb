"""How a team's corner rate changes with the score, split by favourite / even / underdog.
Within-match estimate (team-match fixed effects), so a strong team simply having more corners does not leak in.
Strength = season goal difference per game (leave this match out), team minus opponent.
Usage: python3 -I state_by_strength.py <work2> <out_json>
"""
import json
import os
import sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model2 as M  # noqa: E402

W, OUT = sys.argv[1], sys.argv[2]
mt = pd.read_csv(os.path.join(W, 'mt.csv'))
sl = pd.read_pickle(os.path.join(W, 'slots2.pkl'))
# season goal difference per game, leave-one-out
rows = []
for m in mt.itertuples():
    rows.append((m.match_id, m.league, m.home, m.home_score - m.away_score))
    rows.append((m.match_id, m.league, m.away, m.away_score - m.home_score))
g = pd.DataFrame(rows, columns=['match_id', 'league', 'team', 'gd'])
agg = g.groupby(['league', 'team']).gd.agg(['sum', 'count'])
g['loo'] = [(agg.loc[(lg, t), 'sum'] - x) / (agg.loc[(lg, t), 'count'] - 1) for lg, t, x in zip(g.league, g.team, g.gd)]
side_tab = pd.concat([mt[['match_id', 'home']].rename(columns={'home': 'team'}).assign(side=1),
                      mt[['match_id', 'away']].rename(columns={'away': 'team'}).assign(side=0)])
g = g.merge(side_tab, on=['match_id', 'team'])
opp = g[['match_id', 'side', 'loo']].assign(side=lambda d: 1 - d.side).rename(columns={'loo': 'oloo'})
g = g.merge(opp, on=['match_id', 'side'])
g['diff'] = g['loo'] - g['oloo']
g['grp'] = np.select([g['diff'] > 0.5, g['diff'] < -0.5], [2, 0], 1)  # 2 favourite, 1 even, 0 underdog
sl = sl.merge(g[['match_id', 'side', 'grp', 'diff']], on=['match_id', 'side'])
# design: 20 time bins (bin 0 = reference), man (2), cluster, state x group (state 2 = level is reference)
STN = ['trail2', 'trail1', 'level', 'lead1', 'lead2']
cols = []
X = []
for b in range(1, 20):
    X.append((sl.bin.values == b).astype(float)); cols.append(f'bin{b}')
X.append((sl.man.values == -1).astype(float)); cols.append('man_down')
X.append((sl.man.values == 1).astype(float)); cols.append('man_up')
X.append(sl.cluster.values.astype(float)); cols.append('cluster')
for grp in (0, 1, 2):
    for st in (0, 1, 3, 4):
        X.append(((sl.grp.values == grp) & (sl.state.values == st)).astype(float)); cols.append(f'g{grp}_{STN[st]}')
X = np.column_stack(X)
y = sl.corners.values.astype(float)
lexpo = np.log(sl.expo.values)
key = sl.match_id.astype(str) + '_' + sl.side.astype(str)
codes, uniq = pd.factorize(key)
N = np.bincount(codes, weights=y)
keep = N[codes] > 0
X, y, lexpo, codes = X[keep], y[keep], lexpo[keep], codes[keep]
beta = np.zeros(X.shape[1])
for it in range(30):
    eta = X @ beta + lexpo
    den = np.bincount(codes, weights=np.exp(eta))
    alpha = np.log(N[codes] / den[codes])
    nb = M.poisson_fit(X, y, alpha + lexpo, ridge=np.full(X.shape[1], 0.5))
    if np.max(np.abs(nb - beta)) < 1e-6:
        beta = nb
        break
    beta = nb
# standard errors from the Poisson information at the solution (approximate, ignores FE uncertainty)
mu = np.exp(X @ beta + alpha + lexpo)
info = X.T @ (X * mu[:, None])
se = np.sqrt(np.diag(np.linalg.inv(info + np.eye(len(beta)) * 1e-6)))
res = {c: {'mult': round(float(np.exp(b)), 3), 'lo': round(float(np.exp(b - 1.96 * s)), 3), 'hi': round(float(np.exp(b + 1.96 * s)), 3)}
       for c, b, s in zip(cols, beta, se) if not c.startswith('bin')}
mins = sl.groupby(['grp', 'state']).expo.sum().unstack().round(0)
res['minutes_by_group_state'] = {int(k): {STN[int(s)]: float(v) for s, v in row.items()} for k, row in mins.iterrows()}
res['n_teammatch'] = {int(k): int(v) for k, v in g.grp.value_counts().items()}
json.dump(res, open(OUT, 'w'), indent=1)
for c in cols:
    if not c.startswith('bin'):
        print(c, res[c])
print(res['minutes_by_group_state'])
