"""Write the compact model JSON used by the app from fit3 final params.
Usage: python3 -I make_model_js.py <params3.json> <out.json>
"""
import json
import sys
d = json.load(open(sys.argv[1]))
r = lambda x, n=5: float(f'%.{n}g' % x)
b = d['base']
out = {
    'base': {'bin': [r(x) for x in b['bin']], 'home': r(b['home']), 'state': [r(x) for x in b['state']], 'clu': r(b['clu']),
             'cluSec': int(b['cluSec']), 'man': [r(x) for x in b['man']], 'goal': [[r(x) for x in g] for g in b['goal']]},
    'rates': [{k: r(v) for k, v in d['ratesSide']['home'].items()}, {k: r(v) for k, v in d['ratesSide']['away'].items()}],
    'groups': {'f3': ['f3'], 'bx': ['bx', 'co'], 'cr': ['co', 'cf'], 'sh': ['sb', 'ss', 'so', 'sg'], 'ck': ['ck']},
    'meanTotal': r(d['meanTotal'], 4), 'features': d['features'],
    'coefNoPrior': [r(x) for x in d['coefNoPrior']], 'coefPrior': [r(x) for x in d['coefPrior']],
    'pseudo': d['pseudo'], 'addDef': [4, 6],
}
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, separators=(',', ':'))
print('written', len(json.dumps(out)))
