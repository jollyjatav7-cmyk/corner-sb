// v20: (1) pre-match expectation without paid API history — local corner book (J1 seed + daily collector),
// bookmaker pre-match line, league average, free-plan message; (2) rhythm block 基础 × 心态 × 攻势 always visible;
// (3) 更新盘口 on the quick bar; (4) a linked match that is not being recorded joins from the API when you press 同步.
// API-Football is mocked, including the free plan's "past dates" errors.
// Usage: node uitest14.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const wrap = require('./uihelp.js');

const T0 = Date.parse('2026-10-21T11:00:00Z') / 1000;   // 20:00 in Tokyo
const TEAMS = { 283: 'Kashiwa Reysol', 1041: 'JEF United Chiba', 290: 'Kashima', 287: 'Urawa', 40: 'Liverpool', 533: 'Villarreal', 900: 'Al Ahly', 901: 'Zamalek' };
const LG = { j1: { id: 98, name: 'J1 League', country: 'Japan' }, ucl: { id: 2, name: 'UEFA Champions League', country: 'World' }, eg: { id: 233, name: 'Premier League', country: 'Egypt' } };
let FX, calls;
function fresh(){
  FX = {
    3001: { lg: 'j1', d: '2026-10-21', h: 283, a: 1041, st: '2H', el: 67, g: [1, 0], ck: [4, 3], first: T0 - 4500, second: T0 - 1250 },
    2001: { lg: 'ucl', d: '2026-10-21', h: 40, a: 533, st: 'NS', el: null, g: [null, null], ck: null },
    4001: { lg: 'j1', d: '2026-10-20', h: 290, a: 287, st: 'FT', el: 90, g: [2, 1], ck: [6, 2] },
    5001: { lg: 'eg', d: '2026-10-20', h: 900, a: 901, st: 'FT', el: 90, g: [0, 0], ck: [5, 5] },
    2002: { lg: 'eg', d: '2026-10-21', h: 900, a: 901, st: 'NS', el: null, g: [null, null], ck: null },
  };
  calls = [];
  PRE_ODDS = [{ bookmakers: [{ name: 'Bet365', bets: [{ name: 'Corners Over Under', values: [{ value: 'Over 10.5', odd: '1.85' }, { value: 'Under 10.5', odd: '1.95' }, { value: 'Over 9.5', odd: '1.55' }, { value: 'Under 9.5', odd: '2.35' }] }] }] }];
}
function fx(id){
  const x = FX[id];
  return { fixture: { id, date: x.d + 'T10:00:00+00:00', timestamp: Date.parse(x.d + 'T10:00:00Z') / 1000, periods: { first: x.first || null, second: x.second || null }, status: { short: x.st, elapsed: x.el, extra: null } },
    league: LG[x.lg], teams: { home: { id: x.h, name: TEAMS[x.h] }, away: { id: x.a, name: TEAMS[x.a] } }, goals: { home: x.g[0], away: x.g[1] } };
}
function detail(id){
  const x = FX[id], b = fx(id);
  b.statistics = x.ck ? [x.h, x.a].map((t, j) => ({ team: { id: t, name: TEAMS[t] }, statistics: [{ type: 'Corner Kicks', value: x.ck[j] }, { type: 'Red Cards', value: null }] })) : [];
  b.events = [];
  return b;
}
let PRE_ODDS;
const LIVE_ODDS = [{ odds: [{ name: 'Total Corners', values: [{ value: 'Over', handicap: '11.5', odd: '1.90', main: true }, { value: 'Under', handicap: '11.5', odd: '1.90', main: true }] }] }];
async function mock(ctx){
  await ctx.route('https://www.wikidata.org/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"search":[]}' }));
  await ctx.route('https://v3.football.api-sports.io/**', async route => {
    const req = route.request(), u = new URL(req.url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push(u.pathname + u.search);
    const q = k => u.searchParams.get(k);
    let body = { errors: [], response: [] };
    const date = q('date');
    if (u.pathname === '/status') body.response = { subscription: { plan: 'Free', active: true }, requests: { current: calls.length, limit_day: 100 } };
    else if (u.pathname === '/fixtures' && q('live')) body.response = Object.keys(FX).filter(k => ['1H', 'HT', '2H'].includes(FX[k].st)).map(k => fx(+k));
    else if (u.pathname === '/fixtures' && date) body = date >= '2026-10-20' ? { errors: [], response: Object.keys(FX).filter(k => FX[k].d === date).map(k => fx(+k)) } : { errors: { plan: 'Free plans do not have access to this date, try from 2026-10-20 to 2026-10-22.' }, response: [] };
    else if (u.pathname === '/fixtures' && q('id')) body.response = [detail(+q('id'))];
    else if (u.pathname === '/fixtures' && q('ids')) body.response = q('ids').split('-').map(Number).filter(k => FX[k]).map(detail);
    else if (u.pathname === '/fixtures' && q('team')) body = { errors: { plan: q('last') ? 'Free plans do not have access to the Last parameter.' : 'Free plans do not have access to this season, try from 2021 to 2023.' }, response: [] };
    else if (u.pathname === '/odds/live') body.response = +q('fixture') === 3001 ? LIVE_ODDS : [];
    else if (u.pathname === '/odds') body.response = +q('fixture') === 2001 ? PRE_ODDS : [];
    else body = { errors: { bad: 'unknown endpoint ' + u.pathname + u.search }, response: [] };
    return route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });
}
async function setup(browser, vp, opts){
  fresh();
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'Asia/Tokyo', ...(opts || {}) });
  await mock(ctx);
  await ctx.addInitScript(() => { if (!localStorage.getItem('corner-sb-net')) localStorage.setItem('corner-sb-net', JSON.stringify({ key: 'TESTKEY', auto: true, iv: 0 })); });
  const page = wrap(await ctx.newPage(), vp.width < 600);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.clock.install({ time: new Date(T0 * 1000) });
  await page.goto(base + '/index.html'); await page.waitForSelector('#pred', { state: 'attached' }); await page.waitForTimeout(250);
  const h = {
    ctx, page, errors,
    txt: async sel => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim(),
    pause: ms => page.waitForTimeout(ms || 250),
    sheet: async () => (await page.$eval('#sheet', e => e.hidden)) ? 'closed' : ((await page.textContent('#card h3')) || '').trim(),
    toast: async () => (await page.$eval('#toast', e => e.hidden)) ? '' : ((await page.textContent('#toastMsg')) || '').trim(),
    cur: () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('corner-sb-matches') || '{}'); return s[JSON.parse(localStorage.getItem('corner-sb-current') || '""')] || { h: '', a: '', lg: '', ev: [], ab: { on: null, bets: [] }, blank: 1 }; }),
    book: () => page.evaluate(() => JSON.parse(localStorage.getItem('corner-sb-book') || '{}')),
    tap: async (i, c, n = 1) => { for (let k = 0; k < n; k++){ await page.locator(`.pad[data-i="${i}"] [data-c="${c}"]:visible`).first().click(); await page.clock.runFor(15000); } },
    rawClick: sel => page.locator(sel).first().click(),
  };
  return h;
}
const ok = (c, msg) => (c ? 'OK ' : 'FAIL ') + msg;

