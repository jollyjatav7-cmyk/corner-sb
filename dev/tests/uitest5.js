// v5: auto-bet warm-up, online lookup against a mocked API-Football (auto match, candidate popup, swapped home/away,
// pre-match link, sync of missed corners, settlement prefill, wrong key).
// Usage: node uitest5.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const wrap = require('./uihelp.js');

const T = { 40: 'Liverpool', 49: 'Chelsea', 33: 'Manchester United', 50: 'Manchester City', 85: 'Paris Saint Germain', 80: 'Lyon', 114: 'Paris FC', 116: 'Lens', 290: 'Vissel Kobe', 293: 'Kashima', 194: 'Ajax', 197: 'PSV Eindhoven', 600: 'Wolfsberger AC', 601: 'Red Bull Salzburg' };
function freshFX(){
  return {
    1001: { lg: 'Premier League', h: 40, a: 49, st: '2H', el: 67, g: [1, 0], ck: [6, 3], ck1: [4, 2], rc: [0, 0], live: 1, sh: { on: [5, 2], off: [4, 3], blk: [3, 1] } },
    1007: { lg: 'Bundesliga', h: 600, a: 601, st: '1H', el: 30, g: [0, 1], ck: [2, 4], rc: [0, 0], live: 1 },
    1002: { lg: 'Premier League', h: 33, a: 50, st: '1H', el: 23, g: [1, 2], ck: [2, 5], rc: [0, 1], live: 1 },
    1003: { lg: 'Ligue 1', h: 85, a: 80, st: '1H', el: 30, g: [0, 0], ck: [3, 1], rc: [0, 0], live: 1 },
    1004: { lg: 'Ligue 1', h: 114, a: 116, st: '1H', el: 10, g: [0, 0], ck: [1, 0], rc: [0, 0], live: 1 },
    1005: { lg: 'J1 League', h: 290, a: 293, st: 'NS', el: null, g: [null, null], ck: [0, 0], rc: [0, 0], live: 0 },
    1006: { lg: 'Eredivisie', h: 194, a: 197, st: '2H', el: 55, g: [2, 2], ck: [4, 4], rc: [0, 0], live: 1 },
  };
}
let FX = freshFX();
const calls = [];
function fx(id){ const x = FX[id]; return { fixture: { id, date: '2026-10-20T10:00:00+00:00', status: { short: x.st, elapsed: x.el, extra: null } }, league: { name: x.lg }, teams: { home: { id: x.h, name: T[x.h] }, away: { id: x.a, name: T[x.a] } }, goals: { home: x.g[0], away: x.g[1] } }; }
function detail(id){ const x = FX[id], b = fx(id); b.statistics = x.live || x.st === 'FT' ? [x.h, x.a].map((t, j) => ({ team: { id: t, name: T[t] }, statistics: [{ type: 'Shots on Goal', value: x.sh ? x.sh.on[j] : 3 }, { type: 'Shots off Goal', value: x.sh ? x.sh.off[j] : 2 }, { type: 'Blocked Shots', value: x.sh ? x.sh.blk[j] : 1 }, { type: 'Corner Kicks', value: x.ck[j] || null }, { type: 'Red Cards', value: x.rc[j] || null }] })) : []; b.events = []; return b; }
function halfStats(id){ const x = FX[id]; return [x.h, x.a].map((t, j) => ({ team: { id: t }, statistics: [{ type: 'Corner Kicks', value: x.ck[j] }], statistics_1h: x.ck1 ? [{ type: 'Corner Kicks', value: x.ck1[j] }] : undefined })); }

