// node tests/check-ingenergy.mjs
// 食材タイプをエナジーで評価するモード（ver1.12）を確かめる。
// - データ: すべてのポケモンにきのみがあり、きのみの Lv.1 のエナジーがきのみタイプと同じ、すべての食材にエナジーがある。
// - 評価の値（metric）が、表示用の値（daily）の食材のエナジー＋きのみのエナジーと一致する。
// - 「常にタップ」の日中のきのみは おてつだい回数 × 1回の個数 × (1 − 食材確率) と一致する。
// - エナジーの評価は狙い食材によらない。個数の評価の条件のキーは以前と同じ形。
// - きのみの数Sは、エナジーでは無補正比を上げ、個数では上げない。分布の確率の合計は1。
import assert from 'node:assert/strict';
import { createEngine, mults, envKey, ingEnergy, berryOf } from '../checker/js/ingredient/calc.js';
import { MONS, allArrs } from '../checker/js/ingredient/constants.js';
import { ING_ENERGY, BERRY_BASE, BERRY_OF } from '../checker/js/ingredient/energy.js';
import { MONS as BERRY_MONS } from '../checker/js/berry/mons.js';

const ok = (name) => console.log(`ok ${name}`);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${msg}: ${a} != ${b}`);

// データ
for (const [k, mon] of Object.entries(MONS)) {
  assert.ok(Object.hasOwn(BERRY_BASE, BERRY_OF[k]), `${k} のきのみ`);
  Object.values(mon.ings).forEach((n) => assert.ok(Number.isInteger(ING_ENERGY[n]), `${n} のエナジー`));
}
assert.deepEqual(Object.keys(BERRY_OF).sort(), Object.keys(MONS).sort(), 'きのみのあるポケモンが食材タイプと同じ');
for (const m of Object.values(BERRY_MONS)) assert.equal(BERRY_BASE[m.berry], m.berryBase, `${m.berry} の Lv.1 のエナジー`);
ok('データ');

const base = { camp: true, heal: 1, team: true, healAmt: 18, healTimes: 5 };
const envs = [
  { ...base, lv: 60, N: 3, tap: '3h' },
  { ...base, lv: 80, N: 5, tap: 'always', camp: false },
  { ...base, lv: 50, N: 3, tap: '3h', heal: 'g80' },
  { ...base, lv: 70, N: 4, tap: '3h', heal: 1, healTimes: 2.5, team: false },
];
const SUBS = [[], ['berry'], ['berry', 'ingM', 'spM'], ['invL', 'hb', 'erb', 'ingS', 'spS']];
const NATS = [[null, null], ['speed', 'ing'], ['ing', 'energy'], ['energy', 'speed']];

let cases = 0;
const eng = createEngine();
for (const mon of ['flygon', 'charizard', 'ditto', 'gourgeist-jumbo', 'toxicroak']) {
  const mm = MONS[mon];
  for (const e0 of envs) {
    const env = { ...e0, mon, by: 'energy' };
    const arrs = allArrs(mm, env.lv >= 60 ? 3 : 2);
    for (const subs of SUBS) for (const [up, down] of NATS) for (const { arr } of arrs) {
      const m = mults(subs, up, down);
      const d = eng.daily(m, arr, env);
      const be = berryOf(mon, d.LV).energy;
      const fromDaily = ingEnergy(d.day) + ingEnergy(d.night) + (d.berryDay + d.berryNight) * be;
      close(eng.metric(m, arr, env), fromDaily, `metric/${mon}/${env.lv}/${subs}/${up}/${down}/${arr}`);
      if (env.tap === 'always' && env.heal === 1 && Number.isInteger(env.healTimes)) {
        close(d.berryDay, d.Ha * m.berry * (1 - d.ingP), `日中のきのみ/${mon}/${subs}/${arr}`);
      }
      cases++;
    }
  }
}
ok(`評価の値と表示の値が一致する（${cases}ケース）`);

// 狙い食材によらない。
for (const mon of ['flygon', 'farfetchd']) {
  const env = { ...envs[0], mon, by: 'energy' };
  const keys = Object.keys(MONS[mon].ings).map((target) => envKey({ ...env, target }));
  assert.equal(new Set(keys).size, 1, `${mon} のキーが狙い食材で変わる`);
  for (const target of Object.keys(MONS[mon].ings)) {
    close(eng.score(['berry', 'spM', 'ingM'], 'speed', 'ing', [0, 1, 2], { ...env, target }),
      eng.score(['berry', 'spM', 'ingM'], 'speed', 'ing', [0, 1, 2], env), `${mon}/${target}`);
  }
}
assert.equal(envKey({ ...envs[0], mon: 'flygon', target: 'A' }), '60|3|true|flygon|A|1|3h|true|18|5', '個数の評価のキー');
ok('エナジーの評価は狙い食材によらない・個数の評価のキーは以前と同じ');

// きのみの数S
for (const mon of Object.keys(MONS)) {
  const env = { ...envs[0], mon };
  const arr = [0, 0, 0];
  const en = { ...env, by: 'energy' }, cnt = { ...env, target: 'A' };
  assert.ok(eng.score(['berry'], null, null, arr, en) > eng.score([], null, null, arr, en), `${mon} エナジーできのみの数Sが効く`);
  assert.ok(eng.score(['berry'], null, null, arr, cnt) <= eng.score([], null, null, arr, cnt), `${mon} 個数ではきのみの数Sで増えない`);
}
ok('きのみの数Sはエナジーでだけ無補正比を上げる');

for (const env of [{ ...envs[0], mon: 'flygon', by: 'energy' }, { ...envs[2], mon: 'ditto', by: 'energy' }]) {
  const dist = createEngine().dist(env);
  close(dist.reduce((s, x) => s + x.p, 0), 1, `分布の合計/${env.mon}`);
  for (let i = 1; i < dist.length; i++) assert.ok(dist[i - 1].r > dist[i].r, '高い順');
}
ok('分布の確率の合計は1');
console.log('OK');