// ---------- J. the user's case: only the away team typed, linked to a live match, join closed, home name cleared ----------
async function joinCase(browser, name, vp, opts){
  const h = await setup(browser, vp, opts), { page, txt, pause } = h;
  await page.fill('#fA', '千叶'); await page.clock.runFor(3000); await pause(700);
  await page.waitForSelector('#sugg:not([hidden]) [data-sg="pick"]', { timeout: 5000 });
  console.log(`[${name}:J0] candidates: ${(await txt('#sugg .picks')).slice(0, 90)}`);
  await page.locator('#sugg [data-sg="pick"]').first().click(); await pause(800);
  console.log(`[${name}:J1] after pick: sheet=${await h.sheet()} home=[${await page.inputValue('#fH')}]`);
  if ((await h.sheet()) !== 'closed') await page.click('#card [data-a="close"]');
  await page.fill('#fH', ''); await pause(150);   // home name gone, like the screenshot
  console.log(`[${name}:J2] linked, not recording: quick sync=[${await txt('#qbSync')}] hud=[${(await txt('#hud')).slice(0, 40)}]`);
  await page.screenshot({ path: `${out}/${name}_j1_linked.png` });
  FX[3001].el = 69; FX[3001].ck = [5, 3];
  await page.click('#qbSync'); await pause(700);
  const sh = await h.sheet();
  console.log(`[${name}:J3] ${ok(sh === '中途加入', '同步 opens 中途加入 filled from the API')} | ${(await txt('#card')).slice(0, 150)}`);
  console.log(`[${name}:J4] home name refilled=[${await page.inputValue('#fH')}]`);
  await page.screenshot({ path: `${out}/${name}_j2_join.png` });
  await page.click('#card [data-a="jgo"]'); await pause(400);
  const m = await h.cur();
  const ck = [0, 1].map(i => m.ev.filter(e => e.c === 'ck' && e.i === i).length);
  console.log(`[${name}:J5] recording: corners ${ck.join('–')} score ${await txt('#glH')}–${await txt('#glA')} ${ok(ck[0] === 5 && ck[1] === 3, 'corners match the API')} | quick sync=[${await txt('#qbSync')}]`);
  // 比赛已经开始了 on another linked match uses the API too
  await page.click('#qbMore'); await h.rawClick('#card [data-a="new"]'); await pause();
  if ((await h.sheet()) === '开始新比赛') await h.rawClick('#card [data-a="nq3"]');
  await page.fill('#fH', '柏太阳神'); await page.fill('#fA', '千叶'); await page.clock.runFor(3000); await pause(800);
  console.log(`[${name}:J6] typed both names: sheet=${await h.sheet()}`);
  if ((await h.sheet()) !== 'closed') await page.click('#card [data-a="close"]');
  await page.click('#pred [data-pa="join"]'); await pause(700);
  console.log(`[${name}:J7] 比赛已经开始了 → ${await h.sheet()} | ${(await txt('#card .netnote').catch(() => '')).slice(0, 60)}`);
  if ((await h.sheet()) !== 'closed') await page.click('#card [data-a="close"]');
  console.log(`[${name}:J] ERRORS: ${h.errors.length ? h.errors.join('\n') : 'none'}`);
  await h.ctx.close();
}

