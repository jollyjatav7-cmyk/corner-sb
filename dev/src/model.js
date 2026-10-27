/* ================= 角球模型 =================
   参数由 StatsBomb Open Data（2015/16 英超、西甲、意甲、法甲共 1,517 场）拟合：
   每队每分钟角球率 = 时段基准 × 主场 × 比分状态 × 人数 × 刚有角球 × 攻势系数。
   攻势系数由本场到目前为止的“进入前场、进入禁区、传中”相对平均水准算出。
   阵列里 0 = 主队，1 = 客队。 */
const MODEL = __MODEL__;

function mRng(seed){
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function mPois(lam, rnd){
  if (lam <= 0) return 0;
  const L = Math.exp(-lam); let k = 0, p = 1;
  do { k++; p *= rnd(); } while (p > L);
  return k - 1;
}
/* 攻势系数：cnt[i][group] 本场看到的次数；elapsed 看到的分钟数；rates[i][group] 主队／客队每分钟的平均次数；exp 赛前全场预期（可为 null）；
   share（可省略）＝ [主, 客] 两队各占全场预期的比例（来自“查／算”的两队近 10 场平均）。有 share 时用 coefSplit：
   回测（留一联赛）显示分开用两队预期，让球盘更准（上半场 Brier 约好 1%），大小盘不变。
   回传 mult（含赛前预期的总倍数）、parts（各项的对数贡献）、prior（其中来自赛前预期的倍数）。 */
function mMultipliers(cnt, elapsed, rates, exp, share){
  const useP = exp != null && exp > 0, useS = useP && share != null && share[0] > 0 && share[1] > 0 && MODEL.coefSplit != null;
  const coef = useS ? MODEL.coefSplit : useP ? MODEL.coefPrior : MODEL.coefNoPrior;
  const names = MODEL.features.concat(useP ? ['pr_x_x'] : [], useS ? ['ps_x_x'] : []);
  const out = [0, 0], parts = [[], []], prior = [1, 1];
  for (let i = 0; i < 2; i++){
    let z = coef[0];
    names.forEach((nm, j) => {
      const [kind, who, g] = nm.split('_');
      let x;
      if (kind === 'pr') x = Math.log(exp / MODEL.meanTotal);
      else if (kind === 'ps') x = Math.log(2 * share[i]);
      else {
        // 主队跟主队的平均比、客队跟客队的平均比（rates[0] 主队、rates[1] 客队）
        const j = who === 'own' ? i : 1 - i;
        const n = cnt[j][g], r = rates[j][g];
        const a = r * MODEL.pseudo;
        x = Math.log((n + a) / (r * elapsed + a));
      }
      z += coef[j + 1] * x;
      parts[i].push(coef[j + 1] * x);
      if (kind === 'pr' || kind === 'ps') prior[i] *= Math.exp(coef[j + 1] * x);
    });
    out[i] = Math.exp(z);
  }
  return { mult: out, parts, prior, split: useS };
}
/* half 1/2；t0 本半场已过秒数；score/reds/last/mult 都是 [主, 客]；last 为本半场最后一个角球的秒数或 null；
   end 本半场预计总秒数。more（可省略）是之后要接着模拟的半场，例如 [{ half: 2, end: 2880 }]，用来算全场盘。
   回传剩余角球总数的分布 dist[k]、平均，以及两队各自的平均 meanT 和“主队剩余 − 客队剩余”的分布 diff（键为差值）。
   “谁会占上风”的不确定性：每一次模拟抽一个 z ~ N(0, shareSd²)，主队 × e^(z − sd²/2)、客队 × e^(−z − sd²/2)。
   两队的平均和总数不变，只是让球的机会不会那么极端（回测：没有它时让球说 75% 实际约 72%，加了以后约 75%）。 */
function mSimulate(half, t0, score, reds, last, end, mult, n, seed, more){
  const P = MODEL.base, rnd = mRng(seed), dist = [], diff = {}, sd = MODEL.shareSd || 0, hv = sd * sd / 2;
  const man = [Math.sign(reds[1] - reds[0]), Math.sign(reds[0] - reds[1])];
  const segs = [[half, t0, end]].concat((more || []).map(x => [x.half, 0, x.end]));
  let sum = 0, sumH = 0, sumA = 0;
  for (let s = 0; s < n; s++){
    let g0 = score[0], g1 = score[1], l0 = last[0] == null ? -1e9 : last[0], l1 = last[1] == null ? -1e9 : last[1], tot = 0, c0 = 0, z = 0;
    if (sd > 0){ const u1 = rnd() || 1e-12, u2 = rnd(); z = sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); }
    const mu = [mult[0] * Math.exp(z - hv), mult[1] * Math.exp(-z - hv)];
    for (let si = 0; si < segs.length; si++){
      const hf = segs[si][0], se = segs[si][2];
      const gH = P.goal[hf - 1][1], gA = P.goal[hf - 1][0];
      let t = segs[si][1];
      if (si > 0){ l0 = -1e9; l1 = -1e9; }
      while (t < se - 1e-9){
        const mi = Math.floor(t / 60), step = Math.min(60 - (t - mi * 60), se - t), dt = step / 60;
        const b = P.bin[(hf - 1) * 10 + Math.min(Math.floor(mi / 5), 9)];
        for (let i = 0; i < 2; i++){
          const diff = i === 0 ? g0 - g1 : g1 - g0;
          const st = P.state[diff <= -2 ? 0 : diff === -1 ? 1 : diff === 0 ? 2 : diff === 1 ? 3 : 4];
          const lc = i === 0 ? l0 : l1;
          const lam = b * (i === 0 ? P.home : 1) * P.man[man[i] + 1] * st * (t - lc <= P.cluSec ? P.clu : 1) * mu[i] * dt;
          const k = mPois(lam, rnd);
          tot += k;
          if (i === 0) c0 += k;
          if (k > 0){ if (i === 0) l0 = t + step / 2; else l1 = t + step / 2; }
          const g = mPois((i === 0 ? gH : gA) * dt, rnd);
          if (i === 0) g0 += g; else g1 += g;
        }
        t += step;
      }
    }
    dist[tot] = (dist[tot] || 0) + 1; sum += tot; sumH += c0; sumA += tot - c0;
    const d = 2 * c0 - tot;
    diff[d] = (diff[d] || 0) + 1;
  }
  for (let k = 0; k < dist.length; k++) dist[k] = (dist[k] || 0) / n;
  for (const d in diff) diff[d] /= n;
  return { dist, mean: sum / n, meanT: [sumH / n, sumA / n], diff };
}
function mOver(res, have, line){
  let p = 0;
  for (let k = 0; k < res.dist.length; k++) if (have + k > line) p += res.dist[k];
  return p;
}
function mUnder(res, have, line){
  let p = 0;
  for (let k = 0; k < res.dist.length; k++) if (have + k < line) p += res.dist[k] || 0;
  return p;
}
/* 角球让球（以主队为准）：hd 为主队让球数，例如 -1.5 表示主队让 1.5 个。
   have = [主, 客] 本半场已有角球。回传主队赢盘、走盘、客队赢盘的机率。 */
function mHandicap(res, have, hd){
  let w = 0, p = 0, l = 0;
  for (const k in res.diff){
    const v = have[0] - have[1] + (+k) + hd;
    if (v > 1e-9) w += res.diff[k]; else if (v < -1e-9) l += res.diff[k]; else p += res.diff[k];
  }
  return { home: w, push: p, away: l };
}
if (typeof module !== 'undefined') module.exports = { MODEL, mMultipliers, mSimulate, mOver, mUnder, mHandicap };
