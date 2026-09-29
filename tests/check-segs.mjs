// node tests/check-segs.mjs
// ストックのある区間の抽選回数と発動回数を、小さな所持数の全経路の列挙と比べる。
import assert from 'node:assert/strict';
import { segRolls, stockSkills, eff } from '../js/calc.js';
const near = (a, b, label) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), `${label}: ${a} != ${b}`);

// 所持数0から end 回おてつだいする全経路。満タンになった後もキューに残る4回までは抽選し、発動はストック2回まで。
// 抽選回数の分布 P と、発動回数の期待値 got を返す。
function brute(cap, n, ingP, berry, ing, p) {
  const P = Array(Math.ceil(n) + 1).fill(0);
  let full = 0, got = 0;
  // left は満タン後に残る抽選の回数（満タンになるまでは null）。
  const walk = (i, end, count, rolls, stock, left, w) => {
    if (!w) return;
    if (i === end || left === 0) {
      P[rolls] += w;
      if (left !== null) full += w;
      got += w * stock;
      return;
    }
    if (left !== null) {
      // 満タン後は所持数が増えず、キューの残りで抽選だけ行う。
      if (stock < 2) {
        walk(i + 1, end, count, rolls + 1, stock + 1, left - 1, w * p);
        walk(i + 1, end, count, rolls + 1, stock, left - 1, w * (1 - p));
      } else {
        walk(i + 1, end, count, rolls + 1, stock, left - 1, w);
      }
      return;
    }
    for (const [amt, prob] of [[berry, 1 - ingP], ...ing.map((a) => [a, ingP / ing.length])]) {
      const c = count + amt, f = c >= cap ? 4 : null;
      if (stock < 2) {
        walk(i + 1, end, c, rolls + 1, stock + 1, f, w * prob * p);
        walk(i + 1, end, c, rolls + 1, stock, f, w * prob * (1 - p));
      } else {
        walk(i + 1, end, c, rolls + 1, stock, f, w * prob);
      }
    }
  };
  const lo = Math.floor(n), f = n - lo;
  walk(0, lo, 0, 0, 0, null, 1 - f);
  if (f) walk(0, lo + 1, 0, 0, 0, null, f);
  return { P, full, got };
}

let cases = 0;
for (const cap of [1, 2, 4, 7]) for (const n of [0, 1, 3.5, 4, 5, 6.25]) for (const ingP of [0, 0.3, 1]) for (const p of [0, 0.2, 1]) {
  const a = segRolls(cap, n, ingP, 1, [1, 2]), b = brute(cap, n, ingP, 1, [1, 2], p);
  a.P.forEach((x, i) => near(x, b.P[i] || 0, `rolls/${cap}/${n}/${ingP}/${i}`));
  near(a.full, b.full, `full/${cap}/${n}/${ingP}`);
  near(stockSkills(p, a.P), b.got, `skills/${cap}/${n}/${ingP}/${p}`);
  cases++;
}
// 天井込みの実質確率: 天井の回数ちょうどで必ず発動する更新過程の、1回あたりの発動回数。
for (const [p, c] of [[0.02, 63], [0.3, 3], [0.5, 1], [1, 5], [0.1, 40]]) {
  const mean = Array.from({ length: c }, (_, k) => (1 - p) ** k).reduce((s, x) => s + x, 0);
  near(eff(p, c), 1 / mean, `eff/${p}/${c}`);
  cases++;
}
console.log(`${cases}ケース OK`);
