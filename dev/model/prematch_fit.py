"""Pre-match models on StatsBomb 2015/16 (1,517 matches), using 'last 10 matches' averages like statz.ai:
  1. corners from corner averages, with / without shot and cross averages (leave-one-league-out deviance)
  2. shots and crosses from their averages
  3. within-match link: corners given the match's own shots and crosses
  4. game-state multipliers split by favourite / underdog
Usage: python3 -I prematch_fit.py <work2> <out_json>
"""
import json
import os
import sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model2 as M  # noqa: E402

W, OUT = sys.argv[1], sys.argv[2]
ev = pd.read_csv(os.path.join(W, 'ev.csv'))
mt = pd.read_csv(os.path.join(W, 'mt.csv'))
SH = ['sb', 'ss', 'so', 'sg']
cnt = ev.assign(sh=ev.code.isin(SH), cr=ev.code.isin(['co', 'cf']), ck=ev.code.eq('ck'), g=ev.code.isin(['sg', 'og']),
                sbs=ev.code.isin(['sb', 'ss'])).groupby(['match_id', 'side'])[['sh', 'cr', 'ck', 'g', 'sbs']].sum().reset_index()
rows = []
for m in mt.itertuples():
    for side, team, opp in ((1, m.home, m.away), (0, m.away, m.home)):
        rows.append({'match_id': m.match_id, 'league': m.league, 'date': m.date, 'side': side, 'team': team, 'opp': opp})
tm = pd.DataFrame(rows).merge(cnt, on=['match_id', 'side'], how='left').fillna(0)
opp = tm[['match_id', 'side', 'sh', 'cr', 'ck', 'g', 'sbs']].copy()
opp['side'] = 1 - opp['side']
tm = tm.merge(opp, on=['match_id', 'side'], suffixes=('', '_a'))  # *_a = what the opponent did = conceded
tm = tm.sort_values(['team', 'date', 'match_id']).reset_index(drop=True)
STATS = ['ck', 'sh', 'cr', 'g', 'sbs']
# last-10 averages before each match (same season), at least 6 prior matches
for s in STATS:
    for suf in ('', '_a'):
        col = s + suf
        tm[f'L10_{col}'] = tm.groupby('team')[col].transform(lambda x: x.shift(1).rolling(10, min_periods=6).mean())
tm['n_prior'] = tm.groupby('team').cumcount()
lg_mean = tm.groupby('league')[STATS].mean()
# attach the opponent's last-10 averages (as of the same match)
cols = [c for c in tm.columns if c.startswith('L10_')]
o = tm[['match_id', 'team'] + cols].rename(columns={'team': 'opp', **{c: 'O' + c for c in cols}})
tm = tm.merge(o, on=['match_id', 'opp'])
d = tm.dropna(subset=cols + ['O' + c for c in cols]).copy()
for s in STATS:
    mu = d.league.map(lg_mean[s])
    d[f'xF_{s}'] = np.log(d[f'L10_{s}'].clip(lower=0.2) / mu)       # own 'for' index
    d[f'xA_{s}'] = np.log(d[f'OL10_{s}_a'].clip(lower=0.2) / mu)   # opponent's 'against' index
d['home'] = d.side.astype(float)
LEAGUES = sorted(d.league.unique())


def fit(df, y, xs):
    X = np.column_stack([np.ones(len(df))] + [df[x].values for x in xs])
    off = np.log(df.league.map(lg_mean[y]).values)
    return M.poisson_fit(X, df[y].values.astype(float), off, ridge=np.r_[0.0, np.full(len(xs), 1.0)])


def dev(df, y, xs, b):
    X = np.column_stack([np.ones(len(df))] + [df[x].values for x in xs])
    mu = np.exp(X @ b + np.log(df.league.map(lg_mean[y]).values))
    yy = df[y].values
    t = np.where(yy > 0, yy * np.log(np.where(yy > 0, yy, 1) / mu), 0.0)
    return float(2 * np.sum(t - (yy - mu)))


