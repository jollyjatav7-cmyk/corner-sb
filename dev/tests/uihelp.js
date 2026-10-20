// Adapts the UI tests to the plan A / plan C layout: the prediction card has tabs (盘口/自动投注/数据),
// the 详细 section is folded, and on phones the card is a bottom sheet opened from the summary bar.
module.exports = function wrap(page, isPhone){
  const raw = page.click.bind(page), rawWait = page.waitForSelector.bind(page);
  const setOpen = async (open) => {
    const cur = await page.$eval('#mid', e => e.classList.contains('open'));
    if (cur === open) return;
    await page.evaluate(o => { document.querySelector('#mid').classList.toggle('open', o); document.querySelector('#scrim').hidden = !o; }, open);
    await page.waitForTimeout(320);
  };
  async function prep(sel){
    const tab = sel.startsWith('#ab') ? 'ab' : sel.startsWith('#counts') ? 'data' : 'pred';
    if (isPhone) await setOpen(true);
    if (await page.$eval('#mid', e => e.dataset.tab) !== tab) await raw(`.tabs [data-tab="${tab}"]`);
    if (/data-pa="(exp|add|exp0|add0|expc)"/.test(sel) && !(await page.$('#pred .more'))) await raw('#pred [data-pa="more"]');
  }
  page.click = async (sel, opts) => {
    if (typeof sel === 'string' && /^#(pred|ab|counts)\b/.test(sel)){
      const hud = sel.replace(/^#pred /, '#hud ');
      if (isPhone && hud !== sel && /data-pa="(kick1|join|new)"/.test(sel) && await page.$(hud)) return raw(hud, opts);
      await prep(sel);
      const r = await raw(sel, opts);
      if (isPhone && await page.$('#mid.open')) await setOpen(false);
      return r;
    }
    return raw(sel, opts);
  };
  page.waitForSelector = (sel, opts) => /^#(pred|ab|counts)\b/.test(sel) ? rawWait(sel, Object.assign({ state: 'attached' }, opts)) : rawWait(sel, opts);
  page.openMid = async (tab = 'pred') => { await prep(tab === 'ab' ? '#ab' : '#pred'); };
  page.closeMid = async () => { if (isPhone) await setOpen(false); };
  return page;
};
