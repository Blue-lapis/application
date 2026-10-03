// node tests/check-ingenergy.mjs
// 食材タイプをエナジーで評価するモード（ver1.12）を確かめる。
// - データ: すべてのポケモンにきのみがあり、きのみの Lv.1 のエナジーがきのみタイプと同じ、すべての食材にエナジーがある。
// - 評価の値（metric）が、表示用の値（daily）の食材のエナジー＋きのみのエナジーと一致する。
// - 「常にタップ」の日中のきのみは おてつだい回数 × 1回の個数 × (1 − 食材確率) と一致する。
// - エナジーの評価は狙い食材によらない。個数の評価の条件のキーは以前と同じ形。
// - エナジーの無補正比は同じ食材配列の無補正個体で割るので、どの食材配列でも無補正個体は1倍。
// - きのみの数Sは、エナジーでは無補正比を上げ、個数では上げない。分布の確率の合計は1。
import assert from 'node:assert/strict';
import { createEngine, mults, envKey, ingEnergy, berryOf, recipeMulOf } from '../checker/js/ingredient/calc.js';
import { MONS, allArrs } from '../checker/js/ingredient/constants.js';
import { ING_ENERGY, BERRY_BASE, BERRY_OF, recipeMul } from '../checker/js/ingredient/energy.js';
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

// 料理の倍率（にとよんツールの IngHelpDialog と同じ式。25%・Lv.30 で 1.81 倍、0% は1倍）。
assert.equal(recipeMul(0, 30), 1);
close(recipeMul(25, 30), 1.25 * 1.61 * 0.8 + 0.2, '25%・Lv.30');
close(recipeMul(78, 70), 1.78 * 3.58 * 0.8 + 0.2, '78%・Lv.70');
ok('料理の倍率');

const base = { camp: true, heal: 1, team: true, healAmt: 18, healTimes: 5, recipeBonus: 25, recipeLevel: 30 };
const envs = [
  { ...base, lv: 60, N: 3, tap: '3h' },
  { ...base, lv: 80, N: 5, tap: 'always', camp: false, recipeBonus: 0 },
  { ...base, lv: 50, N: 3, tap: '3h', heal: 'g80', recipeBonus: 78, recipeLevel: 55 },
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
      const mul = recipeMulOf(env);
      const fromDaily = ingEnergy(d.day, mul) + ingEnergy(d.night, mul) + (d.berryDay + d.berryNight) * be;
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
assert.equal(envKey({ camp: true, heal: 1, team: true, healAmt: 18, healTimes: 5, lv: 60, N: 3, tap: '3h', mon: 'flygon', target: 'A' }),
  '60|3|true|flygon|A|1|3h|true|18|5', '個数の評価のキー');
assert.notEqual(envKey({ ...envs[0], mon: 'flygon', by: 'energy' }), envKey({ ...envs[0], mon: 'flygon', by: 'energy', recipeLevel: 31 }), 'レシピレベルでキーが変わる');
ok('エナジーの評価は狙い食材によらない・個数の評価のキーは以前と同じ');

// 同じ食材配列の無補正個体が基準。
for (const mon of Object.keys(MONS)) for (const e0 of envs) {
  const env = { ...e0, mon, by: 'energy' };
  for (const { arr } of allArrs(MONS[mon], 3)) {
    close(eng.score([], null, null, arr, env), 1, `無補正/${mon}/${env.lv}/${arr}`);
    // おてボの効果も同じ食材配列のほかのメンバーで数えるので、配列によらずほぼ同じ比になる（げんき・所持数で少しずれる）。
    const hb = eng.score(['hb'], null, null, arr, env);
    assert.ok(hb > 1, `おてボ/${mon}/${arr}`);
  }
}
ok('エナジーでは、どの食材配列でも無補正個体が1倍');

// きのみの数S
for (const mon of Object.keys(MONS)) {
  const env = { ...envs[0], mon };
  const arr = [0, 0, 0];
  const en = { ...env, by: 'energy' }, cnt = { ...env, target: 'A' };
  assert.ok(eng.score(['berry'], null, null, arr, en) > eng.score([], null, null, arr, en), `${mon} エナジーできのみの数Sが効く`);
  assert.ok(eng.score(['berry'], null, null, arr, cnt) <= eng.score([], null, null, arr, cnt), `${mon} 個数ではきのみの数Sで増えない`);
}
ok('きのみの数Sはエナジーでだけ無補正比を上げる');

// レシピボーナスが高いほど食材の比重が上がり、きのみの数Sの効きは下がり、食材確率アップの効きは上がる。
for (const mon of Object.keys(MONS)) {
  const at = (recipeBonus, subs) => eng.score(subs, null, null, [0, 0, 0], { ...envs[0], mon, by: 'energy', recipeBonus });
  assert.ok(at(0, ['berry']) > at(25, ['berry']) && at(25, ['berry']) > at(78, ['berry']), `${mon} きのみの数S`);
  assert.ok(at(0, ['ingM']) < at(25, ['ingM']) && at(25, ['ingM']) < at(78, ['ingM']), `${mon} 食材確率アップM`);
}
ok('レシピボーナスで食材ときのみの比重が変わる');

// 分布は同じ食材配列の個体だけを母集団にする（食材配列は条件の arr に固定。サブスキル・性格だけを数える）。
for (const [env, arr] of [[{ ...envs[0], mon: 'flygon', by: 'energy' }, [0, 1, 2]], [{ ...envs[2], mon: 'ditto', by: 'energy' }, [0, 1]]]) {
  const e = { ...env, arr: arr.join('') };
  assert.notEqual(envKey(e), envKey({ ...e, arr: arr.map(() => 0).join('') }), '食材配列でキーが変わる');
  const fresh = createEngine();
  const dist = fresh.dist(e);
  close(dist.reduce((s, x) => s + x.p, 0), 1, `分布の合計/${env.mon}`);
  for (let i = 1; i < dist.length; i++) assert.ok(dist[i - 1].r > dist[i].r, '高い順');
  // 同じ配列の無補正個体は1倍。分布の最小値（げんき回復量↓などで1倍を下回る）以上・最大値以下。
  assert.ok(dist.at(-1).r <= 1 + 1e-9 && dist[0].r >= 1, `無補正が分布の中/${env.mon}`);
  // 分布の値は、その配列の個体の無補正比そのもの（きのみSだけ・無補正性格の個体の比が分布に入っている）。
  const r = fresh.score(['berry', 'xExp', 'xRes'].slice(0, env.N), null, null, arr, e);
  assert.ok(dist.some((x) => Math.abs(x.r - r) <= 1e-8), `分布にある値/${env.mon}`);
}
ok('分布は同じ食材配列の個体だけで数え、確率の合計は1');
console.log('OK');
