"""Pre-match corner predictions with game-state scenarios for the 2026-10-20 Champions League matches.

Inputs: statz.ai last-10 averages (corners, shots, crosses for/against) per team, domestic league means,
        market 1X2 and over 2.5 probabilities. Models fitted on StatsBomb 2015/16 (prematch_fit.json,
        state_by_strength.json, base minute profile from model_js3.json).
Usage: python3 -I tonight.py <prematch_fit.json> <state_by_strength.json> <model_js3.json> <out_json> [calib|nospread]
  calib    : print how much spread the simulation gives against the backtest targets, then stop
  nospread : same predictions without the random effects (for comparison)
Revised 2026-10-20 22:00 JST after backtest_prematch.py: no both-strong boost, random effects added, fresh odds.
"""
import json
import sys
import numpy as np
from scipy.optimize import minimize
from scipy.stats import poisson

PF, SBS, MJ, OUT = sys.argv[1:5]
pf = json.load(open(PF))
sbs = json.load(open(SBS))
base = json.load(open(MJ))['base']

# ---------------------------------------------------------------- league means (from statz.ai league tables, per team per match)
TOT = {  # match total corners per game, every team in the league table
    'PL': [11.5, 11.29, 10.71, 10.43, 10.29, 10.29, 9.86, 9.71, 9.71, 9.57, 9.43, 9.14, 8.86, 8.71, 8.57, 8.5, 8.43, 8.14, 8, 7.43],
    'LaLiga': [12.89, 11.89, 11.56, 11.43, 11.22, 10.67, 10.57, 10.44, 10.22, 9.78, 9.5, 9.22, 9.11, 8.89, 8.5, 8.44, 8.44, 7.78, 7.44, 6.44],
    'Ligue1': [13.14, 12.14, 12.14, 10.57, 10.57, 10.14, 9.29, 9, 8.86, 8.86, 8.71, 8.57, 8.57, 8.14, 8.14, 7.57, 7.57, 7.43],
    'SerieA': [12.29, 11.86, 11.29, 10.71, 10.57, 10.5, 10.29, 10.14, 9.57, 9.33, 9.14, 9.14, 9.14, 8.86, 8.67, 8.43, 8, 7.71, 7.33, 6.14],
    'Bundesliga': [12.83, 12.67, 12.33, 12.33, 12.33, 11.67, 11.5, 11.33, 10.67, 10.5, 9.83, 9.83, 9.5, 9.5, 9.33, 9.33, 8.83, 8.67],
    'Portugal': [10.38, 10.25, 10, 9.88, 9.63, 9.63, 9.5, 9.38, 9.13, 8.63, 8.5, 8.38, 8, 7.88, 7.5, 7.38, 7.25, 7],
    'Eredivisie': [12.56, 11.67, 11.56, 11, 11, 10.78, 10.67, 10.67, 10.44, 10, 10, 10, 9.67, 9.44, 9.44, 9.33, 9.11, 8.89],
}
SHOTS = {  # shots for per game
    'PL': [19.71, 15, 12.29, 14.71, 17.86, 14.14, 14.43, 10.14, 11, 17.14, 11.86, 10.29, 15.71, 14.29, 12, 11.57, 14.57, 10.57, 15.14, 12.43],
    'LaLiga': [16.44, 14.11, 14.38, 17.56, 16.33, 21.22, 11.22, 17.67, 11.88, 11.33, 11.11, 10.89, 11, 12.67, 12.78, 14.71, 11.78, 11.67, 10.78, 9.44],
    'Ligue1': [20.86, 16.29, 13.57, 17.57, 13.14, 12.29, 15.57, 13.57, 12.29, 10.57, 12.14, 14.43, 14.57, 11.71, 14.57, 12.57, 11.86, 9.86],
    'SerieA': [17.43, 21.71, 21.71, 16.71, 15.71, 14, 13.29, 14.29, 10.57, 18.14, 16.57, 10.71, 14.29, 11.14, 9.71, 11.14, 12.43, 12.86, 17, 12.29],
    'Bundesliga': [16.17, 17.17, 17.83, 11.17, 15.17, 24.33, 14.67, 13.67, 16, 17.83, 19.67, 11.17, 17.67, 14, 13, 14.83, 16.17, 10.17],
    'Portugal': [19.63, 10, 13, 17.75, 16.38, 10.88, 9.63, 10.5, 13.38, 12.13, 9.88, 7.63, 12.75, 7.88, 13.5, 10, 12.88, 13.25],
    'Eredivisie': [22.89, 15.67, 21.44, 11.67, 14.67, 20.44, 12, 12.78, 19.78, 15, 15.33, 10.11, 11.22, 11.89, 15.33, 11.11, 17.33, 11.78],
}
CROSSES = {  # total crosses for per game
    'PL': [17.71, 18.71, 21.57, 19.14, 22.71, 19, 16.14, 20.57, 18.71, 18.57, 16, 22.14, 16.14, 16.86, 19.14, 17.29, 15.29, 13.43, 9.43, 16.57],
    'Ligue1': [28, 26.86, 20.14, 15, 14.71, 21.14, 17, 18.29, 24.71, 20.71, 13.14, 15.14, 13.86, 17.29, 16.29, 11.43, 13.29, 14.86],
    'LaLiga': [19, 17.56, 18.78, 18.78, 16.89, 18, 16.56, 13.56, 22.14, 15.89, 16.67, 15.78, 14.78, 15.78, 16.67, 15.44, 11.33, 13.56, 15.89, 12.11],
    'Bundesliga': [24.6, 26.2, 18.4, 21.25, 15.8, 19.6, 12.4, 19.8, 23.4, 16.6, 21, 19, 14.2, 19.4, 17.25, 9.25, 12.4, 20.2],
    'SerieA': [15.67, 15.67, 15.67, 15.33, 12.67, 23, 18, 16.25, 15.25, 17.25, 17.67, 22.33, 21.67, 14.25, 14, 15.25, 11.67, 18.5, 20.67, 11],
}
LM = {}
for lg in set(TOT) | set(SHOTS) | set(CROSSES) | {'Greece', 'Norway'}:
    ck = np.mean(TOT[lg]) / 2 if lg in TOT else None
    sh = np.mean(SHOTS[lg]) if lg in SHOTS else None
    cr = np.mean(CROSSES[lg]) if lg in CROSSES else None
    LM[lg] = {'ck': ck, 'sh': sh, 'cr': cr}
