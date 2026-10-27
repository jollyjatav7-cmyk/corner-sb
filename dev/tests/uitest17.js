// v26: (O) odds in 我的注 (digits-only shorthand, recent-odds chip, break-even), profit stats;
// (M) merging a match split into a first-half record and a second-half record, with undo;
// (C) model check in the warehouse stats; (S) storage usage in 备份与整理;
// (E) pre-match expectation filled by itself: from the book at kick-off, and from the bookmaker line after linking (API mocked).
// Usage: node uitest17.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const wrap = require('./uihelp.js');
const fs = require('fs'), os = require('os'), path = require('path');

const T0 = Date.parse('2026-10-28T11:00:00Z') / 1000;
const ok = (c, m) => (c ? 'OK ' : 'FAIL ') + m;
const PRE = [{ fixture: { id: 5001 }, bookmakers: [{ id: 8, name: 'Bet365', bets: [
  { id: 45, name: 'Corners Over Under', values: [{ value: 'Over 9.5', odd: '1.90' }, { value: 'Under 9.5', odd: '1.90' }] }] }] }];
const fx = () => ({ fixture: { id: 5001, date: new Date((T0 + 1800) * 1000).toISOString(), timestamp: T0 + 1800, periods: { first: null, second: null }, status: { short: 'NS', elapsed: null } },
  league: { id: 39, name: 'Premier League', country: 'England' }, teams: { home: { id: 40, name: 'Liverpool' }, away: { id: 533, name: 'Villarreal' } }, goals: { home: null, away: null }, statistics: [], events: [] });
