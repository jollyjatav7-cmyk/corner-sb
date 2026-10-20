// Walk-through of the v2 features: mid-match join, backfill, handicap, end recording mid-match.
// Usage: node uitest2.js <base_url> <out_dir>
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
  await page.waitForSelector('#pred .start');
  const txt = async sel => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
  await page.screenshot({ path: `${out}/${name}_0_start.png` });
  await page.fill('#fH', '利物浦'); await page.fill('#fA', '切尔西');

  // join at 67:30, score 1-0, second-half corners 2-1, no reds
  await page.click('#pred [data-pa="join"]');
  const slide = async v => page.$eval('#tpR', (el, x) => { el.value = x; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  await page.click('#card [data-a="tpp"][data-p="2"]'); await slide(67 * 60); await page.click('#card [data-a="tpn"][data-d="30"]');
  for (const [f, i, n] of [['sc', 0, 1], ['ft', 0, 2], ['ft', 1, 1]]) for (let k = 0; k < n; k++) await page.click(`#card [data-a="js"][data-f="${f}"][data-i="${i}"][data-d="1"]`);
  await page.click('#card [data-a="jlk"]'); await page.click('#card [data-a="js"][data-f="ck1"][data-i="0"][data-d="-1"]'); await page.click('#card [data-a="js"][data-f="ck1"][data-i="0"][data-d="-1"]'); await page.click('#card [data-a="js"][data-f="ck1"][data-i="1"][data-d="-1"]');
  await page.screenshot({ path: `${out}/${name}_1_join.png` });
  await page.click('#card [data-a="jgo"]');
  console.log(`[${name}:joined] clock ${await txt('#clkT')} | score ${await txt('#glH')}-${await txt('#glA')} | ${(await txt('#pred')).slice(0, 110)}`);
  console.log(`[${name}:counts] ${(await txt('#counts')).slice(0, 80)}`);

  // 6 minutes of play, away pressing
  const tap = async (i, c, n = 1) => { for (let k = 0; k < n; k++){ await page.locator(`.pad[data-i="${i}"] [data-c="${c}"]:visible`).first().click(); await page.clock.runFor(20000); } };
  await tap(1, 'f3', 6); await tap(1, 'bx', 3); await tap(1, 'co', 2); await tap(1, 'ck', 1); await tap(0, 'f3', 2);
  console.log(`[${name}:play] ${(await txt('#pred')).slice(0, 220)}`);
  // handicap: home gives 1.5
  await page.click('#pred [data-pa="hd"][data-d="-0.5"]'); await page.click('#pred [data-pa="hd"][data-d="-0.5"]');
  const hc = await txt('#pred .hcr'); const tm = await txt('#pred .teams');
  console.log(`[${name}:hcap] ${hc} | ${tm}`);
  await page.screenshot({ path: `${out}/${name}_2_live.png` });
  // fix corners later (correct score to 1-1)
  await page.click('#menuBtn'); await page.click('#card [data-a="join"]');
  await page.click('#card [data-a="js"][data-f="sc"][data-i="1"][data-d="1"]'); await page.click('#card [data-a="jgo"]');
  console.log(`[${name}:fix] score ${await txt('#glH')}-${await txt('#glA')} | events ${(await page.$$eval('#recent button', b => b.length))}`);
  // clock entry with 45+2 style in clock sheet
  await page.click('#clkBtn'); await slide(92 * 60); await page.click('#card [data-a="tpset"]');
  console.log(`[${name}:clock] ${await txt('#clkT')} ${await txt('#perL')}`);
  // end recording from clock sheet
  await page.click('#card [data-a="finish"]');
  console.log(`[${name}:end] ${await txt('#pred')} | ${await txt('#mDate')}`);
  // export contains obs/stop/backfill
  await page.click('#menuBtn'); await page.click('#card [data-a="exp1"]');
  const o = JSON.parse(await page.inputValue('#expText'));
  const m = o.matches[0];
  console.log(`[${name}:export] obs=${JSON.stringify(m.obs)} stop=${JSON.stringify(m.stop)} hd=${JSON.stringify(m.hd)} backfilled=${m.ev.filter(e => e[4] === 1).length} total=${m.ev.length}`);
  await page.click('#card [data-a="close"]');
  // new match after a finished partial match: history must not break
  await page.click('#menuBtn'); await page.click('#card [data-a="new"]');
  await page.waitForSelector('#pred .start');
  await page.click('#pred [data-pa="kick1"]'); await page.clock.runFor(5 * 60000);
  console.log(`[${name}:next] ${(await txt('#pred')).slice(0, 90)} | counts ${(await txt('#counts')).slice(0, 60)}`);
  console.log(`[${name}] ERRORS: ${errors.length ? errors.join('\n') : 'none'}`);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await run(browser, 'ipad', { width: 1180, height: 820 });
  await run(browser, 'phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