DEF = {k: float(np.mean([v[k] for v in LM.values() if v[k] is not None])) for k in ('ck', 'sh', 'cr')}
for lg in LM:
    for k in ('ck', 'sh', 'cr'):
        if LM[lg][k] is None:
            LM[lg][k] = DEF[k]

# ---------------------------------------------------------------- teams: statz.ai last 10 matches (all competitions)
T = {
    'PSG': dict(zh='巴黎圣日耳曼', lg='Ligue1', ckF=6.0, ckA=2.9, shF=21.7, shA=12.1, crF=15.5, crA=11.8),
    'Barcelona': dict(zh='巴塞罗那', lg='LaLiga', ckF=7.5, ckA=2.1, shF=22.6, shA=6.3, crF=12.7, crA=9.5),
    'Liverpool': dict(zh='利物浦', lg='PL', ckF=5.8, ckA=4.8, shF=16.2, shA=12.1, crF=18.5, crA=15.4),
    'Villarreal': dict(zh='比利亚雷亚尔', lg='LaLiga', ckF=6.5, ckA=4.7, shF=16.4, shA=12.0, crF=15.9, crA=15.1),
    'ManCity': dict(zh='曼城', lg='PL', ckF=5.7, ckA=3.6, shF=16.3, shA=10.4, crF=17.2, crA=13.2),
    'AEK': dict(zh='雅典AEK', lg='Greece', ckF=6.0, ckA=3.5, shF=15.9, shA=11.5, crF=18.9, crA=11.7),
    'Stuttgart': dict(zh='斯图加特', lg='Bundesliga', ckF=6.4, ckA=5.4, shF=16.9, shA=15.5, crF=20.3, crA=15.4),
    'Atletico': dict(zh='马德里竞技', lg='LaLiga', ckF=5.8, ckA=3.6, shF=16.4, shA=10.4, crF=18.6, crA=15.2),
    'Napoli': dict(zh='那不勒斯', lg='SerieA', ckF=5.2, ckA=4.3, shF=14.7, shA=16.1, crF=16.0, crA=15.1),
    'Bodo': dict(zh='博德闪耀', lg='Norway', ckF=5.6, ckA=3.5, shF=17.3, shA=11.0, crF=19.8, crA=15.9),
    'Porto': dict(zh='波尔图', lg='Portugal', ckF=5.7, ckA=3.9, shF=14.7, shA=11.9, crF=19.6, crA=14.4),
    'PSV': dict(zh='埃因霍温', lg='Eredivisie', ckF=6.5, ckA=3.5, shF=17.8, shA=11.7, crF=22.1, crA=11.9),
}

