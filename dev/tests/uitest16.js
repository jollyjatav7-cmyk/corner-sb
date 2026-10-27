// v25: (P) half button 上半场结束 → 下半场开球 → 全场结束, stoppage time stays in the first half, undo;
// (R) pausing in first-half stoppage and resuming asks 下半场开球 / 继续上半场 (header ▶ and, on phones, the video-window score cell);
// (A) auto-bet: first-half market stops at 40:00, full-match market keeps going past 40:00 and half time and stops at 85:00,
//     "按赔率走势" hold (小/受让 60 s, 大/让球 180 s, 平手 120 s), warm-up switch;
// (B) team averages: one or two matches per team are used (pulled toward the league average), own finished matches go into the book;
// (C) linked match: bookmaker pre-match line sets the total, team averages split it. API-Football is mocked.
// Usage: node uitest16.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const wrap = require('./uihelp.js');

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
    else if (u.pathname === '/odds/live') resp = [];
    else if (u.pathname === '/fixtures' && (q('date') || q('id'))) resp = [fx()];
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ errors: [], response: resp }) });
  });
}
// a small book: Liverpool 2 matches, Villarreal 1, Serie A / Premier League 10+ matches for league averages
function book(){
  const fxs = {}, add = (k, x) => { fxs[k] = x; };
  const lg = (lid, name, lc, teams, n, tot) => { for (let i = 0; i < n; i++) add(`s${lid}_${i}`, { d: `2026-10-${String(10 + (i % 15)).padStart(2, '0')}`, lid, lg: name, lc, h: teams[i % teams.length] + ' X', a: teams[(i + 3) % teams.length] + ' Y', ck: [Math.ceil(tot / 2), Math.floor(tot / 2)], src: 'api' }); };
  lg(39, 'Premier League', 'England', ['Brentford', 'Fulham', 'Everton', 'Burnley', 'Wolves'], 12, 10);
  lg(135, 'Serie A', 'Italy', ['Lecce', 'Pisa', 'Torino', 'Genoa', 'Parma'], 12, 10);
  add('a900', { d: '2026-10-25', lid: 39, lg: 'Premier League', lc: 'England', h: 'Liverpool', a: 'Everton', hid: 40, aid: 45, ck: [9, 1], src: 'api' });
  add('a901', { d: '2026-10-21', lid: 2, lg: 'UEFA Champions League', lc: 'World', h: 'Arsenal', a: 'Liverpool', hid: 42, aid: 40, ck: [4, 7], src: 'api' });
  add('a902', { d: '2026-10-24', lid: 140, lg: 'La Liga', lc: 'Spain', h: 'Villarreal', a: 'Sevilla', hid: 533, aid: 536, ck: [3, 6], src: 'api' });
  add('a903', { d: '2026-10-26', lid: 135, lg: 'Serie A', lc: 'Italy', h: 'Como', a: 'Lazio', hid: 895, aid: 487, ck: [3, 6], src: 'api' });
  return { fx: fxs, days: {}, seed: '2026-10-18' };
}
async function run(browser, name, vp, opts){
  const isPhone = vp.width < 600;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: 'block', ...(opts || {}) });
  await mock(ctx);
  await ctx.addInitScript(([b, T]) => {
    if (localStorage.getItem('t16')) return;
    localStorage.setItem('t16', '1');
    localStorage.setItem('corner-sb-book', JSON.stringify(b));
    // one finished match of your own (not linked): 尤文 7–2 国米 → goes into the book
    localStorage.setItem('corner-sb-matches', JSON.stringify({ old1: { id: 'old1', d: '2026-10-20', lg: '意甲', h: '尤文', a: '国米', st: 2, ev: [], res: { h1: null, ft: [7, 2] }, keep: 1, c: T - 8 * 86400, u: T - 8 * 86400,
      obs: { p: 2, t: 2700 }, stop: { p: 2, t: 5600 }, tm: { p: 2, b: 5600, r: 0, at: 0, ht: 0 }, ab: { on: null, bets: [] } } }));
  }, [book(), T0]);
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
  const cur = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('corner-sb-matches') || '{}'); return s[JSON.parse(localStorage.getItem('corner-sb-current') || '""')] || { ev: [], tm: {}, pe: {}, ab: { on: null, bets: [] }, blank: 1 }; });
  const secs = async () => { const t = await txt('#clkT'); const m = /^(\d+)\+(\d+):(\d+)$/.exec(t); if (m) return +m[1] * 60 + +m[2] * 60 + +m[3]; const [a, b] = t.split(':').map(Number); return a * 60 + b; };
  const tap = async (i, c) => { await page.locator(`.pad[data-i="${i}"] [data-c="${c}"]:visible`).first().click(); await page.clock.runFor(1000); };
  const phVis = async () => page.$eval('#phBtn', e => !e.hidden && e.getBoundingClientRect().width > 0);

  // ---------- P. half button ----------
  await page.fill('#fH', '柏太阳神'); await page.fill('#fA', '千叶');
  console.log(`[${name}:P0] before kick-off pill shown=${await phVis()}`);
  await page.click('#runBtn');
  await page.clock.runFor(46 * 60000 + 30000); await pause();
  await tap(0, 'ck'); await pause();
  let m = await cur(); const e1 = m.ev[m.ev.length - 1];
  console.log(`[${name}:P1] clock ${await txt('#clkT')} pill=[${await txt('#phBtn')}] corner p=${e1.p} t=${e1.t} ${ok(e1.p === 1 && e1.t >= 2785, 'stoppage corner stays in the first half')} | toast=${await toast()}`);
  await page.screenshot({ path: `${out}/${name}_p1_stoppage.png` });
  await page.click('#phBtn'); await pause();
  m = await cur();
  console.log(`[${name}:P2] ${ok(m.tm.ht === 1 && m.pe[1] >= 2790, 'half time, first half ' + m.pe[1] + ' s')} pill=[${await txt('#phBtn')}] toast=${await toast()}`);
  await page.click('#toastUndo'); await pause();
  m = await cur();
  console.log(`[${name}:P3] undo: ${ok(m.tm.ht === 0 && m.tm.r === 1, 'back to the first half, clock running')} ${await txt('#clkT')}`);
  await page.clock.runFor(30000); await page.click('#phBtn'); await pause();
  await page.screenshot({ path: `${out}/${name}_p2_halftime.png` });
  await page.clock.runFor(15 * 60000);
  await page.click('#phBtn'); await pause();
  m = await cur();
  console.log(`[${name}:P4] ${ok(m.tm.p === 2 && !m.tm.ht && (await txt('#clkT')).startsWith('45:0'), 'second half from 45:00')} pill=[${await txt('#phBtn')}] toast=${await toast()}`);
  await tap(1, 'ck'); await pause();
  m = await cur();
  console.log(`[${name}:P5] second-half corner p=${m.ev[m.ev.length - 1].p} t=${m.ev[m.ev.length - 1].t}`);
  await page.clock.runFor(47 * 60000); await pause();
  await page.click('#phBtn'); await pause(300);
  console.log(`[${name}:P6] 全场结束 → ${ok((await sheet()) === '结束这场', 'finish sheet')}`);
  await page.click('#card [data-a="close"]'); await pause();
  // clock sheet carries the same button
  await page.click('#clkBtn'); await pause();
  console.log(`[${name}:P7] clock sheet phase button=[${await txt('#card .bigp[data-a="finish"]')}] kick buttons=${await page.locator('#card [data-a="kick"]').count()}`);
  await page.screenshot({ path: `${out}/${name}_p3_clocksheet.png` });
  await page.click('#card [data-a="close"]');

  // ---------- R. pause in stoppage, resume ----------
  await page.click('#qbMore'); await page.locator('#card [data-a="new"]').click(); await pause(300);
  if (await page.$('#card [data-a="nq3"]')) await page.click('#card [data-a="nq3"]');
  await page.fill('#fH', '鹿岛鹿角'); await page.fill('#fA', '浦和红钻');
  if (isPhone) await page.evaluate(() => localStorage.setItem('corner-sb-pip', JSON.stringify({ pos: 'top', h: 165 })));
  if (isPhone){ await page.reload(); await page.waitForSelector('#pred', { state: 'attached' }); await pause(300); }
  await page.click('#hud [data-pa="kick1"]').catch(async () => { await page.click('#runBtn'); });
  await page.clock.runFor(47 * 60000); await pause();
  await tap(0, 'f3');
  if (isPhone){
    // video-window mode: header is hidden, the score cell opens the clock page; pause there
    await page.click('#hud [data-pa="clock"]'); await pause(); await page.click('#card [data-a="toggle"]'); await page.click('#card [data-a="close"]'); await pause();
    console.log(`[${name}:R1] PiP cell after pause: ${await txt('#hud .hud-s')}`);
    await page.screenshot({ path: `${out}/${name}_r1_pipcell.png` });
    await page.clock.runFor(16 * 60000);
    await page.click('#hud [data-pa="resume"]'); await pause();
  } else {
    await page.click('#runBtn'); await pause();
    console.log(`[${name}:R1] pause toast=${await toast()}`);
    await page.clock.runFor(16 * 60000);
    await page.click('#runBtn'); await pause();
  }
  console.log(`[${name}:R2] ${ok((await sheet()) === '继续计时', 'resume asks')} | ${(await txt('#card')).slice(0, 120)}`);
  await page.screenshot({ path: `${out}/${name}_r2_resume.png` });
  await page.click('#card [data-a="rkick2"]'); await pause();
  m = await cur();
  console.log(`[${name}:R3] ${ok(m.tm.p === 2 && m.tm.r === 1 && m.pe[1] >= 2820, 'second half from 45:00, first half ended ' + m.pe[1])} clock=${await txt(isPhone ? '#hudClk' : '#clkT')}`);
  if (isPhone){ await page.evaluate(() => localStorage.setItem('corner-sb-pip', JSON.stringify({ pos: 'off', h: 165 }))); await page.reload(); await page.waitForSelector('#pred', { state: 'attached' }); await pause(300); }

  // ---------- A. auto-bet ----------
  await page.click('#qbMore'); await page.locator('#card [data-a="new"]').click(); await pause(300);
  if (await page.$('#card [data-a="nq3"]')) await page.click('#card [data-a="nq3"]');
  await page.fill('#fH', '川崎前锋'); await page.fill('#fA', '大阪钢巴');
  await page.click('#runBtn'); await page.clock.runFor(60000);
  for (let k = 0; k < 6; k++){ await tap(0, 'f3'); await tap(0, 'bx'); await page.clock.runFor(20000); }
  await page.openMid('ab');
  await page.click('#ab [data-ab="hold"][data-v="trend"]'); await page.click('#ab [data-ab="warm"][data-v="0"]'); await pause();
  console.log(`[${name}:A1] settings: ${(await txt('#ab')).slice(0, 220)}`);
  await page.screenshot({ path: `${out}/${name}_a1_settings.png` });
  await page.click('#ab [data-ab="on"]'); await pause();
  await page.closeMid();
  m = await cur();
  console.log(`[${name}:A2] on=${JSON.stringify(m.ab.on)} ab=${await page.evaluate(() => localStorage.getItem('corner-sb-ab'))}`);
  await page.clock.runFor(30000); await pause();
  await page.openMid('ab');
  console.log(`[${name}:A3] ${ok(!/记录满 5 分钟后才开始计算（还差/.test(await txt('#ab')), 'no warm-up wait')} | ${(await txt('#ab')).slice(0, 120)}`);
  await page.closeMid();
  while (await secs() < 40 * 60 + 20){ await page.clock.runFor(60000); if (Math.random() < 0.5) await tap(1, 'f3'); }
  await page.clock.runFor(15000); await pause(300);
  m = await cur();
  console.log(`[${name}:A4] at ${await txt('#clkT')} ${ok(m.ab.on === null, 'first-half market stopped at 40:00')} toast=${await toast()}`);
  await page.click('#pred [data-pa="scope"][data-v="f"]'); await pause();
  await page.openMid('ab');
  console.log(`[${name}:A5] full-match start enabled=${!(await page.$eval('#ab [data-ab="on"]', b => b.disabled))}`);
  await page.click('#ab [data-ab="on"]'); await pause();
  await page.closeMid();
  await page.clock.runFor(4 * 60000); await pause(300);
  m = await cur();
  console.log(`[${name}:A6] at ${await txt('#clkT')} ${ok(m.ab.on && m.ab.on.mt === 'ft', 'full-match market still on after 40:00')}`);
  await page.click('#phBtn'); await page.clock.runFor(10 * 60000); await pause(300);
  m = await cur();
  console.log(`[${name}:A7] half time ${ok(m.ab.on && m.ab.on.mt === 'ft', 'still on at half time')}`);
  await page.click('#phBtn'); await pause();
  while (await secs() < 85 * 60 + 10){ await page.clock.runFor(60000); if (Math.random() < 0.3) await tap(0, 'cf'); }
  await page.clock.runFor(15000); await pause(300);
  m = await cur();
  console.log(`[${name}:A8] at ${await txt('#clkT')} ${ok(m.ab.on === null, 'full-match market stopped at 85:00')} toast=${await toast()}`);
  const rule = b => b.mk === 'ou' ? (b.sd === 'u' ? 60 : 180) : (() => { const sl = b.sd === 'h' ? b.ln : -b.ln; return sl > 0 ? 60 : sl < 0 ? 180 : 120; })();
  const bad = m.ab.bets.filter(b => b.hm !== 't' || b.hold !== rule(b));
  console.log(`[${name}:A9] bets=${m.ab.bets.length} ${ok(m.ab.bets.length > 0 && !bad.length, 'every bet held for the trend time of its side')} ${m.ab.bets.map(b => `${b.mt}/${b.mk}/${b.sd}/${b.ln}:${b.hold}`).join(' ')}`);
  await page.openMid('ab'); await page.click('#ab [data-ab="stats"]'); await pause(300);
  const pressed = await page.$eval('#card [data-a="abhold"][data-v="trend"]', b => b.getAttribute('aria-pressed'));
  await page.click('#card [data-a="abwarm"][data-v="1"]'); await pause();
  console.log(`[${name}:A10] warehouse settings trend pressed=${pressed} warm back on=${await page.evaluate(() => JSON.parse(localStorage.getItem('corner-sb-ab')).warm)}`);
  await page.click('#card [data-a="close"]');

  // ---------- B. team averages from a thin book ----------
  await page.click('#qbMore'); await page.locator('#card [data-a="new"]').click(); await pause(300);
  if (await page.$('#card [data-a="nq3"]')) await page.click('#card [data-a="nq3"]');
  await page.fill('#fLg', '意甲'); await page.fill('#fH', '尤文'); await page.fill('#fA', '科莫'); await pause(300);
  await page.click('#qbMore'); await page.locator('#card [data-a="expc"]').click(); await pause(400);
  const bk = await txt('#card');
  console.log(`[${name}:B1] sheet: ${(/2\. 两队最近的比赛.*?(?=3\.)/.exec(bk) || [''])[0].slice(0, 400)}`);
  await page.screenshot({ path: `${out}/${name}_b1_expc.png` });
  const hasOwn = await page.evaluate(() => !!JSON.parse(localStorage.getItem('corner-sb-book')).fx.wold1);
  await page.click('#card [data-a="xbook"]'); await pause(300);
  m = await cur();
  console.log(`[${name}:B2] own match in book=${hasOwn} exp=${m.exp} expIn=${JSON.stringify(m.expIn)} src=${m.expSrc} ${ok(m.exp > 9 && m.exp < 12 && m.expIn && m.expIn[0] < 7, 'one match each, pulled toward the league average')}`);

  // ---------- C. linked: line sets the total, book splits it ----------
  await page.click('#qbMore'); await page.locator('#card [data-a="new"]').click(); await pause(300);
  if (await page.$('#card [data-a="nq3"]')) await page.click('#card [data-a="nq3"]');
  await page.evaluate(() => localStorage.setItem('corner-sb-net', JSON.stringify({ key: 'K', auto: true, iv: 0, shots: true })));
  await page.reload(); await page.waitForSelector('#pred', { state: 'attached' }); await pause(300);
  await page.fill('#fH', '利物浦'); await page.fill('#fA', '黄潜');
  await page.clock.runFor(3000); await pause(700);
  m = await cur();
  console.log(`[${name}:C1] linked=${!!(m.api && m.api.id)} toast=${await toast()}`);
  if (await page.$('#toastUndo:visible') && /查赛前预期/.test(await txt('#toastUndo'))) await page.click('#toastUndo');
  else await page.click('#pred [data-pa="expauto"]');
  await pause(800);
  m = await cur();
  console.log(`[${name}:C2] exp=${m.exp} expIn=${JSON.stringify(m.expIn)} src=${m.expSrc} toast=${await toast()} ${ok(m.exp > 9.4 && m.exp < 10.4 && Array.isArray(m.expIn) && /两队按本机资料分/.test(m.expSrc || ''), 'line total + team split')}`);
  const share = m.expIn ? ((m.expIn[0] + m.expIn[3]) / 2) / ((m.expIn[0] + m.expIn[3]) / 2 + (m.expIn[2] + m.expIn[1]) / 2) : 0;
  console.log(`[${name}:C3] home share ${share.toFixed(3)} ${ok(share > 0.5, 'Liverpool gets the bigger share')}`);
  console.log(`[${name}:C4] model shareSd=${await page.evaluate(() => MODEL.shareSd).catch(() => 'n/a')}`);
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
