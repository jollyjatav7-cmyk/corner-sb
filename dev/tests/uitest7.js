// v12: kick-off timestamps that do not fit the minute are not trusted, second-half data waits for your second-half
// kick-off, the clock picker follows nudges, learned delays are shown. API-Football is mocked.
// Usage: node uitest7.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const wrap = require('./uihelp.js');

const T0 = Date.parse('2026-10-20T19:30:00Z') / 1000;   // page clock start (seconds)
const T = { 85: 'Paris Saint Germain', 529: 'Barcelona', 50: 'Manchester City', 575: 'AEK Athens', 212: 'Porto', 197: 'PSV Eindhoven' };
let FX, calls;
function fresh(){
  FX = {
    // live, 10th minute; the kick-off timestamp is the scheduled time, 5½ minutes too early
    3101: { h: 85, a: 529, st: '1H', el: 10, g: [0, 0], ck: [2, 1], first: T0 - 900 },
    3102: { h: 50, a: 575, st: 'NS', el: 0, g: [0, 0], ck: [0, 0] },
    3103: { h: 212, a: 197, st: 'NS', el: 0, g: [0, 0], ck: [0, 0] },
  };
  calls = [];
}
function fx(id){
  const x = FX[id];
  return { fixture: { id, date: '2026-10-20T19:00:00+00:00', timestamp: T0 - 900, periods: { first: x.first || null, second: x.second || null }, status: { short: x.st, elapsed: x.el || null, extra: null } },
    league: { name: 'UEFA Champions League' }, teams: { home: { id: x.h, name: T[x.h] }, away: { id: x.a, name: T[x.a] } }, goals: { home: x.st === 'NS' ? null : x.g[0], away: x.st === 'NS' ? null : x.g[1] } };
}
function detail(id){
  const x = FX[id], b = fx(id);
  b.statistics = x.st === 'NS' ? [] : [x.h, x.a].map((t, j) => ({ team: { id: t, name: T[t] }, statistics: [{ type: 'Shots on Goal', value: 0 }, { type: 'Shots off Goal', value: 0 }, { type: 'Blocked Shots', value: 0 }, { type: 'Corner Kicks', value: x.ck[j] }, { type: 'Red Cards', value: null }] }));
  b.events = [];
  return b;
}
async function mock(ctx){
  await ctx.route('https://www.wikidata.org/**', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"search":[]}' }));
  await ctx.route('https://v3.football.api-sports.io/**', async route => {
    const req = route.request(), u = new URL(req.url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push(u.pathname + u.search);
    const q = k => u.searchParams.get(k);
    let body = { errors: [], response: [] };
    const ids = Object.keys(FX).map(Number);
    if (u.pathname === '/status') body.response = { subscription: { plan: 'Free', active: true }, requests: { current: calls.length, limit_day: 100 } };
    else if (u.pathname === '/fixtures' && q('live')) body.response = ids.filter(i => ['1H', 'HT', '2H'].includes(FX[i].st)).map(fx);
    else if (u.pathname === '/fixtures' && q('date')) body.response = ids.map(fx);
    else if (u.pathname === '/fixtures' && q('id')) body.response = [detail(+q('id'))];
    else if (u.pathname === '/fixtures/statistics' && q('half')){ const x = FX[+q('fixture')]; body.response = [x.h, x.a].map((t, j) => ({ team: { id: t }, statistics: [{ type: 'Corner Kicks', value: x.ck[j] }], statistics_1h: [{ type: 'Corner Kicks', value: 0 }] })); }
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
  const txt = async sel => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
  const pause = ms => page.waitForTimeout(ms || 300);
  const now = () => page.evaluate(() => Math.floor(Date.now() / 1000));
  const cur = async () => { const s = await page.evaluate(() => JSON.parse(localStorage.getItem('corner-sb-matches') || '{}')); return Object.values(s).sort((a, b) => b.u - a.u)[0]; };
  const net = () => page.evaluate(() => JSON.parse(localStorage.getItem('corner-sb-net') || '{}'));
  const counts = async () => { const m = await cur(), c = [0, 0], a = [0, 0], p2 = []; for (const e of m.ev) if (e.c === 'ck'){ c[e.i]++; if (e.a){ a[e.i]++; p2.push(e.p); } } return `ck ${c.join('-')} (auto ${a.join('-')}${p2.length ? ', auto half ' + p2.join(',') : ''})`; };
  const newMatch = async (h, a) => {
    await page.click('#menuBtn'); await page.click('#card [data-a="new"]'); await page.waitForSelector('#pred .start');
    await page.fill('#fH', h); await page.fill('#fA', a);
    await page.clock.runFor(3000); await pause(600);
  };

  await page.click('#pred [data-pa="nset"]');
  await page.fill('#netKey', 'TESTKEY'); await page.click('#card [data-a="nkey"]'); await pause();
  await page.click('#card [data-a="close"]');

  // A. join mid-match: the kick-off timestamp says 15:00 but the minute says 10' → the picker starts near 09:30
  await page.fill('#fH', '巴黎圣日耳曼'); await page.fill('#fA', '巴塞罗那');
  await page.clock.runFor(3000); await pause(600);
  await page.waitForSelector('#card .netnote', { timeout: 5000 }).catch(() => {});
  console.log(`[${name}:A-join] tp=${await txt('#tpV')} (expect 09:3x, not 15:0x)`);
  await page.click('#card [data-a="jgo"]'); await pause();
  console.log(`[${name}:A-joined] clock=${await txt('#clkT')} toast=${await txt('#toastMsg')}`);

  // B. kick-off tap, then the API's kick-off time: a timestamp that does not fit the minute is ignored, one that fits gives the delay
  await newMatch('曼城', '雅典AEK');
  console.log(`[${name}:B-linked] toast=${await txt('#toastMsg')}`);
  await page.clock.runFor(10000);
  await page.click('#pred [data-pa="kick1"]'); const K = await now(); await pause();
  Object.assign(FX[3102], { st: '1H', el: 2, first: K - 400 });
  await page.clock.runFor(60000);
  await page.click('#netPill'); await pause(600);
  console.log(`[${name}:B-bad-stamp] toast=${await txt('#toastMsg')} | match delay=${(await cur()).api.dl}`);
  Object.assign(FX[3102], { el: 3, first: K - 40 });
  await page.clock.runFor(60000);
  await page.click('#netPill'); await pause(600);
  console.log(`[${name}:B-good-stamp] toast=${await txt('#toastMsg')} | match delay=${(await cur()).api.dl} saved=${(await net()).delay} (expect 40)`);

  // C. half-time on your screen, second half already running in the API: its corner waits for your second-half kick-off
  await newMatch('波尔图', '埃因霍温');
  await page.click('#pred [data-pa="kick1"]'); await page.clock.runFor(20000);
  await page.locator('.pad[data-i="0"] [data-c="ck"]:visible').first().click(); await pause();
  await page.click('#clkBtn'); await pause(300);
  await page.$eval('#tpR', el => { el.value = 2640; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#card [data-a="tpset"]'); await pause(200);
  await page.click('#card [data-a="endh"]'); await pause(200);
  await page.click('#card [data-a="close"]');
  const n1 = await now();
  Object.assign(FX[3103], { st: '2H', el: 47, g: [0, 0], ck: [2, 0], first: n1 - 100 - 3600, second: n1 - 100 });
  await page.click('#netPill'); await pause(600);
  console.log(`[${name}:C-sync-at-HT] toast=${await txt('#toastMsg')} | ${await counts()}`);
  await page.clock.runFor(300000); await pause(300);
  console.log(`[${name}:C-still-HT] ${await counts()} (expect ck 1-0, auto 0-0)`);
  await page.screenshot({ path: `${out}/${name}_e1_ht.png` });
  await page.click('#runBtn'); await pause(200);
  console.log(`[${name}:C-2H-kick] toast=${await txt('#toastMsg')}`);
  await page.clock.runFor(2000); await pause(300);
  console.log(`[${name}:C-after-kick] ${await counts()} (expect ck 2-0, auto 1-0 in half 2)`);

  // D. clock sheet: a nudge moves the picker too, so “设定为” keeps the nudge
  await page.clock.runFor(30000);
  await page.click('#clkBtn'); await pause(300);
  console.log(`[${name}:D-open] clock=${await txt('#shClk')} picker=${await txt('#tpV')}`);
  await page.click('#card [data-a="nudge"][data-d="60"]'); await pause(200);
  console.log(`[${name}:D-nudged] clock=${await txt('#shClk')} picker=${await txt('#tpV')} toast=${await txt('#toastMsg')}`);
  await page.screenshot({ path: `${out}/${name}_e2_clock.png` });
  await page.click('#card [data-a="tpset"]'); await pause(200);
  console.log(`[${name}:D-set] clock=${await txt('#shClk')} toast=${await txt('#toastMsg')} (clock should keep the +1 min)`);
  await page.click('#card [data-a="close"]');
  console.log(`[${name}] ERRORS: ${errors.length ? errors.join('\n') : 'none'}`);
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch();
  await run(browser, 'ipad', { width: 1180, height: 820 });
  await run(browser, 'phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
