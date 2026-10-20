// v15: "my bets" - a real bet recorded with the corner score at the time of the bet, live win chance.
// Usage: node uitest9.js <base_url> <out_dir>
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
  const ck = async i => { await page.locator(`.pad[data-i="${i}"] [data-c="ck"]:visible`).first().click(); await pause(150); };
  await page.fill('#fH', '主队甲'); await page.fill('#fA', '客队乙');
  await page.click('#pred [data-pa="kick1"]');
  await page.clock.runFor(8 * 60000); await ck(0); await page.clock.runFor(4 * 60000); await ck(1);
  await page.clock.runFor(3 * 60000);
  // the bet was placed at 1:1 (home -0.5, first half); then the home team wins another corner -> 2:1
  await ck(0); await page.clock.runFor(60000);
  await page.click('#pred [data-pa="mybet"]'); await pause(300);
  console.log(`[${name}:form] ${(await txt('#card .mbl')).slice(0, 40)} | ${(await txt('#card .netnote')).slice(0, 90)}`);
  await page.click('#card [data-a="mbsc"][data-i="0"][data-d="-1"]'); await pause(150);   // 2:1 -> 1:1 at the time of the bet
  console.log(`[${name}:form-1:1] ${(await txt('#card .netnote')).slice(0, 110)}`);
  await page.screenshot({ path: `${out}/${name}_g1_form.png` });
  await page.click('#card [data-a="mbgo"]'); await pause(300);
  console.log(`[${name}:saved] toast=${await txt('#toastMsg')}`);
  await page.openMid('pred');
  console.log(`[${name}:card] ${(await txt('#pred .myb')).slice(0, 160)}`);
  await page.screenshot({ path: `${out}/${name}_g2_card.png` });
  await page.closeMid();
  if (vp.width < 600) console.log(`[${name}:hud] ${await txt('#hud')}`);
  // a quarter line and an over/under bet
  await page.click('#pred [data-pa="mybet"]'); await pause(200);
  await page.click('#card [data-a="mbl"][data-d="-0.25"]'); await pause(100);
  await page.click('#card [data-a="mbgo"]'); await pause(200);
  await page.click('#pred [data-pa="mybet"]'); await pause(200);
  await page.click('#card [data-a="mbk"][data-v="ou"]'); await pause(100);
  await page.click('#card [data-a="mbgo"]'); await pause(200);
  await page.openMid('pred');
  console.log(`[${name}:three] ${(await page.locator('#pred .myr').allInnerTexts()).map(t => t.replace(/\s+/g, ' ')).join(' || ').slice(0, 400)}`);
  await page.closeMid();
  // half-time: the first-half bets are decided
  await page.click('#clkBtn'); await page.click('#card [data-a="endh"]'); await pause(200); await page.click('#card [data-a="close"]');
  await page.openMid('pred');
  console.log(`[${name}:ht] ${(await page.locator('#pred .myr').allInnerTexts()).map(t => t.replace(/\s+/g, ' ')).join(' || ').slice(0, 400)}`);
  await page.click('#pred [data-pa="mydel"]'); await pause(200);
  console.log(`[${name}:deleted] rows=${await page.locator('#pred .myr').count()} toast=${await txt('#toastMsg')}`);
  console.log(`[${name}] ERRORS: ${errors.length ? errors.join('\n') : 'none'}`);
  await ctx.close();
}
(async () => {
  const b = await chromium.launch();
  await run(b, 'ipad', { width: 1180, height: 820 });
  await run(b, 'phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  await b.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
