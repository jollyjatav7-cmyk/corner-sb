// Adapts the UI tests to the plan A / plan C layout: the prediction card has tabs (盘口/自动投注/数据),
// the 详细 section is folded, and on phones the card is a bottom sheet opened from the summary bar.
// v19: 结束 now asks whether to keep the match (the old tests mean 加入仓库), 新比赛 asks what to do with an
// unfinished match (the old behaviour was 先留着), and on phones 全部事件 lives in 功能.
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
  const after = async sel => {
    if (/data-a="finish"|data-pa="nfin"/.test(sel) && await page.$('#card [data-a="fkeep"]')) await raw('#card [data-a="fkeep"]');
    if (/data-a="new"|data-pa="new"/.test(sel) && await page.$('#card [data-a="nq3"]')) await raw('#card [data-a="nq3"]');
  };
  page.click = async (sel, opts) => {
    // v19: the first bet is recorded from 我的注 in the quick bar (the odds panel only lists bets once there are some)
    if (sel === '#pred [data-pa="mybet"]' && !(await page.$(sel))){
      if (isPhone) await setOpen(false);
      await raw('#qbMy');
      if (await page.$('#card [data-a="mybet"]')) await raw('#card [data-a="mybet"]');
      return;
    }
    if (typeof sel === 'string' && /^#(pred|ab|counts)\b/.test(sel)){
      const hud = sel.replace(/^#pred /, '#hud ');
      if (isPhone && hud !== sel && /data-pa="(kick1|join|new)"/.test(sel) && await page.$(hud)){ const r = await raw(hud, opts); await after(sel); return r; }
      await prep(sel);
      const r = await raw(sel, opts);
      if (isPhone && await page.$('#mid.open')) await setOpen(false);
      await after(sel);
      return r;
    }
    if (isPhone && sel === '#listBtn'){ await raw('#qbMore'); return raw('#card [data-a="list"]', opts); }
    const r = await raw(sel, opts);
    if (typeof sel === 'string') await after(sel);
    return r;
  };
  page.waitForSelector = (sel, opts) => /^#(pred|ab|counts)\b/.test(sel) ? rawWait(sel, Object.assign({ state: 'attached' }, opts)) : rawWait(sel, opts);
  page.openMid = async (tab = 'pred') => { await prep(tab === 'ab' ? '#ab' : '#pred'); };
  page.closeMid = async () => { if (isPhone) await setOpen(false); };
  return page;
};
