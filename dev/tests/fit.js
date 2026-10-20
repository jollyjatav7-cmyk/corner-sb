const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const b = await chromium.launch();
  for (const [w, h] of [[1180, 820], [1194, 834], [1080, 810], [1133, 744], [1024, 768], [1366, 1024], [820, 1180]]){
    const p = await (await b.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h } })).newPage();
    await p.goto(process.argv[2] + '/index.html'); await p.waitForSelector('#tl');
    const r = await p.evaluate(() => ({ pad: Math.round(document.querySelector('.pad .extra').getBoundingClientRect().bottom), strip: Math.round(document.querySelector('.strip').getBoundingClientRect().top), tl: Math.round(document.querySelector('#tlSec').getBoundingClientRect().height) }));
    console.log(w + 'x' + h, JSON.stringify(r), r.pad <= r.strip ? 'pads fit' : 'pads cut by ' + (r.pad - r.strip) + 'px');
    if (w === 1180) await p.screenshot({ path: (process.argv[3] || '.') + '/ipad_fit.png' });
  }
  await b.close();
})();
