const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const b = await chromium.launch(); const errs = [];
  const c1 = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1180, height: 820 } }); const p1 = await c1.newPage();
  p1.on('pageerror', e => errs.push(e.message));
  await p1.goto(process.argv[2] + '/index.html'); await p1.fill('#fH', 'A隊'); await p1.click('#runBtn');
  await p1.click('.pad[data-i="0"] [data-c="f3"]'); await p1.click('.pad[data-i="1"] .ckr');
  await p1.click('#menuBtn'); await p1.click('#card [data-a="exp1"]'); const txt = await p1.inputValue('#expText');
  const c2 = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1180, height: 820 } }); const p2 = await c2.newPage();
  p2.on('pageerror', e => errs.push(e.message));
  await p2.goto(process.argv[2] + '/index.html');
  await p2.click('#menuBtn'); await p2.click('#card [data-a="import"]'); await p2.fill('#pasteIn', txt); await p2.click('#card [data-a="paste"]');
  await p2.click('#menuBtn'); await p2.click('#card [data-a="arch"]');
  console.log((await p2.textContent('#card')).replace(/\s+/g, ' ').slice(0, 200));
  await p2.locator('#card [data-a="wopen"]').first().click(); await p2.click('#card [data-a="mopen"]');
  console.log('opened:', (await p2.textContent('.score')).replace(/\s+/g, ' '), '| events in strip:', (await p2.textContent('#recent')).replace(/\s+/g, ' '));
  console.log('ERRORS:', errs.length ? errs : 'none'); await b.close();
})();
