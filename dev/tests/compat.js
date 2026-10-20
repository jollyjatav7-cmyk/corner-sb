const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1180, height: 820 } });
  const v1 = {
    ma: { id: 'ma', c: 1, u: 2, d: '2026-10-19', lg: '英超', h: '甲', a: '乙', st: 2, exp: null, line: [4.5, 4.5], add: [null, null], pe: { 1: 2900, 2: 5400 }, tm: { p: 2, b: 5700, r: 0, at: 0, ht: 0 },
      ev: [{ t: 60, p: 1, i: 0, c: 'f3', k: 1 }, { t: 300, p: 1, i: 0, c: 'ck', k: 2 }, { t: 3000, p: 2, i: 1, c: 'bx', k: 3 }] },
    mb: { id: 'mb', c: 3, u: 4, d: '2026-10-20', lg: '英超', h: '丙', a: '丁', st: 1, exp: 10.5, line: [4.5, 5.5], add: [null, null], pe: {}, tm: { p: 1, b: 600, r: 0, at: 0, ht: 0 },
      ev: [{ t: 120, p: 1, i: 0, c: 'f3', k: 1 }, { t: 200, p: 1, i: 1, c: 'ck', k: 2 }] } };
  await ctx.addInitScript(s => { if (!localStorage.getItem('corner-sb-matches')){ localStorage.setItem('corner-sb-matches', s); localStorage.setItem('corner-sb-current', '"mb"'); } }, JSON.stringify(v1));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(process.argv[2] + '/index.html'); await p.waitForSelector('#pred');
  console.log((await p.textContent('#pred')).replace(/\s+/g, ' ').slice(0, 160));
  await p.click('#menuBtn'); await p.click('#card [data-a="arch"]');
  console.log((await p.textContent('#card')).replace(/\s+/g, ' ').slice(0, 220));
  console.log('ERRORS:', errs.length ? errs : 'none'); await b.close();
})();