const WD = { '沃尔夫斯贝格': [['Q1', '沃尔夫斯贝格足球俱乐部', '奥地利足球俱乐部'], ['Q2', '沃尔夫斯贝格', '奥地利城镇']], '萨尔茨堡红牛': [['Q3', '萨尔茨堡红牛足球俱乐部', '奥地利足球俱乐部']] };
const WDE = { Q1: ['Wolfsberger AC', ['WAC']], Q2: ['Wolfsberg', []], Q3: ['FC Red Bull Salzburg', ['Red Bull Salzburg', 'RB Salzburg']] };
const wdCalls = [];
async function mock(ctx){
  await ctx.route('https://www.wikidata.org/**', async route => {
    const u = new URL(route.request().url()); wdCalls.push(u.searchParams.get('action') + ':' + (u.searchParams.get('search') || u.searchParams.get('ids')));
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    let body;
    if (u.searchParams.get('action') === 'wbsearchentities') body = { search: (WD[u.searchParams.get('search')] || []).map(([id, label, description]) => ({ id, label, description })) };
    else { const ents = {}; for (const id of u.searchParams.get('ids').split('|')) if (WDE[id]) ents[id] = { id, labels: { en: { language: 'en', value: WDE[id][0] } }, aliases: { en: WDE[id][1].map(v => ({ language: 'en', value: v })) } }; body = { entities: ents }; }
    return route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });
  await ctx.route('https://v3.football.api-sports.io/**', async route => {
    const req = route.request(), u = new URL(req.url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push(u.pathname + u.search);
    let body;
    if (req.headers()['x-apisports-key'] !== 'TESTKEY') body = { errors: { token: 'Error/Missing application key.' }, response: [] };
    else if (u.pathname === '/status') body = { errors: [], response: { subscription: { plan: 'Free', active: true }, requests: { current: 12, limit_day: 100 } } };
    else if (u.pathname === '/fixtures' && u.searchParams.get('live')) body = { errors: [], response: Object.keys(FX).filter(k => FX[k].live).map(k => fx(+k)) };
    else if (u.pathname === '/fixtures' && u.searchParams.get('date')) body = { errors: [], response: Object.keys(FX).map(k => fx(+k)) };
    else if (u.pathname === '/fixtures' && u.searchParams.get('id')) body = { errors: [], response: [detail(+u.searchParams.get('id'))] };
    else if (u.pathname === '/fixtures/statistics') body = { errors: [], response: halfStats(+u.searchParams.get('fixture')) };
    else body = { errors: { bad: 'unknown endpoint' }, response: [] };
    return route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });
}

async function run(browser, name, vp, opts){
  FX = freshFX(); calls.length = 0;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: 'block', ...(opts || {}) });
  await mock(ctx);
  const page = wrap(await ctx.newPage(), vp.width < 600);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.clock.install({ time: new Date('2026-10-20T11:00:00Z') });
  await page.goto(base + '/index.html');
  await page.waitForSelector('#pred .start');
  const txt = async sel => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
  const netTxt = async () => `pill[${await txt('#netPill')}]` + ((await page.$('#pred .net')) ? ' bar[' + (await txt('#pred .net')) + ']' : '');
  const settle = async ms => { await page.waitForTimeout(ms || 300); };
  const tap = async (i, c, n = 1, gap = 20000) => { for (let k = 0; k < n; k++){ await page.locator(`.pad[data-i="${i}"] [data-c="${c}"]:visible`).first().click(); await page.clock.runFor(gap); } };

  // --- A. settings: wrong key, then right key
  console.log(`[${name}:nokey] link=${!!(await page.$('#pred [data-pa="nset"]'))}`);
  await page.click('#pred [data-pa="nset"]');
  await page.fill('#netKey', 'WRONG'); await page.click('#card [data-a="nkey"]'); await settle();
  console.log(`[${name}:wrongkey] ${await txt('#card .netnote')}`);
  await page.fill('#netKey', 'TESTKEY'); await page.click('#card [data-a="nkey"]'); await settle();
  console.log(`[${name}:key] ${await txt('#card .netnote')}`);
  await page.screenshot({ path: `${out}/${name}_n1_settings.png` });
  await page.click('#card [data-a="close"]');

  // --- B. type names → auto match (sure) → prefilled join in 2nd half
  await page.fill('#fH', '利物浦'); await page.fill('#fA', '切尔西');
  await page.clock.runFor(3000); await settle(600);
  await page.waitForSelector('#card .netnote', { timeout: 5000 }).catch(() => {});
  console.log(`[${name}:autojoin] ${(await txt('#card')).slice(0, 260)}`);
  await page.screenshot({ path: `${out}/${name}_n2_join.png` });
  await page.click('#card [data-a="jgo"]');
  console.log(`[${name}:joined] clock=${await txt('#clkT')} score=${await txt('#glH')}-${await txt('#glA')} ck=${await txt('#ckH')}/${await txt('#ckA')} | ${await netTxt()} | ${await txt('#pred .sub2')}`);

  // --- H. auto-bet warm-up
  await page.click('#ab [data-ab="hold"][data-v="60"]');
  await page.click('#ab [data-ab="on"]'); await page.clock.runFor(11000);
  console.log(`[${name}:warm] ${(await txt('#ab')).slice(0, 80)}`);

  // --- C. sync: API sees one more home corner → added; user taps an away corner before the API → no double count
  FX[1001].ck = [7, 3]; FX[1001].el = 70; FX[1001].sh = { on: [6, 2], off: [4, 3], blk: [4, 1] };
  await page.clock.runFor(3 * 60000); await settle(600);
  console.log(`[${name}:sync1] toast=${await txt('#toast')} | ck=${await txt('#ckH')}/${await txt('#ckA')} | strip=${(await txt('#recent')).slice(0, 60)}`);
  console.log(`[${name}:sync1-times] ${await page.evaluate(() => JSON.parse(localStorage.getItem('corner-sb-matches')) && Object.values(JSON.parse(localStorage.getItem('corner-sb-matches'))).flatMap(m => m.ev.filter(e => e.a).map(e => e.c + '@' + e.t)).join(' '))} | dashed stems=${await page.$$eval('#tl .sm.au', a => a.length)}`);
  await tap(1, 'ck', 1, 10000);
  FX[1001].ck = [7, 4]; FX[1001].el = 73;
  await page.clock.runFor(3 * 60000); await settle(600);
  console.log(`[${name}:sync2] ck=${await txt('#ckH')}/${await txt('#ckA')} | ${await netTxt()}`);
  await tap(0, 'ck', 1, 5000);   // a mistaken tap → mismatch shown
  console.log(`[${name}:mismatch] ${await netTxt()}`);
  await page.click('#undoBtn');
  console.log(`[${name}:warm-after] ${(await txt('#ab')).slice(0, 120)}`);

  // --- F. match ends on the API → offer to finish → settlement prefilled from API
  FX[1001] = Object.assign(FX[1001], { st: 'FT', el: 90, ck: [9, 5], live: 0 });
  await page.clock.runFor(3 * 60000); await settle(600);
  console.log(`[${name}:ft-toast] ${await txt('#toast')}`);
  const bets = await page.$$eval('#ab .abt tr', r => r.length);
  console.log(`[${name}:ft-bar] ${await netTxt()}`);
  await page.click('#pred [data-pa="nfin"]'); await settle(600);
  const sheetOpen = await page.$eval('#sheet', e => !e.hidden);
  console.log(`[${name}:finish] bets=${bets} settleOpen=${sheetOpen} ${sheetOpen ? (await txt('#card')).slice(0, 160) : ''}`);
  await page.screenshot({ path: `${out}/${name}_n3_settle.png` });
  if (sheetOpen) await page.click('#card [data-a="close"]');

  // --- D. ambiguous names → candidate popup → pick; alias remembered
  await page.click('#pred [data-pa="new"]'); await page.waitForSelector('#pred .start');
  await page.fill('#fH', '巴黎'); await page.fill('#fA', '朗斯');
  await page.clock.runFor(3000); await settle(600);
  await page.waitForSelector('#sugg:not([hidden]) .picks', { timeout: 5000 }).catch(() => {});
  const gap = await page.evaluate(() => { const a = document.querySelector('.score').getBoundingClientRect(), b = document.querySelector('#sugg').getBoundingClientRect(); return Math.round(b.top - a.bottom); });
  console.log(`[${name}:inline] sheetOpen=${await page.$eval('#sheet', e => !e.hidden)} gapBelowScore=${gap}px | ${(await txt('#sugg')).slice(0, 200)}`);
  await page.screenshot({ path: `${out}/${name}_n4_pick.png` });
  await page.fill('#sgQ', 'paris fc'); await settle(200);
  console.log(`[${name}:filter] ${(await txt('#sugg .picks')).slice(0, 120)}`);
  await page.locator('#sugg [data-sg="pick"]').first().click(); await settle(600);
  console.log(`[${name}:picked] ${(await txt('#card')).slice(0, 140)}`);
  await page.click('#card [data-a="close"]');
  const alias = await page.evaluate(() => localStorage.getItem('corner-sb-alias'));
  console.log(`[${name}:alias] ${alias}`);

  // --- Chinese names not in the built-in list → Wikidata → matched
  await page.click('#menuBtn'); await page.click('#card [data-a="new"]'); await page.waitForSelector('#pred .start');
  await page.fill('#fH', '沃尔夫斯贝格'); await page.fill('#fA', '萨尔茨堡红牛');
  await page.clock.runFor(3000); await settle(800);
  await page.waitForSelector('#card .netnote', { timeout: 5000 }).catch(() => {});
  console.log(`[${name}:wikidata] calls=${wdCalls.join(' ')} | ${(await txt('#card')).slice(0, 120)}`);
  await page.click('#card [data-a="close"]');

  // --- swapped home/away: user enters 曼城 (home) / 曼联 (away); API has Man Utd at home
  await page.click('#menuBtn'); await page.click('#card [data-a="new"]'); await page.waitForSelector('#pred .start');
  await page.fill('#fH', '曼城'); await page.fill('#fA', '曼联');
  await page.clock.runFor(3000); await settle(600);
  await page.waitForSelector('#card .netnote', { timeout: 5000 }).catch(() => {});
  console.log(`[${name}:swapped] ${(await txt('#card')).slice(0, 200)}`);
  await page.click('#card [data-a="close"]');

  // --- E. pre-match: J-League game not live → found in today's list, linked without joining
  await page.click('#menuBtn'); await page.click('#card [data-a="new"]'); await page.waitForSelector('#pred .start');
  await page.fill('#fH', '神户胜利船'); await page.fill('#fA', '鹿岛鹿角');
  await page.clock.runFor(3000); await settle(800);
  console.log(`[${name}:prematch] toast=${await txt('#toast')} | ${await netTxt()}`);
  // names not in the dictionary and no match → message in the bar, no popup
  await page.click('#menuBtn'); await page.click('#card [data-a="new"]'); await page.waitForSelector('#pred .start');
  await page.fill('#fH', '某某队'); await page.fill('#fA', '另一队');
  await page.clock.runFor(3000); await settle(600);
  console.log(`[${name}:nomatch] sheet=${await page.$eval('#sheet', e => !e.hidden)} | ${await netTxt()}`);
  await page.screenshot({ path: `${out}/${name}_n5_bar.png` });
  console.log(`[${name}:calls] ${calls.length}: ${[...new Set(calls.map(c => c.split('?')[0] + (c.includes('live') ? '?live' : c.includes('date') ? '?date' : c.includes('half') ? '?half' : '')))].join(' ')}`);
  console.log(`[${name}] ERRORS: ${errors.length ? errors.join('\n') : 'none'}`);
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch();
  await run(browser, 'ipad', { width: 1180, height: 820 });
  await run(browser, 'phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
