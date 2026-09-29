// node tests/check-segs.mjs
// リングバッファを使わず、ストック数×不発回数の全状態を追う独立した参照計算。
import assert from 'node:assert/strict';
import { runSegs, segRolls } from '../js/calc.js';
import { CHAIN_MAX_DAYS, CHAIN_TOL } from '../js/constants.js';
const near = (a, b, label) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= 1e-11 * Math.max(1, Math.abs(b)), `${label}: ${a} != ${b}`);
function reference(p, segs, ceil) {
  let dist = Array(ceil).fill(0); dist[0] = 1;
  let result;
  for (let day = 0; day < CHAIN_MAX_DAYS; day++) {
    const prev = [...dist];
    result = { day: 0, night: 0, rolls: 0, full: 0 };
    for (const seg of segs) {
      const limit = seg.tap ? 0 : 2;
      let states = Array.from({ length: limit + 1 }, (_, k) => k === 0 ? [...dist] : Array(ceil).fill(0));
      const n = seg.tap ? Math.ceil(seg.n) : seg.rolls.n;
      const P = seg.tap ? Array(n + 1).fill(0) : seg.rolls.P;
      if (seg.tap) { const f = seg.n % 1; P[Math.floor(seg.n)] += 1 - f; if (f) P[n] += f; }
      const end = Array(ceil).fill(0);
      let earned = 0, got = 0;
      for (let i = 0; i <= n; i++) {
        for (let k = 0; k <= limit; k++) for (let j = 0; j < ceil; j++) {
          end[j] += P[i] * states[k][j];
          if (!seg.tap) got += P[i] * k * states[k][j];
        }
        if (seg.tap) got += P[i] * earned;
        if (i === n) break;
        const next = Array.from({ length: limit + 1 }, () => Array(ceil).fill(0));
        for (let k = 0; k <= limit; k++) for (let j = 0; j < ceil; j++) {
          const mass = states[k][j];
          if (!seg.tap && k === 2) { next[k][j] += mass; continue; }
          const prob = j === ceil - 1 ? 1 : p;
          next[seg.tap ? 0 : k + 1][0] += mass * prob;
          if (j < ceil - 1) next[k][j + 1] += mass * (1 - prob);
          if (seg.tap) earned += mass * prob;
        }
        states = next;
      }
      dist = end;
      result[seg.night ? 'night' : 'day'] += got;
      if (seg.night && !seg.tap) {
        result.rolls += seg.rolls.P.reduce((a, w, i) => a + w * i, 0);
        result.full = seg.rolls.full;
      }
    }
    if (day > 0 && dist.reduce((s, v, i) => s + Math.abs(v - prev[i]), 0) < CHAIN_TOL) break;
  }
  return result;
}
// 小さな所持数の全経路を列挙。満タンになった時刻から4回後まで抽選できる。
function bruteRolls(cap, n, ingP, berry, ing) {
  const P = Array(Math.ceil(n) + 1).fill(0);
  let full = 0;
  const walk = (i, end, count, filled, w) => {
    if (!w) return;
    if (i === end) { P[filled === null ? end : Math.min(end, filled + 4)] += w; if (filled !== null) full += w; return; }
    if (filled !== null) { walk(end, end, count, filled, w); return; }
    for (const [amt, prob] of [[berry, 1 - ingP], ...ing.map(a => [a, ingP / ing.length])]) {
      walk(i + 1, end, count + amt, count + amt >= cap ? i + 1 : null, w * prob);
    }
  };
  const lo = Math.floor(n), f = n - lo;
  walk(0, lo, 0, null, 1 - f);
  if (f) walk(0, lo + 1, 0, null, f);
  return { P, full };
}
let cases = 0;
for (const cap of [1, 2, 4]) for (const n of [0, 1, 3.5, 4, 5, 6.25]) for (const p of [0, 0.3, 1]) {
  const a = segRolls(cap, n, p, 1, [1, 2]), b = bruteRolls(cap, n, p, 1, [1, 2]);
  a.P.forEach((x, i) => near(x, b.P[i], `rolls/${cap}/${n}/${i}`));
  near(a.full, b.full, 'full'); cases++;
}
const tests = [];
for (const ceil of [1, 2, 3, 8, 50]) for (const p of [0, 0.001, 0.1, 0.7, 1]) {
  for (const n of [0, 1, ceil - 1, ceil, ceil + 0.5, 2 * ceil + 1]) {
    const stock = (night, cap, rolls) => ({ night, tap: false, n: rolls, rolls: segRolls(cap, rolls, 0.3, 1, [1, 2]) });
    for (const segs of [
      [{ night: false, tap: true, n: 3.25 }, stock(true, 3, n)],
      [stock(false, 5, n), stock(true, 1000, n)],
      [stock(true, 1, n)],
    ]) tests.push({ p, segs, ceil });
  }
}
// 共通倍率の正規化（1e-150未満）と、ストック2回での停止。
tests.push({ p: 0.99, ceil: 3, segs: [{ night: false, tap: true, n: 200.5 }, { night: true, tap: false, n: 200, rolls: segRolls(1000, 200, 0, 1, [1]) }] });
const answers = tests.map(({ p, segs, ceil }, i) => {
  const a = runSegs(p, segs, ceil), b = reference(p, segs, ceil);
  for (const key of Object.keys(b)) near(a[key], b[key], `case${i}/${key}`);
  cases++; return a;
});
for (let i = tests.length - 1; i >= 0; i--) {
  const { p, segs, ceil } = tests[i];
  assert.deepEqual(runSegs(p, segs, ceil), answers[i], '計算順に依存しない');
}
console.log(`OK ${cases}ケース（逆順での一致も確認）`);