async function mock(ctx){
  await ctx.route('https://www.wikidata.org/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"search":[]}' }));
  await ctx.route('https://v3.football.api-sports.io/**', async route => {
    const req = route.request(), u = new URL(req.url()), q = k => u.searchParams.get(k);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let resp = [];
    if (u.pathname === '/odds') resp = PRE;
    else if (u.pathname === '/fixtures' && (q('date') || q('id'))) resp = [fx()];
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ errors: [], response: resp }) });
  });
}
// a match recorded in two pieces (first half, then joined the second half), plus a finished match with odds on my bets
const API = { id: 777, h: 'Como', a: 'Manchester United', hid: 895, aid: 33, lg: 'UEFA Champions League', lid: 2, lc: 'World', sw: 0, st: 'FT', ck1: [1, 1], ck: [1, 4], fin: 1 };
const EXPORT = { app: '角球数据记录', fmt: 1, matches: [
  { id: 'sA', d: '2026-10-27', lg: '欧冠', h: '科莫', a: '曼联', st: 2, exp: 9.7, line: [2.5, 4.5], hd: [0.5, -0.5], mk: ['h', 'f'], fl: 7, fh: -0.5, add: [null, null], pe: {}, obs: { p: 1, t: 0 }, stop: { p: 1, t: 2780 },
    ab: { bets: [{ key: 'h1|ou|o|2.5|60', mt: 'h1', mk: 'ou', sd: 'o', ln: 2.5, pr: 0.82, tier: 60, p: 1, t: 1117, hold: 180, sc: [1, 0], ck: [0, 1], r: 0 }] }, res: { h1: [1, 1], ft: null }, api: Object.assign({}, API, { st: '1H', ck: [1, 1], fin: 0 }), keep: 1,
    ev: [[73, 1, 1, 'f3'], [120, 1, 0, 'sg'], [600, 1, 0, 'f3'], [951, 1, 1, 'ck'], [1500, 1, 0, 'f3'], [1800, 1, 0, 'bx'], [2090, 1, 0, 'ck'], [2500, 1, 1, 'f3']] },
  { id: 'sB', d: '2026-10-27', lg: '欧冠', h: '科莫', a: '曼联', st: 2, exp: 9.8, line: [2.5, 4.5], hd: [0.5, -0.5], mk: ['h', 'f'], fl: 4.5, fh: 0.5, add: [null, null], pe: { 2: 5643 }, obs: { p: 2, t: 2831 }, stop: { p: 2, t: 5643 },
    ab: { bets: [{ key: 'ft|ou|o|4.5|60', mt: 'ft', mk: 'ou', sd: 'o', ln: 4.5, pr: 0.74, tier: 60, p: 2, t: 3816, hold: 180, sc: [3, 0], ck: [1, 1], r: 1 }] }, res: { h1: null, ft: [1, 4] }, api: API, keep: 1,
    ev: [[0, 1, 0, 'sg', 1], [0, 1, 0, 'ck', 1], [0, 1, 1, 'ck', 1], [2898, 2, 0, 'f3'], [3300, 2, 1, 'f3'], [3917, 2, 1, 'ck'], [4400, 2, 0, 'f3'], [4738, 2, 1, 'ck'], [5278, 2, 1, 'ck']] },
  { id: 'syn1', d: '2026-10-26', lg: '英超', h: '阿森纳', a: '切尔西', st: 2, exp: 10, line: [4.5, 4.5], hd: [-0.5, -0.5], mk: ['h', 'f'], fl: 9.5, fh: -0.5, add: [null, null], pe: { 1: 2800, 2: 5700 }, obs: { p: 1, t: 0 }, stop: { p: 2, t: 5700 },
    ab: { bets: [] }, res: { h1: [3, 2], ft: [6, 4] }, keep: 1,
    my: [{ k: 1, mt: 'ft', mk: 'ou', sd: 'o', ln: 9.5, s0: [0, 0], cnt: 1, at: 1, od: 1.9 }, { k: 2, mt: 'ft', mk: 'hd', sd: 'h', ln: -0.5, s0: [0, 0], cnt: 0, at: 2, od: 2.0 }, { k: 3, mt: 'ft', mk: 'ou', sd: 'u', ln: 9.5, s0: [0, 0], cnt: 1, at: 3, od: 1.8 }],
    ev: [[300, 1, 0, 'ck'], [900, 1, 1, 'ck'], [1500, 1, 0, 'ck'], [2000, 1, 1, 'ck'], [2600, 1, 0, 'ck'], [3000, 2, 0, 'ck'], [3600, 2, 1, 'ck'], [4200, 2, 0, 'ck'], [4800, 2, 1, 'ck'], [5400, 2, 0, 'ck'], [700, 1, 0, 'f3'], [1200, 1, 1, 'f3'], [3300, 2, 0, 'bx']] }] };
