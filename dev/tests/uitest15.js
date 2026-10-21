// v23: (1) lines that follow the user's own betting site — typed in a sheet, never overwritten by odds reads or sync;
// (2) auto-betting ends by itself at 40:00 and 85:00 (last five minutes of each half). API-Football is mocked.
// Usage: node uitest15.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const wrap = require('./uihelp.js');

const T0 = Date.parse('2026-10-21T11:00:00Z') / 1000;
let FX, calls;
const fresh = () => { FX = { st: '1H', el: 20, g: [0, 0], ck: [2, 1], first: T0 - 1230 }; calls = []; };
function fx(){
  return { fixture: { id: 3001, date: '2026-10-21T10:40:00+00:00', timestamp: T0 - 1230, periods: { first: FX.first, second: FX.second || null }, status: { short: FX.st, elapsed: FX.el, extra: null } },
    league: { id: 98, name: 'J1 League', country: 'Japan' }, teams: { home: { id: 283, name: 'Kashiwa Reysol' }, away: { id: 1041, name: 'JEF United Chiba' } }, goals: { home: FX.g[0], away: FX.g[1] } };
}
const detail = () => Object.assign(fx(), { events: [], statistics: [283, 1041].map((t, j) => ({ team: { id: t }, statistics: [{ type: 'Corner Kicks', value: FX.ck[j] }] })) });
async function mock(ctx){
  await ctx.route('https://www.wikidata.org/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"search":[]}' }));
  await ctx.route('https://v3.football.api-sports.io/**', async route => {
    const req = route.request(), u = new URL(req.url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push(u.pathname + u.search);
    const q = k => u.searchParams.get(k);
    let body = { errors: [], response: [] };
    if (u.pathname === '/fixtures' && (q('live') || q('date'))) body.response = [fx()];
    else if (u.pathname === '/fixtures' && q('id')) body.response = [detail()];
    else if (u.pathname === '/odds/live') body.response = [{ odds: [{ name: 'Total Corners', values: [{ value: 'Over', handicap: '11.5', odd: '1.90', main: true }, { value: 'Under', handicap: '11.5', odd: '1.90', main: true }] }] }];
    else if (u.pathname === '/odds') body.response = [];
    else if (u.pathname === '/fixtures' && q('ids')) body.response = [];
    return route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });
}
async function run(browser, name, vp, opts){
  fresh();
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: 'block', ...(opts || {}) });
  await mock(ctx);
  await ctx.addInitScript(() => { if (!localStorage.getItem('corner-sb-net')) localStorage.setItem('corner-sb-net', JSON.stringify({ key: 'TESTKEY', auto: true, iv: 0 })); });
  const page = wrap(await ctx.newPage(), vp.width < 600);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.clock.install({ time: new Date(T0 * 1000) });
  await page.goto(base + '/index.html'); await page.waitForSelector('#pred', { state: 'attached' }); await page.waitForTimeout(250);
  const txt = async sel => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
  const pause = ms => page.waitForTimeout(ms || 250);
  const sheet = async () => (await page.$eval('#sheet', e => e.hidden)) ? 'closed' : ((await page.textContent('#card h3')) || '').trim();
  const toast = async () => (await page.$eval('#toast', e => e.hidden)) ? '' : ((await page.textContent('#toastMsg')) || '').trim();
  const cur = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('corner-sb-matches') || '{}'); return s[JSON.parse(localStorage.getItem('corner-sb-current') || '""')]; });
  const ok = (c, m) => (c ? 'OK ' : 'FAIL ') + m;
  // linked live match, joined from the API
  await page.fill('#fH', '柏太阳神'); await page.fill('#fA', '千叶'); await page.clock.runFor(3000); await pause(800);
  if ((await sheet()) === '中途加入') await page.click('#card [data-a="jgo"]');
  await page.clock.runFor(5000); await pause(400);
  const lines0 = (await cur()).line;
  // network mode: 更新盘口 reads the live line and sets it; the toast offers 对不上？
  const c0 = calls.length;
  await page.click('#qbOdds'); await pause(600);
  console.log(`[${name}:L1] api mode: ${calls.slice(c0).join(' ')} | toast=${await toast()} | fl=${(await cur()).fl}`);
  await page.click('#toastUndo'); await pause(300);   // 对不上？
  console.log(`[${name}:L2] ${ok((await sheet()) === '盘口', '对不上？ opens the lines sheet')} | ${(await txt('#card')).slice(0, 120)}`);
  await page.click('#card [data-a="osrc"][data-v="me"]'); await pause(200);
  await page.click('#card [data-a="lnset"][data-k="line"][data-d="0.5"]');
  await page.click('#card [data-a="lnset"][data-k="fl"][data-d="-0.5"]'); await page.click('#card [data-a="lnset"][data-k="fl"][data-d="-0.5"]');
  await page.click('#card [data-a="lnset"][data-k="fh"][data-d="-0.5"]');
  await page.screenshot({ path: `${out}/${name}_l1_sheet.png` });
  await pause(900);
  let m = await cur();
  console.log(`[${name}:L3] typed: half ${lines0[0]}→${m.line[0]} full ${m.fl} hd ${m.fh} | sheet values ${await page.$$eval('#card .lnset b', a => a.map(x => x.textContent).join(' / '))}`);
  await page.click('#card [data-a="close"]'); await pause(200);
  console.log(`[${name}:L4] quick bar=[${await txt('#qbOdds')}] stored=${await page.evaluate(() => localStorage.getItem('corner-sb-odds'))}`);
  // sync while live must not touch the typed lines, and must not read odds
  FX.el = 24; FX.ck = [3, 1];
  await page.clock.runFor(60000);
  const c1 = calls.length;
  await page.click('#qbSync'); await pause(700);
  m = await cur();
  console.log(`[${name}:L5] after sync: requests=${calls.slice(c1).join(' ')} ${ok(!calls.slice(c1).some(c => c.startsWith('/odds')), 'no odds read')} lines half ${m.line[0]} full ${m.fl} ${ok(m.line[0] === lines0[0] + 0.5 && m.fl === 10.5, 'lines kept')}`);
  const c2 = calls.length;
  await page.click('#qbOdds'); await pause(300);
  console.log(`[${name}:L6] 填盘口 → ${await sheet()} requests=${calls.length - c2}`);
  await page.click('#card [data-a="close"]');
  // auto-bet: start at ~24', ends at 40:00 by itself
  await page.openMid('ab');
  await page.click('#ab [data-ab="on"]'); await pause(200);
  await page.closeMid();
  console.log(`[${name}:A1] auto-bet on=${JSON.stringify((await cur()).ab.on)}`);
  const secs = async () => { const [a, b] = (await txt('#clkT')).split(':').map(Number); return a * 60 + b; };
  while (await secs() < 39 * 60 + 30) await page.clock.runFor(30000);
  await pause(300);
  console.log(`[${name}:A2] at ${await txt('#clkT')} on=${JSON.stringify((await cur()).ab.on)}`);
  await page.clock.runFor(45000); await page.clock.runFor(15000); await pause(400);   // past 40:00
  const t2 = await toast();
  console.log(`[${name}:A3] at ${await txt('#clkT')} ${ok((await cur()).ab.on === null, 'ended at 40:00')} toast=${t2}`);
  await page.openMid('ab');
  console.log(`[${name}:A4] panel: ${(await txt('#ab')).slice(0, 90)} | start disabled=${await page.$eval('#ab [data-ab="on"]', b => b.disabled)}`);
  await page.screenshot({ path: `${out}/${name}_a1_late.png` });
  await page.closeMid();
  // half-time → second half: can start again, ends at 85:00
  await page.click('#qbMore'); await page.locator('#card [data-a="clock"]').click(); await page.click('#card [data-a="endh"]'); await page.click('#card [data-a="kick"][data-p="2"]'); await page.click('#card [data-a="close"]');
  while (await secs() < 75 * 60) await page.clock.runFor(60000);
  await pause(300);
  await page.openMid('ab');
  const dis = await page.$eval('#ab [data-ab="on"]', b => b.disabled);
  await page.click('#ab [data-ab="on"]'); await pause(200);
  await page.closeMid();
  console.log(`[${name}:A5] 2nd half at ${await txt('#clkT')}: start disabled=${dis} on=${JSON.stringify((await cur()).ab.on)}`);
  while (await secs() < 85 * 60 + 10) await page.clock.runFor(30000);
  await page.clock.runFor(15000); await pause(400);
  console.log(`[${name}:A6] at ${await txt('#clkT')} ${ok((await cur()).ab.on === null, 'ended at 85:00')} toast=${await toast()}`);
  console.log(`[${name}] ERRORS: ${errors.length ? errors.join('\n') : 'none'}`);
  await ctx.close();
}
(async () => {
  const b = await chromium.launch();
  await run(b, 'phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  await run(b, 'se', { width: 375, height: 667 }, { isMobile: true, hasTouch: true });
  await run(b, 'ipad', { width: 1180, height: 820 });
  await run(b, 'ipadP', { width: 820, height: 1180 });
  await b.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
