// v15: bookmaker corner lines read when a match is linked (pre-match /odds and in-play /odds/live, mocked),
// and the "my bets" form defaulting to the bookmaker line.
// Usage: node uitest10.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const wrap = require('./uihelp.js');
const T0 = Date.parse('2026-10-20T19:30:00Z') / 1000;
const T = { 40: 'Liverpool', 533: 'Villarreal', 85: 'Paris Saint Germain', 529: 'Barcelona' };
const FX = { 5001: { h: 40, a: 533, st: 'NS', ts: T0 + 1800 }, 5002: { h: 85, a: 529, st: '1H', el: 21, ck: [3, 2], first: T0 - 1230, ts: T0 - 1230 } };
const fx = id => { const x = FX[id]; return { fixture: { id, date: new Date(x.ts * 1000).toISOString(), timestamp: x.ts, periods: { first: x.first || null, second: null }, status: { short: x.st, elapsed: x.el || null } },
  league: { name: 'UEFA Champions League' }, teams: { home: { id: x.h, name: T[x.h] }, away: { id: x.a, name: T[x.a] } }, goals: { home: x.st === 'NS' ? null : 0, away: x.st === 'NS' ? null : 0 },
  statistics: x.ck ? [x.h, x.a].map((t, j) => ({ team: { id: t }, statistics: [{ type: 'Corner Kicks', value: x.ck[j] }] })) : [], events: [] }; };
const PRE = [{ fixture: { id: 5001 }, bookmakers: [
  { id: 11, name: '1xBet', bets: [{ id: 45, name: 'Corners Over Under', values: [{ value: 'Over 8.5', odd: '1.80' }, { value: 'Under 8.5', odd: '2.00' }] }] },
  { id: 8, name: 'Bet365', bets: [
    { id: 1, name: 'Match Winner', values: [{ value: 'Home', odd: '1.5' }, { value: 'Draw', odd: '4.5' }, { value: 'Away', odd: '6' }] },
    { id: 45, name: 'Corners Over Under', values: [{ value: 'Over 9.5', odd: '1.90' }, { value: 'Under 9.5', odd: '1.90' }, { value: 'Over 10.5', odd: '2.40' }, { value: 'Under 10.5', odd: '1.55' }] },
    { id: 57, name: 'Home Corners Over/Under', values: [{ value: 'Over 5.5', odd: '1.9' }, { value: 'Under 5.5', odd: '1.9' }] },
    { id: 55, name: 'Corners 1x2', values: [{ value: 'Home', odd: '1.4' }, { value: 'Draw', odd: '8' }, { value: 'Away', odd: '4' }] },
    { id: 56, name: 'Corners Asian Handicap', values: [{ value: 'Home -1.5', odd: '1.95' }, { value: 'Away -1.5', odd: '1.85' }, { value: 'Home -0.5', odd: '1.55' }, { value: 'Away -0.5', odd: '2.40' }] },
    { id: 77, name: 'Total Corners (1st Half)', values: [{ value: 'Over 4.5', odd: '1.95' }, { value: 'Under 4.5', odd: '1.85' }, { value: 'Over 3.5', odd: '1.45' }, { value: 'Under 3.5', odd: '2.6' }] }] }] }];
const LIVE = [{ fixture: { id: 5002 }, odds: [
  { id: 1, name: 'Asian Corners', values: [{ value: 'Over', odd: '1.90', handicap: '10', main: true }, { value: 'Under', odd: '1.90', handicap: '10', main: true }, { value: 'Over', odd: '2.50', handicap: '11' }, { value: 'Under', odd: '1.50', handicap: '11' }] },
  { id: 2, name: '1st Half Corners', values: [{ value: 'Over', odd: '1.80', handicap: '6.5' }, { value: 'Under', odd: '2.00', handicap: '6.5' }] },
  { id: 3, name: 'Asian Handicap Corners', values: [{ value: 'Home', odd: '1.95', handicap: '-0.75', main: true }, { value: 'Away', odd: '1.85', handicap: '0.75', main: true }] }] }];