function book(){
  const fxs = {};
  for (let i = 0; i < 12; i++) fxs['s' + i] = { d: `2026-10-${String(10 + i).padStart(2, '0')}`, lid: 39, lg: 'Premier League', lc: 'England', h: 'Brentford X', a: 'Fulham Y', ck: [5, 5], src: 'api' };
  fxs.a900 = { d: '2026-10-25', lid: 39, lg: 'Premier League', lc: 'England', h: 'Liverpool', a: 'Everton', hid: 40, aid: 45, ck: [9, 1], src: 'api' };
  fxs.a902 = { d: '2026-10-24', lid: 140, lg: 'La Liga', lc: 'Spain', h: 'Villarreal', a: 'Sevilla', hid: 533, aid: 536, ck: [3, 6], src: 'api' };
  return { fx: fxs, days: {}, seed: '2026-10-18' };
}
async function run(browser, name, vp, opts){
  const isPhone = vp.width < 600;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: 'block', ...(opts || {}) });
  await mock(ctx);
  await ctx.addInitScript(b => { if (!localStorage.getItem('t17')){ localStorage.setItem('t17', '1'); localStorage.setItem('corner-sb-book', JSON.stringify(b)); } }, book());
  const page = wrap(await ctx.newPage(), isPhone);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.clock.install({ time: new Date(T0 * 1000) });
  await page.goto(base + '/index.html'); await page.waitForSelector('#pred', { state: 'attached' }); await page.waitForTimeout(300);
  const txt = async sel => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
  const pause = ms => page.waitForTimeout(ms || 250);
  const sheet = async () => (await page.$eval('#sheet', e => e.hidden)) ? 'closed' : ((await page.textContent('#card h3')) || '').trim();
  const toast = async () => (await page.$eval('#toast', e => e.hidden)) ? '' : ((await page.textContent('#toastMsg')) || '').trim();
  const cur = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('corner-sb-matches') || '{}'); return s[JSON.parse(localStorage.getItem('corner-sb-current') || '""')] || { my: [], ev: [] }; });
  const all = () => page.evaluate(() => JSON.parse(localStorage.getItem('corner-sb-matches') || '{}'));
  const tap = async (i, c) => { await page.locator(`.pad[data-i="${i}"] [data-c="${c}"]:visible`).first().click(); await page.clock.runFor(1000); };

  // ---------- E1. book → expectation filled by itself at kick-off (no network) ----------
  await page.fill('#fH', '利物浦'); await page.fill('#fA', '黄潜'); await pause();
  await page.click('#runBtn'); await page.clock.runFor(3000); await pause(300);
  let m = await cur();
  console.log(`[${name}:E1] exp=${m.exp} src=${m.expSrc} ${ok(m.exp != null && /本机资料/.test(m.expSrc || ''), 'filled from the book at kick-off')} toast=${await toast()}`);

  // ---------- O. odds on my bets ----------
  for (let k = 0; k < 4; k++){ await tap(0, 'f3'); await page.clock.runFor(30000); }
  await page.click('#qbMy'); await pause();
  if (await page.$('#card [data-a="mybet"]')) await page.click('#card [data-a="mybet"]');
  await pause();
  await page.fill('#mbOd', '185'); await pause();
  console.log(`[${name}:O1] hint=${await txt('#mbOdH')}`);
  await page.screenshot({ path: `${out}/${name}_o1_odds.png` });
  await page.click('#card [data-a="mbgo"]'); await pause();
  m = await cur();
  console.log(`[${name}:O2] ${ok(m.my.length === 1 && m.my[0].od === 1.85, 'odds 1.85 stored')} toast=${await toast()}`);
  await page.click('#qbMy'); await pause();
  if (await page.$('#card [data-a="mybet"]')) await page.click('#card [data-a="mybet"]');
  await pause();
  const chips = await page.$$eval('#card [data-a="mbod"]', b => b.map(x => x.textContent.trim()));
  await page.fill('#mbOd', '1'); await page.click('#card [data-a="mbgo"]'); await pause();
  console.log(`[${name}:O3] recent chips=${JSON.stringify(chips)} bad odds → ${await sheet()} | ${await toast()}`);
  await page.click('#card [data-a="mbod"]'); await pause(); await page.click('#card [data-a="mbgo"]'); await pause();
  m = await cur();
  console.log(`[${name}:O4] ${ok(m.my.length === 2 && m.my[1].od === 1.85, 'chip filled 1.85')}`);
  await page.openMid();
  console.log(`[${name}:O5] panel: ${(await txt('#pred .myb')).slice(0, 120)}`);
  await page.closeMid();

  // ---------- M. merge a split match ----------
  const fixture = path.join(os.tmpdir(), 'uitest17_export.json'); fs.writeFileSync(fixture, JSON.stringify(EXPORT));
  await page.setInputFiles('#fileIn', fixture); await pause(500);
  await page.click('#qbMore'); await page.locator('#card [data-a="arch"]').click(); await pause(300);
  const tags = await page.$$eval('#card .wtag', t => t.map(x => x.textContent));
  console.log(`[${name}:M1] tags=${JSON.stringify(tags.filter(x => /合并/.test(x)))} ${ok(tags.filter(x => /可合并/.test(x)).length === 2, 'both pieces marked')}`);
  await page.locator('#card .wrow', { hasText: '只有上半场' }).locator('[data-a="wopen"]').click(); await pause();
  await page.screenshot({ path: `${out}/${name}_m1_merge.png` });
  await page.click('#card [data-a="mmerge"]'); await pause(300);
  let s = await all();
  const x = s.sA;
  console.log(`[${name}:M2] ${ok(!s.sB && x && x.obs.p === 1 && x.stop.p === 2, 'merged into one record')} ev=${x && x.ev.length} p2=${x && x.ev.filter(e => e.p === 2).length} bets=${x && x.ab.bets.length} res=${x && JSON.stringify(x.res)} pe=${x && JSON.stringify(x.pe)} toast=${await toast()}`);
  await page.click('#toastUndo'); await pause(300);
  s = await all();
  console.log(`[${name}:M3] undo: ${ok(!!s.sA && !!s.sB && s.sA.stop.p === 1, 'both pieces back')}`);
  await page.locator('#card .wrow', { hasText: '只有下半场' }).locator('[data-a="wopen"]').click(); await pause();
  await page.click('#card [data-a="mmerge"]'); await pause(300);
  s = await all();
  console.log(`[${name}:M4] merge from the second piece: ${ok(!s.sB && s.sA && s.sA.ev.length === 14, 'one record, 14 events')}`);

  // ---------- C. model check + profit ----------
  await page.click('#card .tabs [data-t="stats"], #card [data-a="wtab"][data-v="stats"]').catch(() => {});
  if (!(await page.$('#card [data-a="mcheck"]'))){ await page.click('#card [data-a="close"]'); await page.openMid('ab'); await page.click('#ab [data-ab="stats"]'); await pause(300); }
  await page.click('#card [data-a="mcheck"]'); await page.clock.runFor(500); await pause(500);
  const st = await txt('#card .wst');
  console.log(`[${name}:C1] check: ${(/模型检查（你的比赛）(.*?)角球数据/.exec(st) || ['', st.slice(0, 300)])[1].slice(0, 330)}`);
  console.log(`[${name}:C2] profit: ${(/有填赔率.*?回报率是正的才是真的赚/.exec(st) || ['none'])[0].slice(0, 200)} ${ok(/\+0\.90 份/.test(st) && /\+30%/.test(st), 'P&L +0.90 units, ROI +30%')}`);
  await page.screenshot({ path: `${out}/${name}_c1_check.png`, fullPage: false });

  // ---------- S. storage ----------
  const tidy = await page.$('#card [data-a="wtab"][data-v="tidy"], #card .tabs [data-t="tidy"]');
  if (tidy) await tidy.click();
  await pause();
  console.log(`[${name}:S1] ${(/储存空间：[^。]*。/.exec(await txt('#card')) || ['no storage line'])[0]}`);
  await page.click('#card [data-a="close"]');

  // ---------- E2. linked before kick-off → bookmaker line + team split filled by itself ----------
  await page.click('#qbMore'); await page.locator('#card [data-a="new"]').click(); await pause(300);
  if (await page.$('#card [data-a="nq3"]')) await page.click('#card [data-a="nq3"]');
  await page.evaluate(() => localStorage.setItem('corner-sb-net', JSON.stringify({ key: 'K', auto: true, iv: 0, shots: true })));
  await page.reload(); await page.waitForSelector('#pred', { state: 'attached' }); await pause(300);
  await page.fill('#fH', '利物浦'); await page.fill('#fA', '黄潜');
  await page.clock.runFor(3000); await pause(500);
  await page.clock.runFor(10000); await pause(800);
  m = await cur();
  console.log(`[${name}:E2] exp=${m.exp} src=${m.expSrc} ${ok(m.exp > 9.4 && m.exp < 10.4 && /两队按本机资料分/.test(m.expSrc || ''), 'line + split filled by itself')} toast=${await toast()}`);
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