GD10 = {'PSG': 1.2, 'Barcelona': 3.2, 'Liverpool': 0.7, 'Villarreal': 0.1, 'ManCity': 1.7, 'AEK': 0.6, 'Stuttgart': 0.5,
        'Atletico': 1.0, 'Napoli': 0.1, 'Bodo': 0.8, 'Porto': 1.3, 'PSV': 1.4}


def strong_fix(h, a):
    """No correction. The first version added +10% when both teams dominate their usual opponents (44 StatsBomb matches:
    10.9 actual vs 9.9 predicted). The out-of-sample check (backtest_prematch.py, 1,277 matches, leave-one-league-out)
    found no trend with the weaker team's last-10 goal difference (slope 0.006 +- 0.022 on the log scale) and a worse
    held-out fit with any correction, so the +10% was noise in a small bin."""
    return 1.0


# ---------------------------------------------------------------- spread beyond Poisson (fitted on the backtest, see calib mode)
# Each simulated match draws a shared level G ~ Gamma(K_TOT), a match split u ~ N(0, SIG_U) and a split per half
# uh ~ N(0, SIG_H): home rate x G*exp(u+uh), away rate x G*exp(-u-uh) (mean-corrected). Without them the simulation
# treats the pre-match numbers as exact and over-states how sure the over/under and handicap probabilities are.
# Sizes chosen so the simulation reproduces the held-out spread of (actual - predicted) on 1,277 StatsBomb matches:
# variance/mean of the total 1.15 (full match), 1.05 (first half); of the home-away difference 1.61 / 1.34; and the
# first-/second-half covariances (run with 'calib' to see them). Most of the extra split is per half, not per match.
K_TOT, SIG_U, SIG_H = 100.0, 0.06, 0.23
if len(sys.argv) > 5 and sys.argv[5] == 'nospread':   # for comparison only
    K_TOT = SIG_U = SIG_H = 0.0


