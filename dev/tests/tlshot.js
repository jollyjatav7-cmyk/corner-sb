// Render the timeline for a realistic synthetic match (events spread over 90').
// Usage: node tlshot.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function match(){
  const r = rng(7), ev = []; let k = 0;
  const add = (p, t, i, c) => ev.push([Math.round(t), p, i, c]);
  // attacking spells: [half, start min, end min, team, intensity]
  const spells = [[1, 2, 9, 0, 1.4], [1, 14, 19, 1, 1.0], [1, 24, 33, 0, 1.8], [1, 38, 45, 1, 0.8], [2, 47, 55, 1, 1.6], [2, 60, 66, 0, 0.9], [2, 72, 84, 0, 2.0], [2, 85, 91, 1, 1.2]];
  for (const [p, a, b, i, w] of spells){
    for (let m = a; m < b; m += 0.5){
      const x = r() * w;
      const t = m * 60 + r() * 30;
      if (x > 0.35) add(p, t, i, 'f3');
      if (x > 0.9) add(p, t + 8, i, 'bx');
      if (x > 1.05) add(p, t + 12, i, r() < 0.45 ? 'co' : 'cf');
      if (x > 1.25) add(p, t + 16, i, ['sb', 'ss', 'so'][Math.floor(r() * 3)]);
      if (x > 1.42) add(p, t + 20, i, 'ck');
      if (r() < 0.25) add(p, t + 3, 1 - i, 'f3');
    }
  }
  add(1, 29 * 60, 0, 'sg'); add(2, 80 * 60, 0, 'sg'); add(2, 52 * 60, 1, 'sg');
  return { id: 'mtl', d: '2026-10-20', lg: '英超', h: '阿森纳', a: '热刺', st: 2, exp: null, line: [4.5, 4.5], hd: [-0.5, -0.5], add: [2, 4], pe: { 1: 2820, 2: 5640 },
    obs: { p: 1, t: 0 }, stop: { p: 2, t: 5640 }, tm: { p: 2, b: 5640, r: 0, at: 0, ht: 0 }, ev: ev.map(x => ({ t: x[0], p: x[1], i: x[2], c: x[3] })) };
}
(async () => {
  const browser = await chromium.launch();
  for (const [name, vp, o] of [['ipad', { width: 1180, height: 820 }, {}], ['phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true }], ['ipadp', { width: 820, height: 1180 }, {}]]){
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: 'block', ...o });
    const page = await ctx.newPage();
    const m = match();
    await page.addInitScript(mm => { localStorage.setItem('corner-sb-matches', JSON.stringify({ mtl: mm })); localStorage.setItem('corner-sb-current', JSON.stringify('mtl')); }, m);
    await page.goto(base + '/index.html'); await page.waitForSelector('#tl .sm', { state: 'attached' });
    await (await page.$('#tlSec')).screenshot({ path: `${out}/${name}_full.png` });
    if (name === 'ipad'){ await page.click('#zIn'); await page.click('#zIn'); await (await page.$('#tlSec')).screenshot({ path: `${out}/${name}_zoom.png` }); await page.click('#zAll'); await page.click('#lgdBtn'); await (await page.$('#tlSec')).screenshot({ path: `${out}/${name}_legend.png` }); }
    console.log(name, 'events', m.ev.length, 'ck', m.ev.filter(e => e.c === 'ck').length);
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
