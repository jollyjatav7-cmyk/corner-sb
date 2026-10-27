"""Check that the app's JavaScript model gives the same activity multipliers as the Python fit.

Usage (from the repo root): python3 -I dev/model/parity.py
Needs node. Uses dev/data/params3.json (full fit output) and dev/data/model.json (compact app copy).
"""
import json
import os
import subprocess
import numpy as np

DEV = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(DEV, 'data', 'params3.json')))
sr = {1: d['ratesSide']['home'], 0: d['ratesSide']['away']}
cases = [([{'f3': 12, 'bx': 4, 'cr': 3}, {'f3': 6, 'bx': 1, 'cr': 2}], 20.0, None, None),
         ([{'f3': 25, 'bx': 9, 'cr': 7}, {'f3': 10, 'bx': 3, 'cr': 2}], 35.0, 11.5, None),
         ([{'f3': 3, 'bx': 0, 'cr': 1}, {'f3': 9, 'bx': 4, 'cr': 3}], 6.0, None, None),
         ([{'f3': 25, 'bx': 9, 'cr': 7}, {'f3': 10, 'bx': 3, 'cr': 2}], 35.0, 11.5, [0.35, 0.65]),
         ([{'f3': 0, 'bx': 0, 'cr': 0}, {'f3': 0, 'bx': 0, 'cr': 0}], 0.0, 8.5, [0.62, 0.38])]
py = []
for cnt, el, exp, share in cases:
    names = d['features'] + (['pr_x_x'] if exp else []) + (['ps_x_x'] if share else [])
    coef = d['coefSplit'] if share else d['coefPrior'] if exp else d['coefNoPrior']
    out = []
    for i in (0, 1):
        z = coef[0]
        for j, nm in enumerate(names):
            kind, who, g = nm.split('_')
            if kind == 'pr':
                x = np.log(exp / d['meanTotal'])
            elif kind == 'ps':
                x = np.log(2 * share[i])
            else:
                k = i if who == 'own' else 1 - i
                r = sr[1 - k][g]  # app index 0 = home = side 1 in the fit
                a = r * d['pseudo']
                x = np.log((cnt[k][g] + a) / (r * el + a))
            z += coef[j + 1] * x
        out.append(round(float(np.exp(z)), 4))
    py.append(out)
js = subprocess.run(['node', '-e', """
const fs = require('fs'), path = require('path'), os = require('os');
const dev = process.argv[1];
const src = fs.readFileSync(path.join(dev, 'src', 'model.js'), 'utf8').replace('__MODEL__', fs.readFileSync(path.join(dev, 'data', 'model.json'), 'utf8'));
const tmp = path.join(os.tmpdir(), 'corner_model_parity.js'); fs.writeFileSync(tmp, src);
const m = require(tmp);
const cases = JSON.parse(process.argv[2]);
console.log(JSON.stringify(cases.map(([c, e, x, s]) => m.mMultipliers(c, e, m.MODEL.rates, x, s).mult.map(v => +v.toFixed(4)))));
""", DEV, json.dumps(cases)], capture_output=True, text=True, check=True).stdout
print('python', py)
print('js    ', js.strip())
# model.json keeps 5 significant digits, so allow tiny rounding differences
diff = float(np.max(np.abs(np.array(json.loads(js)) - np.array(py))))
print('MATCH' if diff < 1e-3 else 'MISMATCH', 'max diff', round(diff, 5))

# simulation: handicap and total probabilities with the who-gets-on-top noise (shareSd), JS vs Python, 40,000 runs each
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model2 as M2  # noqa: E402
mj = json.load(open(os.path.join(DEV, 'data', 'model.json')))
P = mj['base']
P['goal'] = [[g[0], g[1]] for g in P['goal']]   # [away, home] like the fit
scases = [(1, 600, [0, 0], [0, 0], [None, None], 2880, [1.0, 1.0]),
          (1, 1800, [1, 0], [0, 0], [1700, None], 2880, [1.3, 0.8]),
          (2, 300, [0, 1], [0, 0], [None, None], 3060, [0.9, 1.2])]
rng = np.random.default_rng(3)
pys = []
for half, t0, sc, rd, last, end, mult in scases:
    h, a = M2.simulate_pt(P, half, t0, sc, rd, last, end, mult, 40000, rng, share_sd=mj['shareSd'])
    d_ = h - a
    pys.append([round(float((d_ - 0.5 > 0).mean()), 3), round(float((d_ + 0.5 > 0).mean()), 3), round(float((h + a > 2.5).mean()), 3)])
jss = subprocess.run(['node', '-e', """
const fs = require('fs'), path = require('path'), os = require('os');
const dev = process.argv[1];
const src = fs.readFileSync(path.join(dev, 'src', 'model.js'), 'utf8').replace('__MODEL__', fs.readFileSync(path.join(dev, 'data', 'model.json'), 'utf8'));
const tmp = path.join(os.tmpdir(), 'corner_model_parity2.js'); fs.writeFileSync(tmp, src);
const m = require(tmp);
const cases = JSON.parse(process.argv[2]);
console.log(JSON.stringify(cases.map(([hf, t0, sc, rd, last, end, mult]) => { const r = m.mSimulate(hf, t0, sc, rd, last, end, mult, 40000, 7);
  const h = m.mHandicap(r, [0, 0], -0.5), h2 = m.mHandicap(r, [0, 0], 0.5); return [+h.home.toFixed(3), +h2.home.toFixed(3), +m.mOver(r, 0, 2.5).toFixed(3)]; })));
""", DEV, json.dumps(scases)], capture_output=True, text=True, check=True).stdout
print('sim python', pys)
print('sim js    ', jss.strip())
sdiff = float(np.max(np.abs(np.array(json.loads(jss)) - np.array(pys))))
print('SIM MATCH' if sdiff < 0.012 else 'SIM MISMATCH', 'max diff', round(sdiff, 4), '(random error about 0.005)')