// ---------- R. rhythm block + 更新盘口 ----------
async function rhythm(browser, name, vp, opts){
  const h = await setup(browser, vp, opts), { page, txt, pause } = h;
  const phone = vp.width < 600;
  await page.fill('#fH', '柏太阳神'); await page.fill('#fA', '千叶'); await page.clock.runFor(3000); await pause(800);
  if ((await h.sheet()) === '中途加入') await page.click('#card [data-a="jgo"]');
  await pause(300);
  await h.tap(0, 'f3', 4); await h.tap(0, 'bx', 2); await h.tap(1, 'f3', 1);
  const sel = phone ? '#hud .rhy' : '#pred .rhy';
  console.log(`[${name}:R1] rhythm visible=${await page.isVisible(sel)} | ${await txt(sel)}`);
  // numbers multiply out: now = base × mood × attack
  const rows = phone ? await page.$$eval(`${sel} .rt`, a => a.map(x => [...x.querySelector('.r2').childNodes].filter(n => n.nodeType === 3).map(n => +n.textContent).concat(+x.querySelector('.r1 b').textContent)))
    : await page.$eval(sel, e => { const v = [...e.querySelectorAll('span:not(.th), b')].map(x => +x.textContent); return [v.slice(0, 4), v.slice(4, 8)]; });
  console.log(`[${name}:R2] ${rows.map(r => ok(Math.abs(r[0] * r[1] * r[2] - r[3]) < 0.02, `${r[0]}×${r[1]}×${r[2]}≈${r[3]}`)).join(' | ')}`);
  await page.screenshot({ path: `${out}/${name}_r1_rhythm.png` });
  await page.click(sel); await pause(500);
  console.log(`[${name}:R3] tap → breakdown open=${!!(await page.$('#pred .why'))} drawer=${phone ? !!(await page.$('#mid.open')) : 'n/a'}`);
  if (phone) await page.click('#midClose');
  await pause(300);
  // 更新盘口
  console.log(`[${name}:R4] odds button=[${await txt('#qbOdds')}] visible=${await page.isVisible('#qbOdds')}`);
  const c0 = calls.length;
  await page.click('#qbOdds'); await pause(600);
  console.log(`[${name}:R5] ${ok(calls.slice(c0).some(c => c.startsWith('/odds/live')), 'reads live odds')} toast=${await h.toast()} | button=[${await txt('#qbOdds')}]`);
  console.log(`[${name}:R6] full-match line now ${(await h.cur()).fl}`);
  console.log(`[${name}:R] ERRORS: ${h.errors.length ? h.errors.join('\n') : 'none'}`);
  await h.ctx.close();
}