async function mock(ctx, calls){
  await ctx.route('https://www.wikidata.org/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"search":[]}' }));
  await ctx.route('https://v3.football.api-sports.io/**', async route => {
    const req = route.request(), u = new URL(req.url()), q = k => u.searchParams.get(k);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push(u.pathname + u.search);
    let resp = [];
    if (u.pathname === '/status') resp = { subscription: { plan: 'Free', active: true }, requests: { current: 1, limit_day: 100 } };
    else if (u.pathname === '/odds/live') resp = LIVE.filter(x => x.fixture.id === +q('fixture'));
    else if (u.pathname === '/odds') resp = PRE.filter(x => x.fixture.id === +q('fixture'));
    else if (q('live')) resp = [fx(5002)];
    else if (q('date')) resp = [fx(5001), fx(5002)];
    else if (q('id')) resp = [fx(+q('id'))];
    else if (u.pathname === '/fixtures/statistics') resp = [];
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ errors: [], response: resp }) });
  });
}
async function run(browser, name, vp, opts){
  const calls = [];
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: 'block', ...(opts || {}) });
  await mock(ctx, calls);
  const page = wrap(await ctx.newPage(), vp.width < 600);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.clock.install({ time: new Date(T0 * 1000) });
  await page.goto(base + '/index.html'); await page.waitForSelector('#pred .start');
  await page.evaluate(() => localStorage.setItem('corner-sb-net', JSON.stringify({ key: 'K', auto: true, iv: 0, shots: true })));
  await page.reload(); await page.waitForSelector('#pred .start');
  const txt = async sel => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
  const cur = async () => { const s = await page.evaluate(() => JSON.parse(localStorage.getItem('corner-sb-matches') || '{}')); return Object.values(s).sort((a, b) => b.u - a.u)[0]; };
  // A. pre-match: link -> Bet365 lines (skips 1xBet ranked lower, team totals and 1x2)
  await page.fill('#fH', '利物浦'); await page.fill('#fA', '黄潜');
  await page.clock.runFor(3000); await page.waitForTimeout(500);
  await page.clock.runFor(5000); await page.waitForTimeout(600);
  let m = await cur();
  console.log(`[${name}:A] toast=${await txt('#toastMsg')} | line=${JSON.stringify(m.line)} hd=${JSON.stringify(m.hd)} fl=${m.fl} fh=${m.fh} | calls=${calls.filter(c => c.startsWith('/odds')).join(' ')}`);
  await page.click('#pred [data-pa="kick1"]'); await page.clock.runFor(60000);
  await page.openMid('pred');
  console.log(`[${name}:A-row] ${await txt('#pred .oddsn')}`);
  await page.screenshot({ path: `${out}/${name}_h1_odds.png` });
  await page.closeMid();
  // B. live: join a match in progress -> in-play lines (quarter handicap -0.75 shown on the card as -0.5, kept exactly in the bet form)
  await page.click('#menuBtn'); await page.click('#card [data-a="new"]'); await page.waitForSelector('#pred .start');
  await page.fill('#fH', '巴黎圣日耳曼'); await page.fill('#fA', '巴萨');
  await page.clock.runFor(3000); await page.waitForTimeout(800);
  await page.click('#card [data-a="jgo"]'); await page.waitForTimeout(300); await page.clock.runFor(4000); await page.waitForTimeout(600);
  m = await cur();
  console.log(`[${name}:B] line=${JSON.stringify(m.line)} hd=${JSON.stringify(m.hd)} fl=${m.fl} fh=${m.fh} odds=${JSON.stringify(m.odds && m.odds.mk)}`);
  await page.click('#pred [data-pa="mybet"]'); await page.waitForTimeout(300);
  await page.click('#card [data-a="mbm"][data-v="ft"]'); await page.waitForTimeout(200);
  console.log(`[${name}:B-form] ${await txt('#card .mbl')} | ${(await txt('#card .netnote')).slice(0, 100)}`);
  await page.click('#card [data-a="close"]');
  console.log(`[${name}] ERRORS: ${errors.length ? errors.join('\n') : 'none'}`);
  await ctx.close();
}
(async () => {
  const b = await chromium.launch();
  await run(b, 'ipad', { width: 1180, height: 820 });
  await run(b, 'phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  await b.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
