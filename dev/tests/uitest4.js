// v4: drag-to-set join time, full-match lines in the 2nd half, simulated auto-betting and settlement, timeline prominence.
// Usage: node uitest4.js <base_url> <out_dir>
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
  const tap = async (i, c, n = 1, gap = 20000) => { for (let k = 0; k < n; k++){ await page.locator(`.pad[data-i="${i}"] [data-c="${c}"]:visible`).first().click(); await page.clock.runFor(gap); } };
  const slide = async v => page.$eval('#tpR', (el, x) => { el.value = x; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);

  // ---------- match 1: whole first half, half-time lines, auto-bet, settle at HT ----------
  await page.fill('#fH', '阿森纳'); await page.fill('#fA', '热刺');
  await page.click('#pred [data-pa="kick1"]');
  const scope1 = await page.$eval('#pred .seg [aria-pressed="true"]', e => e.textContent);
  await page.click('#ab [data-ab="hold"][data-v="120"]');
  await page.click('#ab [data-ab="on"]');
  console.log(`[${name}:h1-on] scope=${scope1} | ${(await txt('#ab')).slice(0, 60)}`);
  await tap(0, 'f3', 4); await tap(0, 'bx', 2); await tap(0, 'ck', 1); await tap(1, 'f3', 2);
  await page.clock.runFor(14 * 60000);
  console.log(`[${name}:h1-mid] ${(await txt('#ab')).slice(0, 200)}`);
  await tap(0, 'ck', 2, 30000);
  await page.clock.runFor(20 * 60000);
  const n1 = await page.$$eval('#ab .abt tr', r => r.length);
  console.log(`[${name}:h1-late] bets=${n1} | ${(await txt('#ab .abt')).slice(0, 160)}`);
  await page.screenshot({ path: `${out}/${name}_a1_h1bets.png` });
  // end of first half → toast offers settlement
  await page.click('#clkBtn'); await page.click('#card [data-a="endh"]');
  console.log(`[${name}:ht] toast=${await txt('#toast')}`);
  await page.click('#toastUndo');
  console.log(`[${name}:settle-h1] ${(await txt('#card')).slice(0, 140)}`);
  await page.click('#card [data-a="sgo"]');
  console.log(`[${name}:settled] ${await txt('#toast')} | ab=${(await txt('#ab')).slice(0, 80)}`);
  // second half: default market becomes full-match; auto-bet paused until restarted
  await page.click('#runBtn');
  await page.clock.runFor(30000);
  const scope2 = await page.$eval('#pred .seg [aria-pressed="true"]', e => e.textContent);
  console.log(`[${name}:h2] scope=${scope2} | ${(await txt('#pred .sec-h')).slice(0, 40)} | ${(await txt('#pred .sub2'))} | ab=${(await txt('#ab')).slice(0, 70)}`);
  // pick full-match lines by chips
  const chips = await page.$$eval('#pred .lnr', rs => rs.map(r => [...r.querySelectorAll('.lnv')].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' ')));
  console.log(`[${name}:chips] totals: ${chips[0]} | handicap: ${chips[1]}`);
  await page.openMid();
  await page.locator('#pred .lnr').first().locator('.lnv').last().click();
  await page.locator('#pred .lnr').nth(1).locator('.lnv').first().click();
  await page.closeMid();
  console.log(`[${name}:picked] ${(await txt('#pred .pred-top'))} | ${(await txt('#pred .hcr'))}`);
  await page.click('#ab [data-ab="on"]');
  await tap(1, 'f3', 5); await tap(1, 'co', 2); await tap(1, 'ck', 1);
  await page.clock.runFor(25 * 60000);
  console.log(`[${name}:h2-bets] ${(await txt('#ab')).slice(0, 220)}`);
  // finish → settlement sheet opens automatically, adjust final numbers
  await page.click('#menuBtn'); await page.click('#card [data-a="finish"]');
  const opened = await page.$eval('#sheet', e => !e.hidden) && (await txt('#card')).startsWith('结算');
  await page.click('#card [data-a="ss"][data-f="ft"][data-i="1"][data-d="1"]');
  await page.screenshot({ path: `${out}/${name}_a2_settle.png` });
  await page.click('#card [data-a="sgo"]');
  console.log(`[${name}:final] settleSheetOpened=${opened} ${await txt('#toast')}`);
  await page.click('#toastUndo'); // 看统计
  console.log(`[${name}:stats] ${(await txt('#card')).slice(0, 260)}`);
  await page.screenshot({ path: `${out}/${name}_a3_stats.png` });
  await page.click('#card [data-a="close"]');

  // ---------- match 2: join in the 2nd half with the slider, full-match corners ----------
  await page.click('#pred [data-pa="new"]');
  await page.waitForSelector('#pred .start');
  await page.fill('#fH', '利物浦'); await page.fill('#fA', '切尔西');
  await page.click('#pred [data-pa="join"]');
  await page.click('#card [data-a="tpp"][data-p="2"]');
  await slide(3900 + 7 * 60); // 72'
  await page.click('#card [data-a="tpn"][data-d="-60"]'); await page.click('#card [data-a="tpn"][data-d="30"]');
  console.log(`[${name}:picker] ${await txt('#tpV')} | button ${await txt('#card [data-a="jgo"]')}`);
  for (const [f, i, n] of [['sc', 0, 1], ['ft', 0, 6], ['ft', 1, 3]]) for (let k = 0; k < n; k++) await page.click(`#card [data-a="js"][data-f="${f}"][data-i="${i}"][data-d="1"]`);
  await page.click('#card [data-a="jlk"]');
  for (const [i, n] of [[0, 2], [1, 1]]) for (let k = 0; k < n; k++) await page.click(`#card [data-a="js"][data-f="ck1"][data-i="${i}"][data-d="-1"]`);
  console.log(`[${name}:join-h2] ${(await txt('#card')).slice(0, 220)}`);
  await page.screenshot({ path: `${out}/${name}_b1_join.png` });
  await page.click('#card [data-a="jgo"]');
  console.log(`[${name}:joined] clock=${await txt('#clkT')} score=${await txt('#glH')}-${await txt('#glA')} hdr=${await txt('#ckH')}/${await txt('#ckA')} | ${(await txt('#pred .sub2'))} | ${(await txt('#pred .pred-line'))}`);
  // switch to second-half-only market: uses the 2nd-half split
  await page.click('#pred .seg [data-v="h"]');
  console.log(`[${name}:h2-only] ${(await txt('#pred .sub2'))} | ${(await txt('#pred .pred-line'))}`);
  await page.click('#pred .seg [data-v="f"]');
  // tap the scoreboard to correct the corners
  await page.click('#ckA');
  console.log(`[${name}:tapfix] ${(await txt('#card .card-h'))} | ${(await txt('#card')).slice(20, 120)}`);
  await page.click('#card [data-a="js"][data-f="ft"][data-i="1"][data-d="1"]'); await page.click('#card [data-a="jgo"]');
  console.log(`[${name}:fixed] ${await txt('#ckA')} | ${(await txt('#pred .sub2'))}`);
  // clock sheet: picker, then set
  await page.click('#clkBtn'); await page.click('#card [data-a="tpn"][data-d="300"]'); await page.click('#card [data-a="tpset"]');
  console.log(`[${name}:clockset] ${await txt('#clkT')} ${await txt('#perL')}`);
  await page.click('#card [data-a="close"]');
  await tap(1, 'f3', 3); await tap(1, 'bx', 2); await tap(1, 'cf', 2); await tap(1, 'sb', 1); await tap(0, 'f3', 2); await tap(0, 'ss', 1);
  await page.screenshot({ path: `${out}/${name}_b2_live.png` });
  const tl = await page.$('#tlSec'); await tl.screenshot({ path: `${out}/${name}_b3_timeline.png` });
  // export carries markets and bets
  await page.click('#menuBtn'); await page.click('#card [data-a="arch"]');
  console.log(`[${name}:archive] ${(await txt('#card')).slice(0, 200)}`);
  await page.click('#card [data-a="expall"]');
  const o = JSON.parse(await page.inputValue('#expText'));
  const m1 = o.matches.find(m => m.h === '阿森纳');
  console.log(`[${name}:export] matches=${o.matches.length} m1.bets=${m1.ab.bets.length} settled=${m1.ab.bets.filter(b => b.r != null).length} res=${JSON.stringify(m1.res)} mk=${JSON.stringify(m1.mk)} fl=${m1.fl} fh=${m1.fh}`);
  await page.click('#card [data-a="close"]');
  await page.reload(); await page.waitForSelector('#pred');
  console.log(`[${name}:reload] ${(await txt('#pred .sec-h')).slice(0, 30)} | ${(await txt('#pred .sub2'))}`);
  console.log(`[${name}] ERRORS: ${errors.length ? errors.join('\n') : 'none'}`);
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch();
  await run(browser, 'ipad', { width: 1180, height: 820 });
  await run(browser, 'phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
