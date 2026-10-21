// v19: bottom quick bar (同步／盘口／我的注／撤销／功能), video-window (PiP) mode on phones, the 功能 center,
// help notes, the end-of-match keep/drop choice, the new-match prompt and the match warehouse (search, filters,
// stats, tidy-up). API-Football is mocked.
// Usage: node uitest13.js <base_url> <out_dir> [sections, e.g. N,P,W,U]
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const wrap = require('./uihelp.js');

const T0 = Date.parse('2026-10-21T10:00:00Z') / 1000;
const T = { 40: 'Liverpool', 533: 'Villarreal' };
let FX, calls;
const fresh = () => { FX = { 2001: { lg: 'UEFA Champions League', h: 40, a: 533, st: '1H', el: 31, g: [0, 0], ck: [3, 1], first: T0 - 1830 } }; calls = []; };
function fx(id){
  const x = FX[id];
  return { fixture: { id, date: '2026-10-21T09:30:00+00:00', timestamp: T0 - 1830, periods: { first: x.first, second: x.second || null }, status: { short: x.st, elapsed: x.el, extra: null } },
    league: { name: x.lg }, teams: { home: { id: x.h, name: T[x.h] }, away: { id: x.a, name: T[x.a] } }, goals: { home: x.g[0], away: x.g[1] } };
}
function detail(id){
  const x = FX[id], b = fx(id);
  b.statistics = [x.h, x.a].map((t, j) => ({ team: { id: t, name: T[t] }, statistics: [{ type: 'Corner Kicks', value: x.ck[j] }, { type: 'Red Cards', value: null }] }));
  b.events = [];
  return b;
}
async function mock(ctx){
  await ctx.route('https://www.wikidata.org/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"search":[]}' }));
  await ctx.route('https://v3.football.api-sports.io/**', async route => {
    const req = route.request(), u = new URL(req.url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push(u.pathname + u.search);
    const q = k => u.searchParams.get(k);
    let body = { errors: [], response: [] };
    if (u.pathname === '/status') body.response = { subscription: { plan: 'Free', active: true }, requests: { current: calls.length, limit_day: 100 } };
    else if (u.pathname === '/fixtures' && q('live')) body.response = FX[2001].st === 'FT' ? [] : [fx(2001)];
    else if (u.pathname === '/fixtures' && q('date')) body.response = [fx(2001)];
    else if (u.pathname === '/fixtures' && q('id')) body.response = [detail(+q('id'))];
    else if (u.pathname === '/fixtures/statistics') body.response = [];
    else if (u.pathname.startsWith('/odds')) body.response = [];
    else body = { errors: { bad: 'unknown endpoint ' + u.pathname + u.search }, response: [] };
    return route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });
}
async function setup(browser, vp, opts, init){
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: 'block', ...(opts || {}) });
  await mock(ctx);
  if (init) await ctx.addInitScript(init.fn, init.arg);
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
    rect: sel => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) }; }),
    shown: sel => page.$eval(sel, e => getComputedStyle(e).display !== 'none' && !e.hidden).catch(() => false),
    store: () => page.evaluate(() => JSON.parse(localStorage.getItem('corner-sb-matches') || '{}')),
    cur: () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('corner-sb-matches') || '{}'); return s[JSON.parse(localStorage.getItem('corner-sb-current') || '""')] || null; }),
    tap: async (i, c, n = 1) => { for (let k = 0; k < n; k++){ await page.locator(`.pad[data-i="${i}"] [data-c="${c}"]:visible`).first().click(); await page.clock.runFor(15000); } },
    sheet: async () => (await page.$eval('#sheet', e => e.hidden)) ? 'closed' : ((await page.textContent('#card h3')) || '').trim(),
    toast: async () => (await page.$eval('#toast', e => e.hidden)) ? '' : ((await page.textContent('#toastMsg')) || '').trim(),
    // a click that the helper must not auto-answer (finish / new prompts)
    rawClick: sel => page.locator(sel).first().click(),
  };
  return h;
}
const ok = (c, msg) => (c ? 'OK ' : 'FAIL ') + msg;