SETS = {
    'none': ['home'],
    'corners': ['home', 'xF_ck', 'xA_ck'],
    'corners+shots': ['home', 'xF_ck', 'xA_ck', 'xF_sh', 'xA_sh'],
    'corners+crosses': ['home', 'xF_ck', 'xA_ck', 'xF_cr', 'xA_cr'],
    'corners+shots+crosses': ['home', 'xF_ck', 'xA_ck', 'xF_sh', 'xA_sh', 'xF_cr', 'xA_cr'],
    'shots+crosses': ['home', 'xF_sh', 'xA_sh', 'xF_cr', 'xA_cr'],
}
R = {'n': int(len(d)), 'league_mean': lg_mean.round(3).to_dict(), 'loo': {}}
for nm, xs in SETS.items():
    tot = 0.0
    for lg in LEAGUES:
        b = fit(d[d.league != lg], 'ck', xs)
        tot += dev(d[d.league == lg], 'ck', xs, b)
    R['loo'][nm] = tot
base = R['loo']['none']
R['loo_improve_pct'] = {k: round(100 * (1 - v / base), 2) for k, v in R['loo'].items()}
R['coef'] = {nm: dict(zip(['c'] + xs, [round(float(x), 4) for x in fit(d, 'ck', xs)])) for nm, xs in SETS.items()}
# shots and crosses from their own averages
for s in ('sh', 'cr', 'g'):
    xs = ['home', f'xF_{s}', f'xA_{s}']
    R[f'coef_{s}'] = dict(zip(['c'] + xs, [round(float(x), 4) for x in fit(d, s, xs)]))
# within-match link (actual counts in the same match), log-linear in indices
full = tm.copy()
for s in ('sh', 'cr', 'sbs'):
    mu = full.league.map(lg_mean[s])
    full[f'm_{s}'] = np.log((full[s] + 1) / (mu + 1))
    full[f'm_{s}_a'] = np.log((full[s + '_a'] + 1) / (mu + 1))
full['home'] = full.side.astype(float)
for nm, xs in {'link_sh_cr': ['home', 'm_sh', 'm_cr', 'm_sh_a'], 'link_sbs_cr': ['home', 'm_sbs', 'm_cr', 'm_sh_a']}.items():
    X = np.column_stack([np.ones(len(full))] + [full[x].values for x in xs])
    off = np.log(full.league.map(lg_mean['ck']).values)
    b = M.poisson_fit(X, full.ck.values.astype(float), off, ridge=np.r_[0.0, np.full(len(xs), 1.0)])
    R[nm] = dict(zip(['c'] + xs, [round(float(x), 4) for x in b]))
    mu = np.exp(X @ b + off)
    R[nm + '_r2'] = round(float(np.corrcoef(mu, full.ck)[0, 1] ** 2), 3)
json.dump(R, open(OUT, 'w'), indent=1)
print(json.dumps({k: v for k, v in R.items() if k != 'league_mean'}, indent=1))

# ---------------------------------------------------------------- strength (expected goal supremacy) on top of the indices
cg = R['coef_g']
d['lg_T'] = cg['c'] + cg['home'] * d.home + cg['xF_g'] * d.xF_g + cg['xA_g'] * d.xA_g
# opponent's expected goals: rebuild from the opponent's own row in d
oo = d[['match_id', 'team', 'lg_T']].rename(columns={'team': 'opp', 'lg_T': 'lg_O'})
d = d.merge(oo, on=['match_id', 'opp'])
d['sup'] = d.lg_T - d.lg_O
SETS2 = {'idx': SETS['corners+shots+crosses'], 'idx+sup': SETS['corners+shots+crosses'] + ['sup'], 'corners+sup': ['home', 'xF_ck', 'xA_ck', 'sup'], 'sup': ['home', 'sup']}
R['loo2'] = {}
for nm, xs in SETS2.items():
    tot = 0.0
    for lg in LEAGUES:
        b = fit(d[d.league != lg], 'ck', xs)
        tot += dev(d[d.league == lg], 'ck', xs, b)
    R['loo2'][nm] = round(100 * (1 - tot / base), 2)
    R.setdefault('coef2', {})[nm] = dict(zip(['c'] + xs, [round(float(x), 4) for x in fit(d, 'ck', xs)]))
for s in ('sh', 'cr'):
    xs = ['home', f'xF_{s}', f'xA_{s}', 'sup']
    R[f'coef_{s}_sup'] = dict(zip(['c'] + xs, [round(float(x), 4) for x in fit(d, s, xs)]))
R['sup_sd'] = round(float(d.sup.std()), 3)
json.dump(R, open(OUT, 'w'), indent=1)
print('LOO improve with supremacy', R['loo2'])
print(json.dumps(R['coef2'], indent=1)); print(R['coef_sh_sup'], R['coef_cr_sup'], 'sup sd', R['sup_sd'])
