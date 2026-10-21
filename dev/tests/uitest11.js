// v17: "拆开看" - each team's corner pace split into base × mood (score, red cards) × this match's attacks, plus box→corner conversion.
// Usage: node uitest11.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const wrap = require('./uihelp.js');
async function run(browser, name, vp, opts){
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: 'block', ...(opts || {}) });
  const page = wrap(await ctx.newPage(), vp.width < 600);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.clock.install({ time: new Date('2026-10-20T19:00:00Z') });
  await page.goto(base + '/index.html'); await page.waitForSelector('#pred .start');
  const txt = async sel => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
  const pause = ms => page.waitForTimeout(ms || 250);
  const tap = async (i, c, n = 1) => { for (let k = 0; k < n; k++){ await page.locator(`.pad[data-i="${i}"] [data-c="${c}"]:visible`).first().click(); await pause(60); } };
  await page.fill('#fH', '萨巴赫'); await page.fill('#fA', '多特蒙德');
  await page.click('#pred [data-pa="exp"][data-d="0.5"]'); await pause(100);      // 全场预期 10.5
  await page.click('#pred [data-pa="kick1"]');
  // 0-10': both attack; 10' away goal; then the home side presses (many entries) but the away side wins the corners
  await page.clock.runFor(5 * 60000); await tap(1, 'f3', 3); await tap(1, 'bx', 2); await tap(0, 'f3', 2);
  await page.clock.runFor(5 * 60000); await tap(1, 'sg');
  await page.clock.runFor(10 * 60000); await tap(0, 'f3', 8); await tap(0, 'bx', 5); await tap(0, 'cf', 3); await tap(1, 'ck', 2);
  await page.clock.runFor(10 * 60000); await tap(0, 'f3', 5); await tap(0, 'bx', 3); await tap(1, 'f3', 3); await tap(1, 'bx', 2); await tap(0, 'ck');
  await page.clock.runFor(2 * 60000);
  await page.openMid('pred');
  console.log(`[${name}:closed] why rows=${await page.locator('#pred .why').count()} btn=${await txt('#pred [data-pa="why"]')}`);
  await page.click('#pred [data-pa="why"]'); await pause(200);
  await page.openMid('pred');
  const rows = await page.locator('#pred .why .wr').allInnerTexts();
  console.log(`[${name}:open] ${rows.map(t => t.replace(/\s+/g, ' ')).join(' | ')}`);
  // base × mood × attacks shown = pace shown (within rounding); pace × minutes left = "比分不变"
  const num = async (k) => (await page.locator('#pred .why .wr').nth(k).locator('b').allInnerTexts()).map(t => parseFloat(t.replace(/^[×=\s]+/, '')));
  const [b, m, a, n, left] = [await num(1), await num(2), await num(3), await num(4), await num(5)];
  const mins = parseFloat((await page.locator('#pred .why .wr').nth(5).locator('span').innerText()).match(/约 (\d+)/)[1]);
  const flat = (await page.locator('#pred .why .wr').nth(5).locator('b small').allInnerTexts()).map(t => parseFloat(t.match(/约 ([\d.]+)/)[1]));
  console.log(`[${name}:check] product ${[0, 1].map(i => (b[i] * m[i] * a[i]).toFixed(3) + ' vs ' + n[i]).join(', ')} | flat ${[0, 1].map(i => (n[i] / 10 * mins).toFixed(2) + ' vs ' + flat[i]).join(', ')} | sim ${left.join(', ')}`);
  await page.locator('#pred .why').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}_w1_why.png` });
  // red card for the away side: mood row changes for both teams
  await page.closeMid(); await tap(1, 'rc'); await pause(200);
  await page.openMid('pred');
  console.log(`[${name}:red] ${(await page.locator('#pred .why .wr').nth(2).innerText()).replace(/\s+/g, ' ')}`);
  // stays open after reload (remembered), and the 全场 scope works
  await page.closeMid(); await page.reload(); await page.waitForSelector('#pred .why', { state: 'attached' });
  await page.click('#pred [data-pa="scope"][data-v="f"]'); await pause(200);
  await page.openMid('pred');
  console.log(`[${name}:reload+ft] open=${await page.locator('#pred .why').count()} ${(await page.locator('#pred .why .wr').nth(4).innerText()).replace(/\s+/g, ' ')}`);
  await page.locator('#pred .why').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}_w2_ft.png` });
  console.log(`[${name}] ERRORS: ${errors.length ? errors.join('\n') : 'none'}`);
  await ctx.close();
}
(async () => {
  const b = await chromium.launch();
  await run(b, 'ipad', { width: 1180, height: 820 });
  await run(b, 'ipadP', { width: 820, height: 1180 });
  await run(b, 'phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  await run(b, 'se', { width: 375, height: 667 }, { isMobile: true, hasTouch: true });
  await b.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