// ---------- N. quick bar sync states: 联网 → 查找 → 同步 → 结束 (phone) ----------
async function quickSync(browser, name, vp, opts){
  fresh();
  const h = await setup(browser, vp, opts), { page, txt, pause } = h;
  const qb = async () => (await txt('#qbSync'));
  console.log(`[${name}:N0] bar=[${await txt('#strip')}]`);
  await page.click('#qbSync'); await pause();
  console.log(`[${name}:N1] ${ok((await h.sheet()) === '联网数据', 'no key → 联网 opens settings')} | sync=[${await qb()}]`);
  await page.fill('#netKey', 'TESTKEY'); await page.click('#card [data-a="nkey"]'); await pause(400);
  await page.click('#card [data-a="nauto"][data-v="0"]'); await page.click('#card [data-a="close"]');
  console.log(`[${name}:N2] key set, no names → sync=[${await qb()}]`);
  await page.click('#qbSync'); await pause();
  console.log(`[${name}:N3] ${ok(/输入球队名字/.test(await h.toast()), 'find without names asks for names')} toast=${await h.toast()}`);
  await page.fill('#fH', '利物浦'); await page.fill('#fA', '比利亚雷亚尔'); await pause(150);
  console.log(`[${name}:N4] names typed → sync=[${await qb()}]`);
  await page.click('#qbSync'); await page.clock.runFor(2000); await pause(600);
  console.log(`[${name}:N5] find → sheet=${await h.sheet()}`);
  if ((await h.sheet()) === '中途加入'){ await page.click('#card [data-a="jgo"]'); await pause(400); }
  console.log(`[${name}:N6] linked → sync=[${await qb()}] calls=${calls.length}`);
  FX[2001].ck = [4, 1]; FX[2001].el = 33;
  await page.clock.runFor(90000);
  const b0 = calls.length;
  await page.click('#qbSync'); await pause(600);
  console.log(`[${name}:N7] sync → requests ${calls.slice(b0).map(c => c.split('?')[0]).join(' ')} | sync=[${await qb()}] toast=${await h.toast()}`);
  FX[2001].st = 'FT'; FX[2001].el = 90; FX[2001].second = T0;
  await page.clock.runFor(60000);
  await page.click('#qbSync'); await pause(600);
  console.log(`[${name}:N8] after FT → sync=[${await qb()}] ${ok(/结束/.test(await qb()), 'button turns into 结束')}`);
  await page.screenshot({ path: `${out}/${name}_n_ft.png` });
  await page.locator('#qbSync').click(); await pause(300);
  console.log(`[${name}:N9] ${ok((await h.sheet()) === '结束这场', '结束 opens the keep/drop choice')} | ${(await txt('#card .hint')).slice(0, 60)}`);
  await h.rawClick('#card [data-a="fkeep"]'); await pause(300);
  const m = await h.cur();
  console.log(`[${name}:N10] st=${m.st} keep=${m.keep} toast=${await h.toast()}`);
  console.log(`[${name}:N] ERRORS: ${h.errors.length ? h.errors.join('\n') : 'none'}`);
  await h.ctx.close();
}

