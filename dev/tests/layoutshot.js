// Screenshots of the new layout with a live first-half match.
// Usage: node layoutshot.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
function match(){
  const raw = 'h f3 3|h f3 4|h bx 5|h f3 5.5|h co 6|h ss 6.5|h f3 7|h ck 7.5|h f3 8|h bx 8.5|h cf 9|a f3 11|h f3 12|a f3 13|a cf 13.5|a f3 14|a bx 14.5|a so 15|a f3 15.2|a co 15.5|a ck 16|h f3 18|h f3 19|h bx 19.5|h ck 20|h co 20.5|h f3 21|h sb 21.3|h sg 22|h f3 23|h cf 23.5|h so 24|a f3 26|a f3 26.5|a bx 26.8|a sb 27|h f3 27.4|h ck 28|h f3 28.4|h bx 28.8|h co 29.2|h ss 29.8|h f3 30.5|h bx 31';
  const ev = raw.split('|').map(s => { const [t, c, m] = s.split(' '); return { t: Math.round(+m * 60), p: 1, i: t === 'h' ? 0 : 1, c }; });
  return { id: 'mlay', d: '2026-10-20', lg: '英超', h: '阿森纳', a: '热刺', st: 1, exp: null, line: [4.5, 4.5], hd: [-1.5, -0.5], add: [null, null], pe: {},
    mk: ['h', 'f'], fl: null, fh: null, ab: { on: { mt: 'h1' }, bets: [{ key: 'h1|ou|o|4.5|60', mt: 'h1', mk: 'ou', sd: 'o', ln: 4.5, pr: 0.66, tier: 60, p: 1, t: 760, hold: 180, sc: [0, 0], ck: [1, 1], r: null }] },
    obs: { p: 1, t: 0 }, stop: null, tm: { p: 1, b: 1884, r: 0, at: 0, ht: 0 }, ev };
}
(async () => {
  const b = await chromium.launch();
  for (const [name, vp, o] of [['ipad', { width: 1180, height: 820 }, {}], ['ipadp', { width: 820, height: 1180 }, {}], ['phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true }]]){
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: 'block', ...o });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(m => { localStorage.setItem('corner-sb-matches', JSON.stringify({ mlay: m })); localStorage.setItem('corner-sb-current', JSON.stringify('mlay')); localStorage.setItem('corner-sb-net', JSON.stringify({ key: 'X', auto: false, iv: 0 })); }, match());
    await page.clock.install({ time: new Date('2026-10-20T11:00:00Z') });
    await page.goto(base + '/index.html'); await page.waitForSelector('#pred .pv', { state: 'attached' });
    await page.locator('.pad[data-i="0"] [data-c="f3"]:visible').first().click();
    await page.screenshot({ path: `${out}/${name}_1.png` });
    console.log(name, 'undo:', await page.textContent('.pad[data-i="0"] .undo'), '| hud:', (await page.textContent('#hud')).replace(/\s+/g, ' ').trim());
    if (name === 'phone'){
      await page.click('#hud .hud-c'); await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${name}_2_sheet.png` });
      await page.click('.tabs [data-tab="ab"]'); await page.waitForTimeout(100);
      await page.screenshot({ path: `${out}/${name}_3_ab.png` });
      await page.click('#midClose'); await page.waitForTimeout(400);
    } else {
      await page.click('#pred [data-pa="more"]');
      await page.screenshot({ path: `${out}/${name}_2_more.png` });
    }
    await page.click('.pad[data-i="0"] .undo');
    console.log(name, 'after undo:', await page.textContent('#toast'), '| errors:', errors.join('; ') || 'none');
    await ctx.close();
  }
  await b.close();
})();
