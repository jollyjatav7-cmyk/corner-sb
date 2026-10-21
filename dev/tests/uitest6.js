// v11: screen delay (stream behind the live data), held sync, one-tap sync pill, auto sync off by default,
// pre-match expectation lookup, post-match sync from the match list. API-Football is mocked.
// Usage: node uitest6.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const wrap = require('./uihelp.js');

const T0 = Date.parse('2026-10-20T19:30:00Z') / 1000;   // page clock start (seconds)
const T = { 40: 'Liverpool', 533: 'Villarreal', 492: 'Napoli', 327: 'Bodo/Glimt' };
let FX, calls;
function fresh(){
  FX = {
    // live: kicked off 30:30 ago in real time
    2001: { lg: 'UEFA Champions League', h: 40, a: 533, st: '1H', el: 31, g: [0, 0], ck: [3, 1], rc: [0, 0], first: T0 - 1830 },
    // finished earlier today
    2002: { lg: 'UEFA Champions League', h: 492, a: 327, st: 'FT', el: 90, g: [2, 1], ck: [7, 3], ck1: [4, 1], rc: [0, 0], first: T0 - 9000, second: T0 - 6000 },
  };
  calls = [];
}
// recent finished matches for the expectation lookup: Liverpool 6.0 for / 4.0 against, Villarreal 5.0 / 5.0
const RECENT = {};
for (let k = 0; k < 10; k++){
  RECENT[3001 + k] = { team: 40, for: [5, 7][k % 2], ag: [3, 5][k % 2] };
  RECENT[3011 + k] = { team: 533, for: [4, 6][k % 2], ag: [5, 5][k % 2] };
}
function fx(id){
  const x = FX[id];
  return { fixture: { id, date: '2026-10-20T19:00:00+00:00', timestamp: T0 - 1830, periods: { first: x.first || null, second: x.second || null }, status: { short: x.st, elapsed: x.el, extra: null } },
    league: { name: x.lg }, teams: { home: { id: x.h, name: T[x.h] }, away: { id: x.a, name: T[x.a] } }, goals: { home: x.g[0], away: x.g[1] } };
}
function detail(id){
  const x = FX[id], b = fx(id);
  b.statistics = [x.h, x.a].map((t, j) => ({ team: { id: t, name: T[t] }, statistics: [{ type: 'Shots on Goal', value: 2 }, { type: 'Shots off Goal', value: 2 }, { type: 'Blocked Shots', value: 1 }, { type: 'Corner Kicks', value: x.ck[j] }, { type: 'Red Cards', value: null }] }));
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
    const q = k => u.searchParams.get(k);
    let body = { errors: [], response: [] };
    if (u.pathname === '/status') body.response = { subscription: { plan: 'Free', active: true }, requests: { current: calls.filter(c => !c.startsWith('/status')).length, limit_day: 100 } };
    else if (u.pathname === '/fixtures' && q('live')) body.response = [fx(2001)];
    else if (u.pathname === '/fixtures' && q('date')) body.response = q('date') === '2026-10-21' ? [] : [fx(2001), fx(2002)];
    else if (u.pathname === '/fixtures' && q('id')) body.response = [detail(+q('id'))];
    else if (u.pathname === '/fixtures' && q('team')) body.response = Object.keys(RECENT).filter(k => RECENT[k].team === +q('team')).map(k => recentFix(+k));
    else if (u.pathname === '/fixtures' && q('ids')) body.response = q('ids').split('-').map(Number).filter(k => RECENT[k]).map(recentFix);
    else if (u.pathname === '/fixtures/statistics' && q('half')){ const x = FX[+q('fixture')]; body.response = [x.h, x.a].map((t, j) => ({ team: { id: t }, statistics: [{ type: 'Corner Kicks', value: x.ck[j] }], statistics_1h: [{ type: 'Corner Kicks', value: x.ck1 ? x.ck1[j] : 0 }] })); }
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
  const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('corner-sb-matches') || '{}'));
  const net = () => page.evaluate(() => JSON.parse(localStorage.getItem('corner-sb-net') || '{}'));
  const counts = async () => { const s = await store(), m = Object.values(s).sort((a, b) => b.u - a.u)[0]; const c = [0, 0], a = [0, 0]; for (const e of m.ev) if (e.c === 'ck'){ c[e.i]++; if (e.a) a[e.i]++; } return `ck ${c.join('-')} (auto ${a.join('-')})`; };

  // A. key + default auto sync is off
  await page.click('#pred [data-pa="nset"]');
  await page.fill('#netKey', 'TESTKEY'); await page.click('#card [data-a="nkey"]'); await pause();
  const ivOn = await page.$eval('#card [data-a="niv"][aria-pressed="true"]', b => b.textContent);
  console.log(`[${name}:settings] auto sync = ${ivOn} | ${(await txt('#card .netnote'))}`);
  await page.click('#card [data-a="close"]');

  // B. join mid-match: live data says 30:30, the user's stream is 90 s behind → set the picker to 29:00
  await page.fill('#fH', '利物浦'); await page.fill('#fA', '比利亚雷亚尔');
  await page.clock.runFor(3000); await pause(600);
  await page.waitForSelector('#card .netnote', { timeout: 5000 }).catch(() => {});
  console.log(`[${name}:join] tp=${await txt('#tpV')} | ${(await txt('#card .netnote')).slice(0, 120)}`);
  await page.screenshot({ path: `${out}/${name}_d1_join.png` });
  await page.click('#card [data-a="tpn"][data-d="-60"]'); await page.click('#card [data-a="tpn"][data-d="-30"]');
  await page.clock.runFor(4000);   // the picker keeps running while the user looks at the screen
  console.log(`[${name}:join-adjusted] tp=${await txt('#tpV')} (should run on from 29:00)`);
  await page.click('#card [data-a="jgo"]'); await pause();
  console.log(`[${name}:joined] clock=${await txt('#clkT')} delay=${(await net()).delay}s pill=[${await txt('#netPill')}]`);

  // C. API sees a home corner first; the user sees it on screen 60 s later and taps it → not added twice
  FX[2001].ck = [4, 1]; FX[2001].el = 33;
  await page.clock.runFor(60000);
  await page.click('#netPill'); await pause(500);
  console.log(`[${name}:sync-held] toast=${await txt('#toast')} | pill=[${await txt('#netPill')}] | ${await counts()}`);
  await page.clock.runFor(60000);
  await page.locator('.pad[data-i="0"] [data-c="ck"]:visible').first().click();
  await page.clock.runFor(120000); await pause(300);
  console.log(`[${name}:after-hold] ${await counts()} (expect home 4, auto 0)`);

  // D. API has an away corner the user misses → added once the screen has caught up; a late tap merges with it
  FX[2001].ck = [4, 2]; FX[2001].el = 37;
  await page.click('#netPill'); await pause(500);
  await page.clock.runFor(125000); await pause(300);
  console.log(`[${name}:added] toast=${await txt('#toast')} | ${await counts()} (expect away 2, auto 1)`);
  await page.clock.runFor(30000);
  await page.locator('.pad[data-i="1"] [data-c="ck"]:visible').first().click(); await pause(300);
  console.log(`[${name}:merged] toast=${await txt('#toast')} | ${await counts()} (expect away 2, auto 0)`);

  // E. clock sheet shows the live time and the delay
  await page.click('#clkBtn'); await pause(300);
  console.log(`[${name}:clock] ${(await txt('#card .hint')).slice(0, 80)}`);
  await page.screenshot({ path: `${out}/${name}_d2_clock.png` });
  await page.click('#card [data-a="close"]');

  // F. pre-match expectation from both teams' last 10 matches (3 requests)
  const before = calls.length;
  await page.click('#pred [data-pa="expc"]'); await pause(300);
  await page.click('#card [data-a="xfetch"]'); await pause(800);
  console.log(`[${name}:exp] ${(await txt('#card .xres'))} | ${(await txt('#card .netnote'))} | requests=${calls.length - before}: ${calls.slice(before).join(' ')}`);
  await page.screenshot({ path: `${out}/${name}_d3_exp.png` });
  await page.click('#card [data-a="xuse"]'); await pause(300);
  console.log(`[${name}:exp-set] toast=${await txt('#toast')} | exp=${Object.values(await store()).sort((a, b) => b.u - a.u)[0].exp}`);

  // G. post-match sync from the match list: a match recorded without a link
  await page.click('#menuBtn'); await page.click('#card [data-a="net"]'); await page.click('#card [data-a="nauto"][data-v="0"]'); await page.click('#card [data-a="close"]');
  await page.click('#menuBtn'); await page.click('#card [data-a="new"]'); await page.waitForSelector('#pred .start');
  await page.fill('#fH', '那不勒斯'); await page.fill('#fA', '博德闪耀');
  await page.click('#pred [data-pa="kick1"]'); await page.clock.runFor(30000);
  await page.locator('.pad[data-i="0"] [data-c="ck"]:visible').first().click(); await page.clock.runFor(20000);
  await page.click('#clkBtn'); await page.click('#card [data-a="finish"]'); await pause(300);
  if (!(await page.$eval('#sheet', e => e.hidden))) await page.click('#card [data-a="close"]').catch(() => {});
  await page.click('#menuBtn'); await page.click('#card [data-a="arch"]'); await pause(300);
  await page.locator('#card [data-a="wopen"]').first().click(); await pause(150);
  const btn = page.locator('#card [data-a="msync"]').first();
  console.log(`[${name}:list] sync buttons=${await page.locator('#card [data-a="msync"]').count()} first=${await btn.textContent()}`);
  const b2 = calls.length;
  await btn.click(); await pause(900);
  console.log(`[${name}:past-sync] ${(await txt('#card .netnote')).slice(0, 140)} | requests=${calls.length - b2}`);
  if (await page.$('#card [data-a="ppick"]')){ await page.locator('#card [data-a="ppick"]', { hasText: 'Napoli' }).first().click(); await pause(900); console.log(`[${name}:past-pick] ${(await txt('#card .netnote')).slice(0, 140)}`); }
  console.log(`[${name}:past-row] ${(await page.locator('#card .wrow').first().innerText()).replace(/\s+/g, ' ').slice(0, 220)}`);
  await page.screenshot({ path: `${out}/${name}_d4_list.png`, fullPage: false });
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
