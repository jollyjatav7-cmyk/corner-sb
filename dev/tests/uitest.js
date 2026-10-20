// Headless walk-through of a full match in the new app.
// Usage: node uitest.js <base_url> <out_dir>
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
  await page.waitForSelector('#pred .pv');
  const txt = async sel => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
  const log = async label => console.log(`[${name}:${label}] ${(await txt('#pred')).slice(0, 150)}`);
  await log('prematch');
  await page.screenshot({ path: `${out}/${name}_0_empty.png` });

  await page.fill('#fH', '曼城'); await page.fill('#fA', '阿森納'); await page.fill('#fLg', '英超');
  await page.click('#runBtn');
  const tap = async (i, c, n = 1) => {
    for (let k = 0; k < n; k++){
      const b = page.locator(`.pad[data-i="${i}"] [data-c="${c}"]:visible`).first();
      await b.click(); await page.clock.runFor(15000);
    }
  };
  // first 25 minutes: home dominant
  await page.clock.runFor(60000);
  await tap(0, 'f3', 10); await tap(0, 'bx', 4); await tap(0, 'co', 2); await tap(0, 'cf', 3);
  await tap(0, 'sb', 2); await tap(0, 'ck', 2); await tap(1, 'f3', 4); await tap(1, 'bx', 1); await tap(1, 'ss', 1);
  await page.clock.runFor(8 * 60000);
  await tap(1, 'sg', 1);
  await page.clock.runFor(60000);
  await log('min21');
  await page.screenshot({ path: `${out}/${name}_1_live.png` });
  // undo via strip button, then re-add
  await page.click('#undoBtn'); await tap(0, 'ck', 1);
  // pred controls
  await page.click('#pred [data-pa="line"][data-d="1"]');
  await page.click('#pred [data-pa="exp"][data-d="0.5"]');
  await page.click('#pred [data-pa="add"][data-d="1"]');
  await log('controls');
  // red card for away
  await tap(1, 'rc', 1);
  await log('red');
  // end first half via clock sheet
  await page.clock.runFor(20 * 60000);
  await page.click('#clkBtn'); await page.click('[data-a="endh"]'); await page.click('[data-a="close"]');
  await log('halftime');
  await page.screenshot({ path: `${out}/${name}_2_halftime.png` });
  // second half
  await page.click('#runBtn');
  await page.clock.runFor(10 * 60000);
  await tap(0, 'f3', 5); await tap(0, 'bx', 2); await tap(0, 'ck', 1);
  await log('h2min11');
  // edit an event from the list
  await page.click('#listBtn'); await page.locator('#card [data-a="edit"]').first().click();
  await page.click('#card [data-a="etime"][data-d="-10"]'); await page.click('#card [data-a="eteam"][data-i="1"]');
  await page.screenshot({ path: `${out}/${name}_3_edit.png` });
  await page.click('#card [data-a="close"]');
  // definitions and model sheets
  if (vp.width < 600){ await page.click('#menuBtn'); await page.click('#card [data-a="defs"]'); } else await page.click('#defBtn');
  await page.screenshot({ path: `${out}/${name}_4_defs.png` }); await page.click('#card [data-a="close"]');
  // export
  await page.click('#menuBtn'); await page.click('#card [data-a="exp1"]');
  const exp = await page.inputValue('#expText');
  const o = JSON.parse(exp);
  console.log(`[${name}:export] matches=${o.matches.length} events=${o.matches[0].ev.length} first=${JSON.stringify(o.matches[0].ev[0])}`);
  await page.click('#card [data-a="close"]');
  // finish match, start a new one, reload persists
  await page.click('#menuBtn'); await page.click('#card [data-a="finish"]');
  await page.reload(); await page.waitForSelector('#pred');
  console.log(`[${name}:reload] ${(await txt('#pred')).slice(0, 60)} | header ${(await txt('.score'))}`);
  await page.click('#menuBtn'); await page.click('#card [data-a="new"]');
  await page.waitForSelector('#pred .pv');
  console.log(`[${name}:new] ${(await txt('#pred')).slice(0, 80)}`);
  await page.click('#menuBtn'); await page.click('#card [data-a="arch"]');
  await page.screenshot({ path: `${out}/${name}_5_archive.png` });
  console.log(`[${name}] ERRORS: ${errors.length ? errors.join('\n') : 'none'}`);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await run(browser, 'ipad', { width: 1180, height: 820 });
  await run(browser, 'portrait', { width: 820, height: 1180 });
  await run(browser, 'phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