# ---------------------------------------------------------------- mentality: tweaks on top of the measured favourite/even/underdog factors
# lead / trail: extra multiplier when this team leads / trails; late: multiplier while level after 60' (must-win teams)
MENT = {
    'PSG': dict(lead=1.12, trail=1.0, late=1.0), 'Barcelona': dict(lead=1.12, trail=1.0, late=1.0),
    'Liverpool': dict(lead=1.08, trail=1.0, late=1.0), 'Villarreal': dict(lead=1.0, trail=1.0, late=1.0),
    'ManCity': dict(lead=1.05, trail=1.0, late=1.0), 'AEK': dict(lead=1.0, trail=0.92, late=1.0),
    'Stuttgart': dict(lead=1.12, trail=1.0, late=1.0), 'Atletico': dict(lead=0.85, trail=1.0, late=1.0),
    'Napoli': dict(lead=0.87, trail=1.08, late=1.10), 'Bodo': dict(lead=1.0, trail=1.0, late=1.0),
    'Porto': dict(lead=1.0, trail=1.08, late=1.10), 'PSV': dict(lead=1.0, trail=1.0, late=1.0),
}
MATCHES = [  # home, away, kick-off JST (Oct 21), market P(home), P(draw), P(away), P(over 2.5) -- margin removed
    # PSG-Barca: Bet365 2.45/4.20/2.45, O2.5 1.20 (kickoff.co.uk); Kalshi 40/20/41, O2.5 82%; Polymarket O2.5 81% (covers, lines.com)
    ('PSG', 'Barcelona', '04:00', 0.39, 0.21, 0.40, 0.80),
    # Bet365 1.48/4.50/6.25, O2.5 1.44 / U 2.75 (kickoff.co.uk)
    ('Liverpool', 'Villarreal', '04:00', 0.639, 0.210, 0.151, 0.656),
    # Kalshi 88/9/4, O2.5 78% (squawka); City by 2+ 73%, by 3+ 52% (kalshi)
    ('ManCity', 'AEK', '04:00', 0.871, 0.089, 0.040, 0.78),
    # Bet365 3.30/3.60/2.10, O2.5 1.53 / U 2.50 (kickoff.co.uk)
    ('Stuttgart', 'Atletico', '04:00', 0.287, 0.263, 0.450, 0.62),
    # Bet365 1.75/3.90/4.20, O2.5 1.62 / U 2.30 (kickoff.co.uk); DraftKings -132/+300/+330 (gainblers)
    ('Napoli', 'Bodo', '04:00', 0.54, 0.24, 0.22, 0.59),
    # Bet365 1.57/4.50/5.00, O2.5 1.50 / U 2.63 (kickoff.co.uk)
    ('Porto', 'PSV', '04:00', 0.601, 0.210, 0.189, 0.637),
]


def goal_rates(ph, pd_, pa, po):
    """Match expected goals (home, away) that best reproduce the market 1X2 and over 2.5."""
    k = np.arange(11)

    def probs(lh, la):
        m = np.outer(poisson.pmf(k, lh), poisson.pmf(k, la))
        tot = np.add.outer(k, k)
        return np.tril(m, -1).sum(), np.trace(m), np.triu(m, 1).sum(), m[tot > 2].sum()

    def loss(x):
        h, d, a, o = probs(np.exp(x[0]), np.exp(x[1]))
        return (h - ph) ** 2 + (d - pd_) ** 2 + (a - pa) ** 2 + 0.5 * (o - po) ** 2
    r = minimize(loss, [np.log(1.5), np.log(1.1)], method='Nelder-Mead', options={'xatol': 1e-6, 'fatol': 1e-10})
    lh, la = np.exp(r.x)
    return float(lh), float(la), [round(float(v), 3) for v in probs(lh, la)]