// ---------- P. video window (PiP) mode: band on top / bottom, everything else outside it (phones) ----------
async function pip(browser, name, vp, opts, H){
  fresh();
  const h = await setup(browser, vp, opts), { page, txt, pause, rect, shown } = h;
  await page.fill('#fH', '鹿岛鹿角'); await page.fill('#fA', '浦和红钻');
  await page.click('#qbMore'); await page.click('#card [data-a="pip"]');
  await page.click('#card [data-a="pippos"][data-v="top"]'); await page.click(`#card [data-a="piph"][data-v="${H}"]`);
  // while the sheet is open the band stays visible above it
  const band0 = await rect('#pipBand'), card0 = await rect('#card');
  console.log(`[${name}:P0] band ${band0.t}-${band0.b} (h ${band0.h}) | sheet card top ${card0.t} ${ok(card0.t >= band0.b, 'pip sheet below the band')}`);
  await page.click('#card [data-a="close"]');
  console.log(`[${name}:P1] before kick-off: header shown=${await shown('.bar')} hud=[${(await txt('#hud')).slice(0, 40)}]`);
  await page.click('#pred [data-pa="kick1"]'); await page.clock.runFor(60000);
  await h.tap(0, 'f3', 3); await h.tap(0, 'ck', 1); await h.tap(1, 'f3', 2);
  const band = await rect('#pipBand'), hud = await rect('#hud'), strip = await rect('#strip');
  const extra = await page.$$eval('.pad .extra', a => Math.round(Math.max(...a.map(e => e.getBoundingClientRect().bottom))));
  console.log(`[${name}:P2] header shown=${await shown('.bar')} tl shown=${await shown('.tl')} | band ${band.t}-${band.b} hud ${hud.t}-${hud.b} extra ${extra} strip ${strip.t}-${strip.b}`);
  console.log(`[${name}:P2] ${ok(hud.t >= band.b, 'data strip below the band')} ${ok(extra <= strip.t, 'pads end above the quick bar')} ${ok(strip.b === vp.height, 'quick bar at the bottom')}`);
  console.log(`[${name}:P3] hud=[${await txt('#hud')}]`);
  await page.screenshot({ path: `${out}/${name}_p1_top.png` });
  // the score cell opens the clock; sheets stay below the band
  await page.click('#hud [data-pa="clock"]'); await pause();
  const c1 = await rect('#card');
  console.log(`[${name}:P4] ${ok((await h.sheet()) === '比赛时间', 'score cell opens the clock')} ${ok(c1.t >= band.b, 'clock sheet below the band')}`);
  await page.click('#card [data-a="endh"]'); await page.click('#card [data-a="close"]'); await pause();
  console.log(`[${name}:P5] half-time hud cell=[${await txt('#hud .hud-s')}]`);
  await page.click('#hud [data-pa="kick2"]'); await pause();
  console.log(`[${name}:P6] ${ok(/下半场开球/.test(await h.toast()), 'second half from the hud')} cell=[${await txt('#hud .hud-s')}]`);
  // odds drawer stays below the band
  await page.click('#hud [data-pa="open"]'); await pause(400);
  const mid = await rect('#mid');
  console.log(`[${name}:P7] drawer ${mid.t}-${mid.b} ${ok(mid.t >= band.b, 'odds drawer below the band')} tab=${await page.$eval('#mid', e => e.dataset.tab)}`);
  await page.click('#midClose'); await pause(400);
  // size buttons
  await page.click('#qbMore'); await page.click('#card [data-a="pip"]');
  await page.click('#card [data-a="piph"][data-v="120"]'); await page.click('#card [data-a="pipn"][data-d="10"]');
  console.log(`[${name}:P8] band height ${(await rect('#pipBand')).h} saved=${await page.evaluate(() => localStorage.getItem('corner-sb-pip'))}`);
  await page.click(`#card [data-a="piph"][data-v="${H}"]`);
  // bottom
  await page.click('#card [data-a="pippos"][data-v="bot"]');
  const cb = await rect('#card'), bb = await rect('#pipBand');
  console.log(`[${name}:P9] bottom: band ${bb.t}-${bb.b} sheet card ${cb.t}-${cb.b} ${ok(cb.b <= bb.t, 'sheet above the band')}`);
  await page.click('#card [data-a="close"]'); await pause(300);
  const s2 = await rect('#strip'), b2 = await rect('#pipBand');
  const ex2 = await page.$$eval('.pad .extra', a => Math.round(Math.max(...a.map(e => e.getBoundingClientRect().bottom))));
  console.log(`[${name}:P10] band ${b2.t}-${b2.b} strip ${s2.t}-${s2.b} extra ${ex2} ${ok(s2.b <= b2.t, 'quick bar above the band')} ${ok(ex2 <= s2.t, 'pads above the quick bar')}`);
  await h.tap(1, 'ck', 1);
  console.log(`[${name}:P11] tap still works: away corners ${await txt('#ckA')}`);
  await page.click('#hud [data-pa="open"]'); await pause(400);
  const m2 = await rect('#mid');
  console.log(`[${name}:P12] drawer ${m2.t}-${m2.b} ${ok(m2.b <= b2.t, 'odds drawer above the band')}`);
  await page.screenshot({ path: `${out}/${name}_p2_bottom_drawer.png` });
  await page.click('#midClose'); await pause(400);
  await page.screenshot({ path: `${out}/${name}_p3_bottom.png` });
  // persists across reloads
  await page.reload(); await page.waitForSelector('#pred', { state: 'attached' }); await pause(300);
  console.log(`[${name}:P13] after reload: ${await page.evaluate(() => document.body.className)} band h ${(await rect('#pipBand')).h}`);
  await page.click('#qbMore'); await page.click('#card [data-a="pip"]'); await page.click('#card [data-a="pippos"][data-v="off"]'); await page.click('#card [data-a="close"]');
  console.log(`[${name}:P14] off: band shown=${await shown('#pipBand')} header shown=${await shown('.bar')} tl shown=${await shown('.tl')}`);
  console.log(`[${name}:P] ERRORS: ${h.errors.length ? h.errors.join('\n') : 'none'}`);
  await h.ctx.close();
}

