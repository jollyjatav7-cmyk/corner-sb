// Screenshots of the one-tap pre-match expectation button (phone and iPad), API mocked like uitest8.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const T0 = Date.parse('2026-10-20T19:30:00Z') / 1000;
const T = { 40: 'Liverpool', 533: 'Villarreal' };
const FX = { 4001: { h: 40, a: 533, st: 'NS', ts: T0 + 1800 } };
const RECENT = {};
for (let k = 0; k < 10; k++){ RECENT[3001 + k] = { team: 40, for: [5, 7][k % 2], ag: [3, 5][k % 2] }; RECENT[3011 + k] = { team: 533, for: [4, 6][k % 2], ag: [5, 5][k % 2] }; }
const fx = id => { const x = FX[id]; return { fixture: { id, date: new Date(x.ts * 1000).toISOString(), timestamp: x.ts, periods: { first: null, second: null }, status: { short: x.st, elapsed: null } }, league: { name: 'UEFA Champions League' }, teams: { home: { id: x.h, name: T[x.h] }, away: { id: x.a, name: T[x.a] } }, goals: { home: null, away: null }, statistics: [], events: [] }; };
const rf = id => { const r = RECENT[id], o = 9000 + id; return { fixture: { id, timestamp: T0 - 86400 * (id % 100), status: { short: 'FT' } }, teams: { home: { id: r.team }, away: { id: o } }, goals: { home: 1, away: 0 }, statistics: [{ team: { id: r.team }, statistics: [{ type: 'Corner Kicks', value: r.for }] }, { team: { id: o }, statistics: [{ type: 'Corner Kicks', value: r.ag }] }] }; };
async function mock(ctx){
  await ctx.route('https://www.wikidata.org/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"search":[]}' }));
  await ctx.route('https://v3.football.api-sports.io/**', async route => {
    const req = route.request(), u = new URL(req.url()), q = k => u.searchParams.get(k);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let resp = [];
    if (u.pathname === '/status') resp = { subscription: { plan: 'Free', active: true }, requests: { current: 3, limit_day: 100 } };
    else if (q('live')) resp = [];
    else if (q('date')) resp = [fx(4001)];
    else if (q('id')) resp = [fx(+q('id'))];
    else if (q('team')) resp = Object.keys(RECENT).filter(k => RECENT[k].team === +q('team')).map(k => rf(+k));
    else if (q('ids')) resp = q('ids').split('-').map(Number).filter(k => RECENT[k]).map(rf);
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ errors: [], response: resp }) });
  });
}
const mark = (page, sel) => page.evaluate(s => { document.querySelectorAll('.zmark').forEach(e => e.classList.remove('zmark'));
  const st = document.getElementById('zst') || Object.assign(document.head.appendChild(document.createElement('style')), { id: 'zst' });
  st.textContent = '.zmark{outline:4px solid #e0263a !important;outline-offset:3px;border-radius:10px}';
  const el = [...document.querySelectorAll(s)].find(e => e.offsetParent); if (el){ el.classList.add('zmark'); el.scrollIntoView({ block: 'center' }); } }, sel);
async function run(browser, name, vp, opts){
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: 'block', ...(opts || {}) });
  await mock(ctx);
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date(T0 * 1000) });
  await page.goto(base + '/index.html'); await page.waitForSelector('#pred .start', { state: 'attached' });
  await page.evaluate(() => localStorage.setItem('corner-sb-net', JSON.stringify({ key: 'K', auto: true, iv: 0, shots: true })));
  await page.reload(); await page.waitForSelector('#pred .start', { state: 'attached' });
  await page.fill('#fH', '利物浦'); await page.fill('#fA', '黄潜');
  await page.clock.runFor(3000); await page.waitForTimeout(800);
  const phone = vp.width < 600;
  const open = async () => { if (phone) await page.evaluate(() => { document.querySelector('#mid').classList.add('open'); document.querySelector('#scrim').hidden = false; }); await page.waitForTimeout(400); };
  // 1. before kick-off: toast with the action + start panel button
  await page.screenshot({ path: `${out}/${name}_x1_toast.png` });
  await open(); await mark(page, '#pred [data-pa="expauto"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}_x2_start.png` });
  // 2. after kick-off: the row on the prediction card
  if (phone) await page.evaluate(() => { document.querySelector('#mid').classList.remove('open'); document.querySelector('#scrim').hidden = true; });
  await page.click(phone ? '#hud [data-pa="kick1"]' : '#pred [data-pa="kick1"]'); await page.clock.runFor(60000); await page.waitForTimeout(300);
  await open(); await mark(page, '#pred .exr'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}_x3_card.png` });
  // 3. after one tap
  await page.click('#pred .exr'); await page.waitForTimeout(1200); await mark(page, '#pred .exr'); await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${name}_x4_done.png` });
  await ctx.close();
}
(async () => {
  const b = await chromium.launch();
  await run(b, 'phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  await run(b, 'ipad', { width: 1180, height: 820 });
  await b.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