def pre_match(h, a, lh, la):
    """Expected corners, shots and crosses for each team from last-10 indices + expected-goal supremacy."""
    c = pf['coef2']['idx+sup']
    out = {}
    for me, op, home, sup in ((h, a, 1.0, np.log(lh / la)), (a, h, 0.0, np.log(la / lh))):
        tm, to = T[me], T[op]
        lmm, lmo = LM[tm['lg']], LM[to['lg']]
        x = {
            'xF_ck': np.log(tm['ckF'] / lmm['ck']), 'xA_ck': np.log(to['ckA'] / lmo['ck']),
            'xF_sh': np.log(tm['shF'] / lmm['sh']), 'xA_sh': np.log(to['shA'] / lmo['sh']),
            'xF_cr': np.log(tm['crF'] / lmm['cr']), 'xA_cr': np.log(to['crA'] / lmo['cr']),
        }
        mu = {k: (lmm[k] + lmo[k]) / 2 for k in ('ck', 'sh', 'cr')}
        eta = c['c'] + c['home'] * home + c['sup'] * sup + sum(c[k] * v for k, v in x.items())
        ck = mu['ck'] * np.exp(eta)
        cs, cc = pf['coef_sh_sup'], pf['coef_cr_sup']
        sh = mu['sh'] * np.exp(cs['c'] + cs['home'] * home + cs['xF_sh'] * x['xF_sh'] + cs['xA_sh'] * x['xA_sh'] + cs['sup'] * sup)
        cr = mu['cr'] * np.exp(cc['c'] + cc['home'] * home + cc['xF_cr'] * x['xF_cr'] + cc['xA_cr'] * x['xA_cr'] + cc['sup'] * sup)
        out[me] = {'ck': float(ck), 'sh': float(sh), 'cr': float(cr), 'mu': mu, 'x': {k: round(float(v), 3) for k, v in x.items()}, 'sup': float(sup)}
    # corners implied by the shot / cross forecasts (within-match link fitted on StatsBomb)
    L = pf['link_sh_cr']
    for me, op, home in ((h, a, 1.0), (a, h, 0.0)):
        o, oo = out[me], out[op]
        m = lambda v, mu: np.log((v + 1) / (mu + 1))
        eta = L['c'] + L['home'] * home + L['m_sh'] * m(o['sh'], o['mu']['sh']) + L['m_cr'] * m(o['cr'], o['mu']['cr']) + L['m_sh_a'] * m(oo['sh'], oo['mu']['sh'])
        o['ck_via_link'] = float(o['mu']['ck'] * np.exp(eta))
    return out


def grp_of(p_win, p_lose):
    return 2 if p_win >= 0.55 else 0 if p_lose >= 0.55 else 1


STN = ['trail2', 'trail1', 'level', 'lead1', 'lead2']


def state_mult(team, grp):
    v = {s: (sbs[f'g{grp}_{s}']['mult'] if s != 'level' else 1.0) for s in STN}
    mt = MENT[team]
    for s in ('lead1', 'lead2'):
        v[s] *= mt['lead']
    for s in ('trail1', 'trail2'):
        v[s] *= mt['trail']
    return np.array([v[s] for s in STN])


HALF = (48, 51)  # minutes incl. typical stoppage time
BIN = np.array(base['bin'])


