# 角球数据记录 — source code

The live app is the single file `index.html` in the repo root (served by GitHub Pages).
It is **built** from this folder; edit here, then build.

## Layout

| Path | What it is |
| --- | --- |
| `src/app.html` | The whole app: layout, styles, UI logic, online sync (API-Football, Wikidata). Placeholders `__MODELJS__`, `__VALTEXT__`, `__HCAPTEXT__` are filled by the build. |
| `src/model.js` | Corner model: minute-by-minute Poisson simulation, activity multipliers, over/under and handicap probabilities. `__MODEL__` is replaced by `data/model.json`. |
| `src/sw.js` | Service worker. **Bump `CACHE = 'corner-sb-vN'` on every release**, or phones keep the old version. |
| `data/model.json` | Compact model parameters used by the app (made by `model/make_model_js.py`). |
| `data/params3.json` | Full fit output (used by `model/parity.py`). |
| `data/valtext.txt`, `data/hcaptext.txt` | Validation text shown on the app's 准确度 page. |
| `tests/` | Playwright UI tests (iPad landscape/portrait, iPhone sizes, mocked API-Football and Wikidata). |
| `model/` | Python pipeline that fits the model from StatsBomb open data. |
| `tools/make_icons.py` | Regenerates the home-screen icons. |

## Build and release

```bash
python3 -I dev/build.py            # writes index.html, sw.js, manifest, README to the repo root
python3 -I dev/model/parity.py     # optional: JS model == Python model
```

Then bump the cache name in `dev/src/sw.js` (and rebuild), commit, push to `main`.

## Tests

Needs Node and Playwright (`npm i playwright`; Chromium may need `npx playwright install chromium`).
If Playwright is installed somewhere else, point `PLAYWRIGHT` at it.

```bash
cd <repo root> && python3 -m http.server 8766 &      # serve the built app
cd dev/tests && mkdir -p out
node uitest.js  http://localhost:8766 out            # core flow
node uitest2.js http://localhost:8766 out            # join mid-match, backfill, handicap
node uitest3.js http://localhost:8766 out            # timeline
node uitest4.js http://localhost:8766 out            # auto-bet, full-match lines
node uitest5.js http://localhost:8766 out            # online lookup and sync (mocked)
node uitest6.js http://localhost:8766 out            # screen delay, held sync, sync buttons, expectation lookup, post-match sync (mocked)
node fitphone.js http://localhost:8766 out           # phone layouts fit the screen
node compat.js  http://localhost:8766                # old saved data still loads
```

## Model pipeline (StatsBomb open data, 2015/16 EPL, La Liga, Serie A, Ligue 1 — 1,517 matches)

```bash
git clone https://github.com/statsbomb/open-data sb                       # raw data (large)
python3 -I dev/model/extract1.py sb work                                  # events.csv, matches.csv
python3 -I dev/model/prematch_and_summary.py work work/results.json       # pre-match expectation per match (match_summary.csv)
python3 -I dev/model/extract2.py sb work2                                 # events with the app's definitions: ev.csv, mt.csv
python3 -I dev/model/fit2.py select work2 work/match_summary.csv           # builds slots/checkpoints, feature selection
python3 -I dev/model/fit3.py validate work2 work/match_summary.csv 0.0     # held-out validation
python3 -I dev/model/fit3.py final work2 work/match_summary.csv params3.json
python3 -I dev/model/make_model_js.py params3.json dev/data/model.json
```

Analysis scripts: `extract3.py` (where each corner came from, extra candidate inputs),
`origins_report.py` (numbers for the corner-origin report), `fit4.py` (tests extra buttons such as counters).