// ---------- W. end-of-match choice, new-match prompt, warehouse, my bets, export ----------
async function warehouse(browser, name, vp, opts){
  fresh();
  const h = await setup(browser, vp, opts), { page, txt, pause } = h;
  const phone = vp.width < 600;
  const menu = async a => { await page.click('#qbMore'); await pause(100); if (a) await h.rawClick(`#card [data-a="${a}"]`); await pause(150); };
  // match 1: watched from kick-off to 90+ minutes, one real bet
  await page.fill('#fH', '鹿岛鹿角'); await page.fill('#fA', '浦和红钻'); await page.fill('#fLg', '日职联');
  await page.click('#pred [data-pa="kick1"]'); await page.clock.runFor(60000);
  await h.tap(0, 'f3', 4); await h.tap(0, 'ck', 1);
  await page.click('#qbMy'); await pause();
  console.log(`[${name}:W0] ${ok((await h.sheet()) === '记下我的投注', '我的注 with no bets opens the form')}`);
  await page.click('#card [data-a="mbgo"]'); await pause();
  console.log(`[${name}:W1] toast=${(await h.toast()).slice(0, 50)} | bar my=[${await txt('#qbMy')}]`);
  await h.tap(0, 'ck', 2); await h.tap(1, 'ck', 1); await h.tap(1, 'bx', 2);
  await page.click('#qbMy'); await pause();
  console.log(`[${name}:W2] ${ok((await h.sheet()) === '我的投注', '我的注 with a bet opens the list')} | ${(await txt('#card .myb')).slice(0, 90)}`);
  await page.click('#card [data-a="close"]');
  // undo from the quick bar
  const before = (await h.cur()).ev.length;
  await page.click('#undoBtn'); await pause();
  console.log(`[${name}:W3] undo: events ${before} → ${(await h.cur()).ev.length}`);
  await h.tap(1, 'bx', 1);
  await page.clock.fastForward('40:00');
  await menu('clock'); await page.click('#card [data-a="endh"]'); await page.click('#card [data-a="kick"][data-p="2"]'); await page.click('#card [data-a="close"]');
  await h.tap(0, 'ck', 1);
  await page.clock.fastForward('47:00');
  await menu('finish');
  console.log(`[${name}:W4] ${ok((await h.sheet()) === '结束这场', 'finish asks keep or drop')}`);
  await page.screenshot({ path: `${out}/${name}_w1_finish.png` });
  await h.rawClick('#card [data-a="fkeep"]'); await pause();
  let m = await h.cur();
  console.log(`[${name}:W5] kept: st=${m.st} keep=${m.keep} stop=${JSON.stringify(m.stop)} toast=${await h.toast()}`);
  // finished match → 新比赛 needs no question
  await menu('new');
  console.log(`[${name}:W6] new after finish: sheet=${await h.sheet()} names=[${(await h.cur()).h}]`);
  // match 2: a few taps only (junk), left unfinished with 先留着
  await page.fill('#fH', '川崎前锋'); await page.fill('#fA', '横滨水手'); await page.fill('#fLg', '日职联');
  await page.click('#pred [data-pa="kick1"]'); await page.clock.runFor(30000); await h.tap(0, 'f3', 2);
  await menu('new');
  console.log(`[${name}:W7] ${ok((await h.sheet()) === '开始新比赛', 'new with an unfinished match asks first')}`);
  await page.screenshot({ path: `${out}/${name}_w2_newq.png` });
  await h.rawClick('#card [data-a="nq3"]'); await pause();
  console.log(`[${name}:W8] 先留着 → current=[${(await h.cur()).h}] stored=${Object.keys(await h.store()).length}`);
  // match 3: drop (with undo), then keep
  await page.fill('#fH', '大阪钢巴'); await page.fill('#fA', '名古屋鲸八'); await page.fill('#fLg', '日职联');
  await page.click('#pred [data-pa="kick1"]'); await page.clock.runFor(30000); await h.tap(0, 'f3', 3); await h.tap(1, 'f3', 3);
  await menu('new'); await h.rawClick('#card [data-a="nq2"]'); await pause();
  const gone = !Object.values(await h.store()).some(x => x.h === '大阪钢巴');
  console.log(`[${name}:W9] 不保存 → deleted=${gone} toast=${await h.toast()}`);
  await page.click('#toastUndo'); await pause();
  console.log(`[${name}:W10] undo → current=[${(await h.cur()).h}] events=${(await h.cur()).ev.length}`);
  await menu('new'); await h.rawClick('#card [data-a="nq1"]'); await pause();
  m = Object.values(await h.store()).find(x => x.h === '大阪钢巴');
  console.log(`[${name}:W11] 结束并加入 → st=${m.st} keep=${m.keep} toast=${await h.toast()} current=[${(await h.cur()).h}]`);
  // drop a match from the finish sheet
  await page.fill('#fH', '神户胜利船'); await page.fill('#fA', '广岛三箭');
  await page.click('#pred [data-pa="kick1"]'); await page.clock.runFor(30000); await h.tap(0, 'f3', 2);
  await menu('finish'); await h.rawClick('#card [data-a="fdrop"]'); await pause();
  console.log(`[${name}:W12] 不加入 → stored=${Object.values(await h.store()).some(x => x.h === '神户胜利船')} current=[${(await h.cur()).h}] toast=${await h.toast()}`);
  // warehouse
  await menu('arch');
  const chips = await page.$$eval('#card [data-a="wf"]', a => a.map(b => b.textContent.trim()));
  console.log(`[${name}:W13] chips ${chips.join(' / ')} rows=${await page.locator('#card .wrow').count()}`);
  await page.screenshot({ path: `${out}/${name}_w3_list.png` });
  await page.fill('#whQ', '川崎'); await pause(150);
  console.log(`[${name}:W14] search 川崎 → ${await page.locator('#card .wrow').count()} row: ${(await txt('#card .wrow')).slice(0, 80)}`);
  await page.fill('#whQ', ''); await pause(100);
  await page.click('#card [data-a="wf"][data-v="open"]');
  console.log(`[${name}:W15] 未结束 → ${await page.locator('#card .wrow').count()}`);
  await page.click('#card [data-a="wf"][data-v="all"]');
  await page.locator('#card .wrow', { hasText: '川崎前锋' }).locator('[data-a="wopen"]').click(); await pause(100);
  console.log(`[${name}:W16] opened row actions: ${(await page.$$eval('#card .wact button', a => a.map(b => b.textContent.trim()))).join(' ')}`);
  // delete from the warehouse: confirm, then undo
  const n0 = await page.locator('#card .wrow').count();
  await page.locator('#card .wact [data-a="mdel"]').click(); await page.locator('#card .wact [data-a="mdel"]').click(); await pause();
  const n1 = await page.locator('#card .wrow').count();
  await page.click('#toastUndo'); await pause();
  console.log(`[${name}:W17] delete ${n0} → ${n1} → undo ${await page.locator('#card .wrow').count()}`);
  // help from inside the warehouse, then back
  await page.click('#card [data-help="arch"]'); await pause();
  console.log(`[${name}:W18] help: ${await h.sheet()} | back button=${!!(await page.$('#card [data-a="hback"]'))}`);
  await page.click('#card [data-a="hback"]'); await pause();
  console.log(`[${name}:W19] back → ${await h.sheet()}`);
  // stats
  await page.click('#card [data-a="wtab"][data-v="stats"]'); await pause();
  console.log(`[${name}:W20] stats: ${(await txt('#card .wst')).slice(0, 260)}`);
  await page.screenshot({ path: `${out}/${name}_w4_stats.png` });
  // tidy: one junk match (川崎, 2 taps); one stale after a day
  await page.click('#card [data-a="wtab"][data-v="tidy"]'); await pause();
  console.log(`[${name}:W21] tidy: ${(await txt('#card')).match(/几乎没有记录的比赛：\d+ 场|超过一天还没结束的比赛：\d+ 场/g).join(' | ')}`);
  await page.click('#card [data-a="wclean"][data-v="junk"]'); const cf = await txt('#card [data-a="wclean"][data-v="junk"]');
  await page.click('#card [data-a="wclean"][data-v="junk"]'); await pause();
  console.log(`[${name}:W22] junk: confirm label "${cf}" → left ${Object.values(await h.store()).filter(x => x.h === '川崎前锋').length} toast=${await h.toast()}`);
  await page.click('#card [data-a="close"]');
  // stale: an unfinished match a day later
  await page.fill('#fH', '浦和红钻'); await page.fill('#fA', '柏太阳神');
  await page.click('#pred [data-pa="kick1"]'); await page.clock.runFor(30000); await h.tap(0, 'f3', 3); await h.tap(1, 'f3', 3);
  await menu('new'); await h.rawClick('#card [data-a="nq3"]'); await pause();
  await page.clock.fastForward('25:00:00');
  await menu('wtidy');
  console.log(`[${name}:W23] a day later: ${(await txt('#card')).match(/超过一天还没结束的比赛：\d+ 场/)[0]}`);
  await page.click('#card [data-a="wfin"]'); await pause();
  m = Object.values(await h.store()).find(x => x.h === '浦和红钻');
  console.log(`[${name}:W24] finish all: st=${m.st} keep=${m.keep} toast=${await h.toast()}`);
  // export all carries my bets and keep
  await page.click('#card [data-a="expall"]'); await pause();
  const o = JSON.parse(await page.inputValue('#expText'));
  console.log(`[${name}:W25] export ${o.matches.length} matches | my=${o.matches.map(x => (x.my || []).length).join(',')} keep=${o.matches.map(x => x.keep || 0).join(',')} | readme mentions keep=${/keep=1/.test(JSON.stringify(o))}`);
  await page.click('#card [data-a="close"]');
  // 功能 center layout
  await menu();
  console.log(`[${name}:W26] 功能: groups=${(await page.$$eval('#card .fc h4', a => a.map(x => x.textContent.trim().slice(0, 6)))).join(' / ')} tiles=${await page.locator('#card .fct').count()}`);
  await page.click('#card [data-a="help"]'); await pause();
  console.log(`[${name}:W27] 功能说明 sections=${await page.locator('#card .hlp > div').count()}`);
  await page.click('#card [data-a="close"]');
  // help from the odds panel (drawer on phones): no back button
  await page.openMid('pred');
  await page.locator('#pred [data-help="ou"]').click(); await pause();
  await page.screenshot({ path: `${out}/${name}_w5_help_over_panel.png` });
  console.log(`[${name}:W28] ? on odds panel → ${await h.sheet()} back=${!!(await page.$('#card [data-a="hback"]'))} drawer closed=${!(await page.$('#mid.open'))}`);
  await page.click('#card [data-a="close"]'); await page.closeMid();
  console.log(`[${name}:W] ERRORS: ${h.errors.length ? h.errors.join('\n') : 'none'}`);
  await h.ctx.close();
}