def minute_profile():
    prof = []
    for half, n in ((1, HALF[0]), (2, HALF[1])):
        for mi in range(n):
            prof.append(BIN[(half - 1) * 10 + min(mi // 5, 9)])
    return np.array(prof)


PROF = minute_profile()
GPROF = np.array([base['goal'][0][1]] * HALF[0] + [base['goal'][1][1]] * HALF[1])  # goal timing shape (home series)
GPROF = GPROF / GPROF.sum()


def simulate(h, a, lh, la, rh, ra, grp_h, grp_a, n=40000, seed=7, k_tot=None, sig=None, sig_h=None):
    """Minute simulation. rh, ra = corner rate scale while level; returns per-sim arrays.
    k_tot, sig, sig_h: spread beyond Poisson (defaults K_TOT, SIG_U, SIG_H; 0 switches a part off)."""
    rng = np.random.default_rng(seed)
    k_tot = K_TOT if k_tot is None else k_tot
    sig = SIG_U if sig is None else sig
    sig_h = SIG_H if sig_h is None else sig_h
    G = rng.gamma(k_tot, 1 / k_tot, n) if k_tot else np.ones(n)
    u = rng.normal(0, sig, n) if sig else np.zeros(n)
    uh = rng.normal(0, sig_h, (2, n)) if sig_h else np.zeros((2, n))
    v = sig ** 2 + sig_h ** 2
    sc_h = [rh * G * np.exp(u + uh[i] - v / 2) for i in (0, 1)]
    sc_a = [ra * G * np.exp(-u - uh[i] - v / 2) for i in (0, 1)]
    smh, sma = state_mult(h, grp_h), state_mult(a, grp_a)
    mh, ma = MENT[h], MENT[a]
    gh, ga = np.zeros(n, int), np.zeros(n, int)
    ch, ca = np.zeros(n), np.zeros(n)
    ch1, ca1 = np.zeros(n), np.zeros(n)
    first = np.zeros(n, int)            # 0 none, 1 home, 2 away
    first_min = np.full(n, 999)
    ht_gh, ht_ga = None, None
    ch_after, ca_after = np.zeros(n), np.zeros(n)   # corners after the first goal
    nmin = len(PROF)
    for t in range(nmin):
        if t == HALF[0]:
            ht_gh, ht_ga = gh.copy(), ga.copy()
            ch1, ca1 = ch.copy(), ca.copy()
        diff = gh - ga
        sh_idx = np.select([diff <= -2, diff == -1, diff == 0, diff == 1], [0, 1, 2, 3], 4)
        sa_idx = np.select([-diff <= -2, -diff == -1, -diff == 0, -diff == 1], [0, 1, 2, 3], 4)
        late = (t >= HALF[0] + 15) & (diff == 0)
        hf = 0 if t < HALF[0] else 1
        lam_h = sc_h[hf] * PROF[t] * smh[sh_idx] * np.where(late, mh['late'], 1.0)
        lam_a = sc_a[hf] * PROF[t] * sma[sa_idx] * np.where(late, ma['late'], 1.0)
        kh, ka = rng.poisson(lam_h), rng.poisson(lam_a)
        ch += kh
        ca += ka
        after = first > 0
        ch_after += np.where(after, kh, 0)
        ca_after += np.where(after, ka, 0)
        g1, g2 = rng.poisson(lh * GPROF[t], n), rng.poisson(la * GPROF[t], n)
        newf = (first == 0) & ((g1 + g2) > 0)
        # if both score in the same minute, pick the first scorer at random by rate
        pick_home = rng.random(n) < (lh / (lh + la))
        who = np.where(g1 > 0, np.where(g2 > 0, np.where(pick_home, 1, 2), 1), 2)
        first = np.where(newf, who, first)
        first_min = np.where(newf, t, first_min)
        gh += g1
        ga += g2
    return dict(ch=ch, ca=ca, ch1=ch1, ca1=ca1, gh=gh, ga=ga, ht_gh=ht_gh, ht_ga=ht_ga, first=first, first_min=first_min,
                ch_after=ch_after, ca_after=ca_after)


def calibrate(h, a, lh, la, tgt_h, tgt_a, grp_h, grp_a):
    rh, ra = tgt_h / PROF.sum(), tgt_a / PROF.sum()
    for _ in range(4):
        s = simulate(h, a, lh, la, rh, ra, grp_h, grp_a, n=12000, seed=11)
        rh *= tgt_h / s['ch'].mean()
        ra *= tgt_a / s['ca'].mean()
    return rh, ra


def lines(tot, ls):
    return {str(L): round(float((tot > L).mean()), 3) for L in ls}


def hcap(diff, ls):
    out = {}
    for L in ls:
        v = diff + L
        win = (v > 0).mean()
        push = (v == 0).mean()
        out[str(L)] = {'win': round(float(win), 3), 'push': round(float(push), 3)}
    return out


if len(sys.argv) > 5 and sys.argv[5] == 'calib':
    # How much spread the simulation gives for a typical StatsBomb match (5.77 v 4.51 corners, goals 1.5 v 1.15),
    # compared with the held-out backtest: variance / mean of (actual - predicted) for the total and the difference.
    TARGET = {'ft': (1.146, 1.612), 'h1': (1.051, 1.338)}
    MENT['_H'] = MENT['_A'] = dict(lead=1.0, trail=1.0, late=1.0)
    rh0, ra0 = calibrate('_H', '_A', 1.5, 1.15, 5.77, 4.51, 1, 1)

    def ratios(k, sg, sh, n=80000):
        s = simulate('_H', '_A', 1.5, 1.15, rh0, ra0, 1, 1, n=n, seed=3, k_tot=k, sig=sg, sig_h=sh)
        x2, y2 = s['ch'] - s['ch1'], s['ca'] - s['ca1']
        out = {}
        for key, x, y in (('ft', s['ch'], s['ca']), ('h1', s['ch1'], s['ca1']), ('h2', x2, y2)):
            mu = (x + y).mean()
            out[key] = (round(float((x + y).var() / mu), 3), round(float((x - y).var() / mu), 3))
        out['cov12'] = (round(float(np.cov(s['ch1'] + s['ca1'], x2 + y2)[0, 1]), 3), round(float(np.cov(s['ch1'] - s['ca1'], x2 - y2)[0, 1]), 3))
        return out
    TARGET['h2'] = (1.114, 1.64)
    TARGET['cov12'] = (0.319, 0.592)
    print('target (total, difference):', TARGET)
    print('no spread  :', ratios(0, 0, 0))
    for k, sg, sh in ((K_TOT, SIG_U, SIG_H), (70, 0.245, 0), (90, 0.10, 0.21), (90, 0.06, 0.23)):
        print(f'k={k:>4} sig={sg} sig_h={sh}:', ratios(k, sg, sh))
    sys.exit()

res = {'league_means': LM, 'matches': []}
for h, a, ko, ph, pdw, pa, po in MATCHES:
    lh, la, chk = goal_rates(ph, pdw, pa, po)
    pm = pre_match(h, a, lh, la)
    fix = strong_fix(h, a)
    for tm_ in (h, a):
        for k in ('ck', 'sh', 'cr', 'ck_via_link'):
            pm[tm_][k] *= fix
    grp_h, grp_a = grp_of(ph, pa), grp_of(pa, ph)
    rh, ra = calibrate(h, a, lh, la, pm[h]['ck'], pm[a]['ck'], grp_h, grp_a)
    s = simulate(h, a, lh, la, rh, ra, grp_h, grp_a)
    tot, tot1 = s['ch'] + s['ca'], s['ch1'] + s['ca1']
    tot2 = tot - tot1
    m = {
        'home': h, 'away': a, 'home_zh': T[h]['zh'], 'away_zh': T[a]['zh'], 'ko_jst': ko,
        'market': {'p_home': ph, 'p_draw': pdw, 'p_away': pa, 'p_over25': po},
        'xg': {'home': round(lh, 2), 'away': round(la, 2), 'fit': chk},
        'groups': {'home': grp_h, 'away': grp_a}, 'strong_fix': fix,
        'pct': {'ft': [float(np.percentile(tot, q)) for q in (10, 25, 50, 75, 90)], 'h1': [float(np.percentile(tot1, q)) for q in (10, 25, 50, 75, 90)]},
        'pre': {k: {kk: (round(vv, 2) if isinstance(vv, float) else vv) for kk, vv in v.items()} for k, v in pm.items()},
        'exp': {'home_ft': round(float(s['ch'].mean()), 2), 'away_ft': round(float(s['ca'].mean()), 2), 'total_ft': round(float(tot.mean()), 2),
                'home_h1': round(float(s['ch1'].mean()), 2), 'away_h1': round(float(s['ca1'].mean()), 2), 'total_h1': round(float(tot1.mean()), 2),
                'total_h2': round(float(tot2.mean()), 2)},
        'ft_over': lines(tot, [7.5, 8.5, 9.5, 10.5, 11.5, 12.5]),
        'h1_over': lines(tot1, [2.5, 3.5, 4.5, 5.5]),
        'h2_over': lines(tot2, [3.5, 4.5, 5.5, 6.5]),
        'ft_hcap_home': hcap(s['ch'] - s['ca'], [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5]),
        'h1_hcap_home': hcap(s['ch1'] - s['ca1'], [-1.5, -0.5, 0.5, 1.5]),
        'p_goals': {'home_first': round(float((s['first'] == 1).mean()), 3), 'away_first': round(float((s['first'] == 2).mean()), 3),
                    'no_goal': round(float((s['first'] == 0).mean()), 3)},
    }
    # scenarios by the first goal (who and when)
    sc = []
    defs = [
        ('主队先进球（上半场）', (s['first'] == 1) & (s['first_min'] < HALF[0])),
        ('主队先进球（下半场）', (s['first'] == 1) & (s['first_min'] >= HALF[0])),
        ('客队先进球（上半场）', (s['first'] == 2) & (s['first_min'] < HALF[0])),
        ('客队先进球（下半场）', (s['first'] == 2) & (s['first_min'] >= HALF[0])),
        ('全场 0-0', s['first'] == 0),
    ]
    for name, mk in defs:
        if mk.sum() < 50:
            continue
        sc.append({'name': name, 'p': round(float(mk.mean()), 3),
                   'home_ft': round(float(s['ch'][mk].mean()), 2), 'away_ft': round(float(s['ca'][mk].mean()), 2),
                   'total_ft': round(float(tot[mk].mean()), 2), 'total_h1': round(float(tot1[mk].mean()), 2),
                   'ft_over': lines(tot[mk], [8.5, 9.5, 10.5, 11.5]), 'h1_over': lines(tot1[mk], [3.5, 4.5]),
                   'hcap_m05': round(float(((s['ch'] - s['ca'])[mk] > 0).mean()), 3)})
    m['scenarios'] = sc
    # second half by the half-time score
    ht = []
    for name, mk in (('半场主队领先', s['ht_gh'] > s['ht_ga']), ('半场平局', s['ht_gh'] == s['ht_ga']), ('半场客队领先', s['ht_gh'] < s['ht_ga'])):
        if mk.sum() < 50:
            continue
        ht.append({'name': name, 'p': round(float(mk.mean()), 3),
                   'home_h2': round(float((s['ch'] - s['ch1'])[mk].mean()), 2), 'away_h2': round(float((s['ca'] - s['ca1'])[mk].mean()), 2),
                   'total_h2': round(float(tot2[mk].mean()), 2), 'h2_over': lines(tot2[mk], [3.5, 4.5, 5.5])})
    m['by_halftime'] = ht
    # rate per 10 minutes for each team in each state (what the mentality assumptions imply)
    smh, sma = state_mult(h, grp_h), state_mult(a, grp_a)
    per10 = 10 * float(np.mean(PROF))
    m['rate10'] = {'home': {STN[i]: round(rh * per10 * smh[i], 2) for i in range(5)}, 'away': {STN[i]: round(ra * per10 * sma[i], 2) for i in range(5)}}
    res['matches'].append(m)
    print(f"{h} v {a}: xG {lh:.2f}-{la:.2f} | pre ck {pm[h]['ck']:.2f}-{pm[a]['ck']:.2f} (link {pm[h]['ck_via_link']:.2f}-{pm[a]['ck_via_link']:.2f}) "
          f"sh {pm[h]['sh']:.1f}-{pm[a]['sh']:.1f} cr {pm[h]['cr']:.1f}-{pm[a]['cr']:.1f} | FT {m['exp']['total_ft']} H1 {m['exp']['total_h1']} | "
          f"O9.5 {m['ft_over']['9.5']} O4.5H1 {m['h1_over']['4.5']}")
    for x in sc:
        print('   ', x['name'], x['p'], x['home_ft'], x['away_ft'], x['total_ft'], x['ft_over']['9.5'])
json.dump(res, open(OUT, 'w'), ensure_ascii=False, indent=1)
