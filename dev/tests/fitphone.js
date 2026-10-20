// Phone fit check: the 乌龙/红牌 row must end above the bottom bar.
// Heights are real screens minus the top and bottom safe areas.
// Usage: node fitphone.js <base_url> <out_dir>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  for (const [name, w, h] of [['iPhone15', 393, 852 - 59 - 34], ['iPhone13', 390, 844 - 47 - 34], ['iPhoneSE', 375, 667 - 20], ['ProMax', 430, 932 - 59 - 34], ['iPhone12mini', 375, 812 - 50 - 34]]){
    for (const live of [false, true]){
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      await page.goto(base + '/index.html'); await page.waitForSelector('#hud .hud-row');
      if (live){ await page.click('#hud [data-pa="kick1"]'); await page.waitForTimeout(200); }
      const r = await page.evaluate(() => {
        const ex = [...document.querySelectorAll('.pad .extra')].map(e => e.getBoundingClientRect().bottom);
        const box = document.querySelector('.pad .box').getBoundingClientRect().height;
        const goal = document.querySelector('.pad .goalrow .z').getBoundingClientRect().height;
        return { extra: Math.round(Math.max(...ex)), strip: Math.round(document.querySelector('.strip').getBoundingClientRect().top), box: Math.round(box), goal: Math.round(goal), hud: document.querySelector('#hud').innerText.replace(/\s+/g, ' ') };
      });
      console.log(`${name} ${w}x${h} ${live ? 'live' : 'pre '} extraBottom=${r.extra} stripTop=${r.strip} ${r.extra <= r.strip ? 'OK' : 'OVERLAP'} goalTile=${r.goal} box=${r.box} | ${r.hud.slice(0, 50)}`);
      if (name === 'iPhoneSE' || name === 'iPhone15') await page.screenshot({ path: `${out}/${name}_${live ? 'live' : 'pre'}.png` });
      await ctx.close();
    }
  }
  await b.close();
})();
