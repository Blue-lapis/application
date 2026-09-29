// node tests/check-boost.mjs
// きのみタイプのフィールドボーナス・好きなきのみの補正を確かめる。
// 既定（0%・好きでない）では従来のエナジーと同じ、1個ごとの切り上げ、無補正比が補正で変わらないこと。
import assert from 'node:assert/strict';
import { berryEnergy, boostedEnergy, createEngine, mults } from '../checker/js/berry/calc.js';
import { MONS, PARAM_LIMITS } from '../checker/js/berry/constants.js';

let cases = 0;
const [bMin, bMax] = PARAM_LIMITS.fieldBonus;
for (const mon of Object.values(MONS)) for (const lv of [1, 50, 60, 70, 80, 100]) {
  const e = berryEnergy(mon.berryBase, lv);
  assert.equal(boostedEnergy(e, 0, false), e, `既定/${mon.name}/${lv}`);
  for (let b = bMin; b <= bMax; b++) for (const fav of [false, true]) {
    const v = boostedEnergy(e, b, fav);
    // 整数で、切り上げる前の値以上・切り上げ2回分（好きなきのみは2倍されるので最大3）未満。
    const raw = e * (1 + b / 100) * (fav ? 2 : 1);
    assert.ok(Number.isInteger(v) && v >= raw - 1e-9 && v < raw + (fav ? 3 : 1), `範囲/${mon.name}/${lv}/${b}/${fav}: ${v}`);
    cases++;
  }
}
// 浮動小数の誤差で切り上がらない（100 × 1.1 = 110.00000000000001 を111にしない）。
assert.equal(boostedEnergy(100, 10, false), 110);
assert.equal(boostedEnergy(100, 10, true), 220);
// 切り上げは1個ごと: 25 × 1.05 = 26.25 → 27、好きなら54。
assert.equal(boostedEnergy(25, 5, false), 27);
assert.equal(boostedEnergy(25, 5, true), 54);
cases += 4;

// 補正の比率 k は自分・チームへの効果・無補正の個体に同じだけ掛かるので、無補正比は補正なしと同じになる。
const engine = createEngine();
const subs = [['hb', 'spM', 'ingS'], ['berry', 'invL', 'erb']];
for (const mon of ['walrein', 'clefable', 'raichu']) for (const tap of ['none', '3h']) {
  const env = { lv: 60, N: 3, camp: true, mon, heal: 1, tap, team: true, healAmt: 18, healTimes: 3 };
  for (const e of subs) {
    const m = mults(e, 'speed', 'ing');
    const r = engine.daily(m, env);
    const k = boostedEnergy(r.energy, 75, true) / r.energy;
    const plain = ((r.day + r.night) * r.energy + engine.teamGain(m, env)) / engine.baseMetric(env);
    const boosted = ((r.day + r.night) * r.energy * k + engine.teamGain(m, env) * k) / (engine.baseMetric(env) * k);
    assert.ok(Math.abs(plain - boosted) <= 1e-12 * plain, `無補正比/${mon}/${tap}`);
    cases++;
  }
}
console.log(`${cases}ケース OK`);