// ---------- U. upgrade: existing data → one-time what's-new notice ----------
async function upgrade(browser, name, vp, opts){
  fresh();
  const v18 = { ma: { id: 'ma', c: 1, u: 2, d: '2026-10-19', lg: '英超', h: '甲', a: '乙', st: 2, exp: null, line: [4.5, 4.5], add: [null, null], pe: { 1: 2900, 2: 5400 }, tm: { p: 2, b: 5700, r: 0, at: 0, ht: 0 },
    ev: [{ t: 60, p: 1, i: 0, c: 'f3', k: 1 }, { t: 300, p: 1, i: 0, c: 'ck', k: 2 }], ab: { on: null, bets: [] } } };
  const h = await setup(browser, vp, opts, { fn: s => { if (!localStorage.getItem('corner-sb-matches')){ localStorage.setItem('corner-sb-matches', s); localStorage.setItem('corner-sb-current', '"ma"'); } }, arg: JSON.stringify(v18) });
  const { page, pause } = h;
  await page.clock.runFor(1200); await pause();
  console.log(`[${name}:U1] toast=${await h.toast()}`);
  await page.click('#toastUndo'); await pause();
  console.log(`[${name}:U2] → ${await h.sheet()}`);
  await page.click('#card [data-a="close"]');
  await page.reload(); await page.waitForSelector('#pred', { state: 'attached' }); await page.clock.runFor(1200); await pause();
  console.log(`[${name}:U3] after reload toast=[${await h.toast()}] (expect none)`);
  await page.click('#qbMore'); await page.click('#card [data-a="arch"]'); await pause();
  console.log(`[${name}:U4] old match in warehouse: ${(await h.txt('#card #whList')).slice(0, 90)}`);
  console.log(`[${name}:U] ERRORS: ${h.errors.length ? h.errors.join('\n') : 'none'}`);
  await h.ctx.close();
}

(async () => {
  const b = await chromium.launch();
  const PH = { isMobile: true, hasTouch: true }, only = (process.argv[4] || 'N,P,W,U').split(',');
  if (only.includes('N')) await quickSync(b, 'phone', { width: 390, height: 844 }, PH);
  if (only.includes('P')){ await pip(b, 'phone', { width: 390, height: 844 }, PH, 215); await pip(b, 'se', { width: 375, height: 667 }, PH, 165); }
  if (only.includes('W')) for (const [n, vp, o] of [['phone', { width: 390, height: 844 }, PH], ['se', { width: 375, height: 667 }, PH], ['ipad', { width: 1180, height: 820 }], ['ipadP', { width: 820, height: 1180 }]]) await warehouse(b, n, vp, o);
  if (only.includes('U')) await upgrade(b, 'phone', { width: 390, height: 844 }, PH);
  await b.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
