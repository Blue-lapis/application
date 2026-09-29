// 上位%の分布の整合性を確かめる。リポジトリ直下で `node tests/check-dist.mjs` を実行する。
// - 分布の確率の合計が1になる。
// - 無補正比の高い順に並べると、同等以上の確率（atLeast）は増えていき、最後は1になる。
// - 順位（自分より高い値の数 + 1）と同等以上の確率が、同じ性能を同じに扱う（同じ値なら同じ順位・同じ確率）。
// - 個体の無補正比（score）が分布のどれかの値と一致する（同じ計算で作られている）。
import { createEngines } from '../checker/js/types.js';
import { SAME_REL } from '../js/calc.js';

const engines = createEngines();
const CASES = [
  ['berry', { N: 3, camp: true, mon: 'walrein', heal: 1, tap: '3h', team: true, healAmt: 18, healTimes: 3 }, ['berry', 'spM', 'ingS'], 'speed', 'energy'],
  ['berry', { N: 4, camp: false, mon: 'raichu', heal: 0, tap: 'none', team: false, healAmt: 18, healTimes: 2.5 }, ['hb', 'spS', 'invM', 'erb'], 'energy', 'other'],
  ['ingredient', { N: 3, camp: true, g80: false, mon: 'flygon', target: 'A' }, ['ingM', 'spS', 'invL'], 'ing', 'speed'],
  ['skill', { N: 3, camp: true, g80: false, mon: 'mewtwo' }, ['skM', 'spM', 'hb'], 'skill', 'other'],
];

let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('NG', msg); } };
for (const [type, env, subs, up, down] of CASES) {
  const en = engines[type];
  const dist = en.dist(env);
  const sum = dist.reduce((a, x) => a + x.p, 0);
  check(Math.abs(sum - 1) < 1e-9, `${type} ${env.mon}: 確率の合計 ${sum}`);
  const sorted = [...dist].sort((a, b) => b.r - a.r);
  let prev = 0;
  sorted.forEach((x, i) => {
    const ge = en.atLeast(x.r, env);
    check(ge >= prev - 1e-12, `${type} ${env.mon}: ${i + 1}位で確率が減った`);
    prev = ge;
    const pos = 1 + dist.filter((y) => y.r > x.r * (1 + SAME_REL)).length;
    check(pos === i + 1, `${type} ${env.mon}: ${i + 1}番目の順位が ${pos}`);
  });
  check(Math.abs(prev - 1) < 1e-9, `${type} ${env.mon}: 最下位の同等以上の確率 ${prev}`);
  const arr = type === 'ingredient' ? [0, 0, 0] : undefined;
  const r = type === 'ingredient' ? en.score(subs, up, down, arr, env) : en.score(subs, up, down, env);
  check(dist.some((x) => Math.abs(x.r - r) <= r * SAME_REL), `${type} ${env.mon}: 個体の無補正比 ${r} が分布にない`);
  console.log(`${type} ${env.mon}: ${dist.length}通り 合計 ${sum.toFixed(12)} / 個体 ${r.toFixed(3)}倍 同等以上 ${(en.atLeast(r, env) * 100).toFixed(3)}%`);
}
console.log(failed ? `NG ${failed}件` : 'OK');
process.exit(failed ? 1 : 0);
