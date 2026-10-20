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
cases = [([{'f3': 12, 'bx': 4, 'cr': 3}, {'f3': 6, 'bx': 1, 'cr': 2}], 20.0, None),
         ([{'f3': 25, 'bx': 9, 'cr': 7}, {'f3': 10, 'bx': 3, 'cr': 2}], 35.0, 11.5),
         ([{'f3': 3, 'bx': 0, 'cr': 1}, {'f3': 9, 'bx': 4, 'cr': 3}], 6.0, None)]
py = []
for cnt, el, exp in cases:
    names = d['features'] + (['pr_x_x'] if exp else [])
    coef = d['coefPrior'] if exp else d['coefNoPrior']
    out = []
    for i in (0, 1):
        z = coef[0]
        for j, nm in enumerate(names):
            kind, who, g = nm.split('_')
            if kind == 'pr':
                x = np.log(exp / d['meanTotal'])
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
console.log(JSON.stringify(cases.map(([c, e, x]) => m.mMultipliers(c, e, m.MODEL.rates, x).mult.map(v => +v.toFixed(4)))));
""", DEV, json.dumps(cases)], capture_output=True, text=True, check=True).stdout
print('python', py)
print('js    ', js.strip())
# model.json keeps 5 significant digits, so allow tiny rounding differences
diff = float(np.max(np.abs(np.array(json.loads(js)) - np.array(py))))
print('MATCH' if diff < 1e-3 else 'MISMATCH', 'max diff', round(diff, 5))