// ---------- E. pre-match expectation ----------
async function expectation(browser, name, vp, opts){
  const h = await setup(browser, vp, opts), { page, txt, pause } = h;
  const bk = await h.book();
  console.log(`[${name}:E0] seed in book: ${Object.keys(bk.fx || {}).length} matches (seed ${bk.seed})`);
  // a. both teams in the J1 seed, not linked: one tap uses the local data
  await page.evaluate(() => { const n = JSON.parse(localStorage.getItem('corner-sb-net')); n.auto = false; localStorage.setItem('corner-sb-net', JSON.stringify(n)); });
  await page.reload(); await page.waitForSelector('#pred', { state: 'attached' }); await pause(300);
  await page.fill('#fH', '鹿岛鹿角'); await page.fill('#fA', '浦和红钻'); await pause(100);
  await page.click('#pred [data-pa="expauto"]'); await pause(400);
  let m = await h.cur();
  console.log(`[${name}:E1] ${ok(m.exp != null && /^本机资料/.test(m.expSrc), 'local data used')} exp=${m.exp} expIn=${JSON.stringify(m.expIn)} src=${m.expSrc} | toast=${await h.toast()}`);
  // b. sheet: three ways
  await page.click('#pred [data-pa="expc"]'); await pause(400);
  console.log(`[${name}:E2] sheet: ${(await txt('#card')).slice(0, 420)}`);
  await page.screenshot({ path: `${out}/${name}_e1_sheet.png` });
  await page.click('#card [data-a="xl"][data-d="0.5"]'); await page.click('#card [data-a="xl"][data-d="0.5"]');
  const lbl = await txt('#card [data-a="xodds"]');
  await page.click('#card [data-a="xodds"]'); await pause(300);
  m = await h.cur();
  console.log(`[${name}:E3] bookmaker line typed: button "${lbl}" → exp=${m.exp} expIn=${m.expIn} src=${m.expSrc}`);
  // league average (typed league 日职联)
  await page.fill('#fLg', '日职联'); await pause(100);
  await page.click('#pred [data-pa="expc"]'); await pause(300);
  const lgb = await page.$('#card [data-a="xlg"]');
  console.log(`[${name}:E4] league average button: ${lgb ? await lgb.textContent() : 'none'}`);
  if (lgb){ await lgb.click(); await pause(200); m = await h.cur(); console.log(`[${name}:E5] exp=${m.exp} src=${m.expSrc}`); }
  else await page.click('#card [data-a="close"]');
  // c. linked UCL match before kick-off, teams not in the book: bookmaker pre-match line from the API
  await page.click('#qbMore'); await h.rawClick('#card [data-a="new"]'); await pause();
  if ((await h.sheet()) === '开始新比赛') await h.rawClick('#card [data-a="nq3"]');
  await page.evaluate(() => { const n = JSON.parse(localStorage.getItem('corner-sb-net')); n.auto = true; localStorage.setItem('corner-sb-net', JSON.stringify(n)); });
  await page.reload(); await page.waitForSelector('#pred', { state: 'attached' }); await pause(300);
  await page.fill('#fH', '利物浦'); await page.fill('#fA', '比利亚雷亚尔'); await page.clock.runFor(3000); await pause(900);
  console.log(`[${name}:E6] linked=${!!(await h.cur()).api} toast=${await h.toast()}`);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('corner-sb-matches')); });
  const c0 = calls.length;
  await page.click('#pred [data-pa="expauto"]'); await pause(700);
  m = await h.cur();
  console.log(`[${name}:E7] ${ok(/^博彩/.test(m.expSrc || ''), 'pre-match line used')} exp=${m.exp} src=${m.expSrc} requests=${calls.slice(c0).join(' ')}`);
  // d. no odds, no local data, free plan → sheet with a clear message; the app remembers the plan
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('corner-sb-matches')); });
  PRE_ODDS[0].bookmakers = [];
  await page.click('#qbMore'); await h.rawClick('#card [data-a="new"]'); await pause();
  if ((await h.sheet()) === '开始新比赛') await h.rawClick('#card [data-a="nq3"]');
  await page.fill('#fH', 'Al Ahly'); await page.fill('#fA', 'Zamalek'); await page.clock.runFor(3000); await pause(900);
  console.log(`[${name}:E8] linked=${!!(await h.cur()).api}`);
  await page.click('#pred [data-pa="expauto"]'); await pause(900);
  console.log(`[${name}:E9] → ${await h.sheet()} | ${(await txt('#card .netnote').catch(() => '')).slice(0, 80)} | free=${(await page.evaluate(() => JSON.parse(localStorage.getItem('corner-sb-net')).free))}`);
  await page.screenshot({ path: `${out}/${name}_e2_free.png` });
  await page.click('#card [data-a="close"]');
  // e. daily collector: yesterday's J1 result goes into the book, other leagues do not
  await page.clock.runFor(16000); await pause(900);
  const b2 = await h.book();
  console.log(`[${name}:E10] collector: a4001=${JSON.stringify(b2.fx && b2.fx.a4001 && b2.fx.a4001.ck)} a5001=${!!(b2.fx && b2.fx.a5001)} days=${JSON.stringify(b2.days)} total=${Object.keys(b2.fx).length}`);
  console.log(`[${name}:E] ERRORS: ${h.errors.length ? h.errors.join('\n') : 'none'}`);
  await h.ctx.close();
}

(async () => {
  const b = await chromium.launch();
  const PH = { isMobile: true, hasTouch: true };
  for (const [n, vp, o] of [['phone', { width: 390, height: 844 }, PH], ['ipad', { width: 1180, height: 820 }]]) await joinCase(b, n, vp, o);
  for (const [n, vp, o] of [['phone', { width: 390, height: 844 }, PH], ['se', { width: 375, height: 667 }, PH], ['ipad', { width: 1180, height: 820 }], ['ipadP', { width: 820, height: 1180 }]]) await rhythm(b, n, vp, o);
  for (const [n, vp, o] of [['phone', { width: 390, height: 844 }, PH], ['ipad', { width: 1180, height: 820 }]]) await expectation(b, n, vp, o);
  await b.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
