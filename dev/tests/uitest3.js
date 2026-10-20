// Timeline and end-of-match flow.
// Usage: node uitest3.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const wrap = require('./uihelp.js');

async function run(browser, name, vp, opts){
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: 'block', ...(opts || {}) });
  const page = wrap(await ctx.newPage(), vp.width < 600);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.clock.install({ time: new Date('2026-10-20T11:00:00Z') });
  await page.goto(base + '/index.html');
  await page.waitForSelector('#tl');
  await page.screenshot({ path: `${out}/${name}_t0_empty.png` });
  await page.fill('#fH', '阿森纳'); await page.fill('#fA', '热刺');
  await page.click('#pred [data-pa="kick1"]');
  const tap = async (i, c, n = 1, gap = 25000) => { for (let k = 0; k < n; k++){ await page.locator(`.pad[data-i="${i}"] [data-c="${c}"]:visible`).first().click(); await page.clock.runFor(gap); } };
  // a rhythm: home pressure early, away comeback later
  await tap(0, 'f3', 6); await tap(0, 'bx', 3); await tap(0, 'co', 1); await tap(0, 'cf', 2); await tap(0, 'sb', 1); await tap(0, 'ck', 2);
  await tap(1, 'f3', 3); await tap(1, 'cf', 1);
  await tap(0, 'ss', 1); await tap(0, 'sg', 1);
  await page.clock.runFor(6 * 60000);
  await tap(1, 'f3', 7); await tap(1, 'bx', 3); await tap(1, 'so', 1); await tap(1, 'ck', 1); await tap(0, 'rc', 1); await tap(1, 'co', 2);
  await page.clock.runFor(10000);
  await page.screenshot({ path: `${out}/${name}_t1_timeline.png` });
  const tlBox = await page.$('#tlSec'); await tlBox.screenshot({ path: `${out}/${name}_t2_tlonly.png` });
  // zoom in, then tap a head to open edit
  const phone = vp.width < 600;
  if (!phone){
    await page.click('#zIn'); await page.click('#zIn');
    console.log(`[${name}:zoom] ${await page.textContent('#zLabel')}`);
    await page.click('#zAll');
  } else {
    const slim = await page.$$eval('#tl .sm', a => a.length);
    await page.click('#tlMore'); const full = await page.$$eval('#tl .sm', a => a.length);
    console.log(`[${name}:slim] marks slim=${slim} full=${full} button=${await page.textContent('#tlMore')}`);
    await page.click('#tlMore');
  }
  const head = await page.evaluate(() => { const svg = document.querySelector('#tl'); const r = svg.getBoundingClientRect(); const c = svg.querySelector('.fl'); if (!c) return null; const b = c.getBoundingClientRect(); return { x: b.left + 2, y: b.top + b.height / 2 }; });
  if (head){ await page.mouse.click(head.x, head.y); await page.waitForTimeout(200); console.log(`[${name}:taphead] sheet=${await page.$eval('#sheet', e => !e.hidden)} ${(await page.textContent('#card')).slice(0, 30)}`); await page.click('#card [data-a="close"]'); }
  // toggles
  let curves = '-', curves2 = await page.$$eval('#tl .mo', a => a.length);
  if (!phone){ await page.click('#curveBtn'); curves = await page.$$eval('#tl .mo', a => a.length); await page.click('#curveBtn'); curves2 = await page.$$eval('#tl .mo', a => a.length); }
  await page.click('#tlFold'); const folded = await page.$eval('#tlWrap', e => getComputedStyle(e).display); await page.click('#tlFold');
  console.log(`[${name}:toggles] curves off=${curves} on=${curves2} folded display=${folded}`);
  // end mid-match, then tap a pad → toast offers new match; use the panel button
  await page.click('#clkBtn'); await page.click('#card [data-a="finish"]');
  await page.locator('.pad[data-i="0"] [data-c="f3"]:visible').first().click();
  console.log(`[${name}:toast] ${await page.textContent('#toast')}`);
  await page.screenshot({ path: `${out}/${name}_t3_ended.png` });
  await page.click('#pred [data-pa="new"]');
  console.log(`[${name}:new] start=${!!(await page.$('#pred .start'))} score=${await page.textContent('#glH')}-${await page.textContent('#glA')} tlEvents=${await page.$$eval('#tl .sm', a => a.length)}`);
  console.log(`[${name}] ERRORS: ${errors.length ? errors.join('\n') : 'none'}`);
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch();
  await run(browser, 'ipad', { width: 1180, height: 820 });
  await run(browser, 'phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
