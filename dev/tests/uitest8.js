// v13: search with one team name, one-tap pre-match expectation, matches without corner statistics,
// a kick-off tapped minutes late, corners filled in at join shown faded on the timeline. API-Football is mocked.
// Usage: node uitest8.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const wrap = require('./uihelp.js');

const T0 = Date.parse('2026-10-20T19:30:00Z') / 1000;
const T = { 40: 'Liverpool', 533: 'Villarreal', 492: 'Napoli', 327: 'Bodo/Glimt', 212: 'Porto', 197: 'PSV Eindhoven', 172: 'VfB Stuttgart', 530: 'Atletico Madrid' };
let FX, calls;
function fresh(){
  FX = {
    4001: { h: 40, a: 533, st: 'NS', el: 0, g: [0, 0], ck: [0, 0], ts: T0 + 3600 },
    4002: { h: 492, a: 327, st: '1H', el: 12, g: [1, 0], ck: null, first: T0 - 690, ts: T0 - 690 },     // live, score only, no statistics
    4003: { h: 212, a: 197, st: 'NS', el: 0, g: [0, 0], ck: [0, 0], ts: T0 + 600 },
    4004: { h: 172, a: 530, st: '1H', el: 20, g: [0, 0], ck: [2, 1], first: T0 - 1170, ts: T0 - 1170 },
  };
  calls = [];
}
const RECENT = {};
for (let k = 0; k < 10; k++){
  RECENT[3001 + k] = { team: 40, for: [5, 7][k % 2], ag: [3, 5][k % 2] };
  RECENT[3011 + k] = { team: 533, for: [4, 6][k % 2], ag: [5, 5][k % 2] };
}
function fx(id){
  const x = FX[id];
  return { fixture: { id, date: new Date(x.ts * 1000).toISOString(), timestamp: x.ts, periods: { first: x.first || null, second: x.second || null }, status: { short: x.st, elapsed: x.el || null, extra: null } },
    league: { name: 'UEFA Champions League' }, teams: { home: { id: x.h, name: T[x.h] }, away: { id: x.a, name: T[x.a] } }, goals: { home: x.st === 'NS' ? null : x.g[0], away: x.st === 'NS' ? null : x.g[1] } };
}
function detail(id){
  const x = FX[id], b = fx(id);
  b.statistics = x.st === 'NS' || !x.ck ? [] : [x.h, x.a].map((t, j) => ({ team: { id: t, name: T[t] }, statistics: [{ type: 'Corner Kicks', value: x.ck[j] }, { type: 'Red Cards', value: null }] }));
  b.events = [];
  return b;
}
function recentFix(id){
  const r = RECENT[id], opp = 9000 + id;
  return { fixture: { id, timestamp: T0 - 86400 * (id % 100), status: { short: 'FT' } }, teams: { home: { id: r.team }, away: { id: opp } }, goals: { home: 1, away: 0 },
    statistics: [{ team: { id: r.team }, statistics: [{ type: 'Corner Kicks', value: r.for }] }, { team: { id: opp }, statistics: [{ type: 'Corner Kicks', value: r.ag }] }] };
}
async function mock(ctx){
  await ctx.route('https://www.wikidata.org/**', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"search":[]}' }));
  await ctx.route('https://v3.football.api-sports.io/**', async route => {
    const req = route.request(), u = new URL(req.url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push(u.pathname + u.search);
    const q = k => u.searchParams.get(k), ids = Object.keys(FX).map(Number);
    let body = { errors: [], response: [] };
    if (u.pathname === '/status') body.response = { subscription: { plan: 'Free', active: true }, requests: { current: calls.length, limit_day: 100 } };
    else if (u.pathname === '/fixtures' && q('live')) body.response = ids.filter(i => ['1H', 'HT', '2H'].includes(FX[i].st)).map(fx);
    else if (u.pathname === '/fixtures' && q('date')) body.response = ids.map(fx);
    else if (u.pathname === '/fixtures' && q('id')) body.response = [detail(+q('id'))];
    else if (u.pathname === '/fixtures' && q('team')) body.response = Object.keys(RECENT).filter(k => RECENT[k].team === +q('team')).map(k => recentFix(+k));
    else if (u.pathname === '/fixtures' && q('ids')) body.response = q('ids').split('-').map(Number).filter(k => RECENT[k]).map(recentFix);
    else if (u.pathname === '/fixtures/statistics'){ const x = FX[+q('fixture')]; body.response = x && x.ck ? [x.h, x.a].map((t, j) => ({ team: { id: t }, statistics: [{ type: 'Corner Kicks', value: x.ck[j] }], statistics_1h: [{ type: 'Corner Kicks', value: x.ck[j] }] })) : []; }
    else body = { errors: { bad: 'unknown endpoint ' + u.pathname + u.search }, response: [] };
    return route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });
}

async function run(browser, name, vp, opts){
  fresh();
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: 'block', ...(opts || {}) });
  await mock(ctx);
  const page = wrap(await ctx.newPage(), vp.width < 600);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.clock.install({ time: new Date(T0 * 1000) });
  await page.goto(base + '/index.html');
  await page.waitForSelector('#pred .start');
  const txt = async sel => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
  const pause = ms => page.waitForTimeout(ms || 300);
  const now = () => page.evaluate(() => Math.floor(Date.now() / 1000));
  const cur = async () => { const s = await page.evaluate(() => JSON.parse(localStorage.getItem('corner-sb-matches') || '{}')); return Object.values(s).sort((a, b) => b.u - a.u)[0]; };
  const net = () => page.evaluate(() => JSON.parse(localStorage.getItem('corner-sb-net') || '{}'));
  const newMatch = async () => { await page.click('#menuBtn'); await page.click('#card [data-a="new"]'); await page.waitForSelector('#pred .start'); };

  await page.click('#pred [data-pa="nset"]');
  await page.fill('#netKey', 'TESTKEY'); await page.click('#card [data-a="nkey"]'); await pause();
  await page.click('#card [data-a="close"]');

  // A. one team typed (home box): today's matches of that team pop up; picking one fills the other team
  await page.fill('#fH', '利物浦');
  await page.clock.runFor(3000); await pause(600);
  console.log(`[${name}:A-sugg] ${(await txt('#sugg')).slice(0, 140)}`);
  await page.screenshot({ path: `${out}/${name}_f1_one.png` });
  await page.click('#sugg [data-sg="pick"]'); await pause(800);
  let m = await cur();
  console.log(`[${name}:A-picked] names=${m.h} vs ${m.a} | inputs=${await page.inputValue('#fH')} / ${await page.inputValue('#fA')} | linked=${m.api && m.api.id} | toast=${await txt('#toastMsg')} [${await txt('#toastUndo')}]`);

  // B. one-tap expectation from the start panel (3 requests)
  const b0 = calls.length;
  await page.click('#pred [data-pa="expauto"]'); await pause(900);
  m = await cur();
  console.log(`[${name}:B-exp] exp=${m.exp} toast=${await txt('#toastMsg')} | requests=${calls.length - b0}`);

  // A2. the away team typed in the home box: it lands on the away side
  await newMatch();
  await page.fill('#fH', '黄潜');
  await page.clock.runFor(3000); await pause(600);
  await page.click('#sugg [data-sg="pick"]'); await pause(800);
  m = await cur();
  console.log(`[${name}:A2-picked] names=${m.h} vs ${m.a} (expect 利物浦 vs 黄潜) sw=${m.api && m.api.sw}`);

  // C. live match without corner statistics: the app says so instead of “same as yours”
  await newMatch();
  await page.fill('#fH', '那不勒斯'); await page.fill('#fA', '博德闪耀');
  await page.clock.runFor(3000); await pause(600);
  console.log(`[${name}:C-join] ${(await txt('#card .netnote')).slice(0, 120)}`);
  await page.click('#card [data-a="jgo"]'); await pause(300);
  await page.clock.runFor(30000);
  await page.click('#netPill'); await pause(600);
  console.log(`[${name}:C-sync] toast=${await txt('#toastMsg')} | pill=[${await txt('#netPill')}]`);
  await page.openMid('pred');
  console.log(`[${name}:C-bar] ${(await txt('#pred .net')).slice(0, 120)}`);
  await page.screenshot({ path: `${out}/${name}_f2_nock.png` });
  await page.closeMid();

  // D. kick-off tapped 5 minutes late: not taken as a 5-minute screen delay, reminder to set the time
  const before = (await net()).delay;
  await newMatch();
  await page.fill('#fH', '波尔图'); await page.fill('#fA', '埃因霍温');
  await page.clock.runFor(3000); await pause(600);
  await page.click('#pred [data-pa="kick1"]'); const K = await now(); await pause();
  Object.assign(FX[4003], { st: '1H', el: 6, first: K - 300, ck: [1, 0] });
  await page.clock.runFor(30000);
  await page.click('#netPill'); await pause(600);
  m = await cur();
  console.log(`[${name}:D-late] toast=${await txt('#toastMsg')} [${await txt('#toastUndo')}] | match delay=${m.api.dl} saved=${(await net()).delay} (was ${before}) | pill=[${await txt('#netPill')}]`);

  // E. join a live match whose API already has 2–1 corners: they show faded in the “before you joined” part of the timeline
  await newMatch();
  await page.fill('#fH', '斯图加特'); await page.fill('#fA', '马竞');
  await page.clock.runFor(3000); await pause(600);
  await page.click('#card [data-a="jgo"]'); await pause(400);
  await page.clock.runFor(6000); await pause(300);
  const faded = await page.$$eval('#tl g.bf, .tl g.bf, svg g.bf', els => els.length);
  console.log(`[${name}:E-timeline] faded markers=${faded} (expect 3) | counts=${(await txt('#ckH'))} / ${(await txt('#ckA'))}`);
  await page.screenshot({ path: `${out}/${name}_f3_backfill.png` });

  console.log(`[${name}] ERRORS: ${errors.length ? errors.join('\n') : 'none'}`);
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch();
  await run(browser, 'ipad', { width: 1180, height: 820 });
  await run(browser, 'phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
