// v18: the pre-match expectation from 查／算 (two teams' averages) is split between the teams; a bare total is not.
// Usage: node uitest12.js <base_url> <out_dir>
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
  const rowsTxt = async () => (await page.locator('#pred .why .wr').allInnerTexts()).map(t => t.replace(/\s+/g, ' '));
  const teams = async () => (await txt('#pred .teams.tms'));
  await page.fill('#fH', '萨巴赫'); await page.fill('#fA', '多特蒙德');
  // A. bare total typed with −／＋ (like a bookmaker line): no split
  await page.click('#pred [data-pa="exp"][data-d="0.5"]'); await pause(100);
  await page.click('#pred [data-pa="kick1"]'); await page.clock.runFor(60000);
  await page.click('#pred [data-pa="why"]'); await pause(150);
  await page.openMid('pred');
  let r = await rowsTxt();
  console.log(`[${name}:total-only] ${r[1]} || teams ${await teams()}`);
  await page.closeMid();
  // B. 查／算 with the two teams' averages: Sabah wins 3.0 concedes 6.0, Dortmund wins 6.5 concedes 3.5
  await page.click('#pred [data-pa="expc"]'); await pause(250);
  for (const [x, v] of [[0, 3.0], [1, 6.0], [2, 6.5], [3, 3.5]])
    await page.evaluate(([x, v]) => { const el = document.querySelector(`#card input[data-x="${x}"]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [x, v]);
  console.log(`[${name}:sheet] ${await txt('#card .xres')}`);
  await page.screenshot({ path: `${out}/${name}_s1_sheet.png` });
  await page.click('#card [data-a="xuse"]'); await pause(250);
  await page.openMid('pred');
  r = await rowsTxt();
  console.log(`[${name}:split] ${r[1]} || teams ${await teams()} || hcap ${await txt('#pred .hcr')}`);
  await page.locator('#pred .why').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}_s2_split.png` });
  await page.closeMid();
  // C. total changed with −／＋ afterwards: split kept, total follows
  await page.click('#pred [data-pa="exp"][data-d="0.5"]'); await pause(150);
  await page.openMid('pred');
  console.log(`[${name}:total+0.5] ${(await rowsTxt())[1]}`);
  // D. export carries expIn; clearing the expectation drops the split
  const exp = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('corner-sb-matches') || '{}'); const m = Object.values(s).sort((a, b) => b.u - a.u)[0]; return [m.exp, m.expIn]; });
  console.log(`[${name}:stored] exp=${exp[0]} expIn=${JSON.stringify(exp[1])}`);
  await page.closeMid();
  await page.click('#pred [data-pa="exp0"]'); await pause(150);
  await page.openMid('pred');
  console.log(`[${name}:cleared] ${(await rowsTxt())[1]} || teams ${await teams()}`);
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
