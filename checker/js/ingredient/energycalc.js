// 食材タイプをエナジーで評価する計算エンジン（ver1.12）。DOM に触れない。
// 狙い食材の個数の計算エンジン（./calc.js）とは独立していて、そちらには手を入れない。
// おてつだい時間・げんき・おてつだい回数・所持数の遷移は、共通の部品（../../../js/calc.js・../engine.js）と
// ./calc.js の prepare・slotsOf・mults を読み込んで使うだけで、書き換えない。
//
// 評価の値 = すべての食材のエナジー（料理の倍率込み）＋ きのみのエナジー ＋ おてつだいボーナスによるチームへの効果。
// 無補正比は同じ食材配列の無補正個体で割り、上位%の分布も同じ食材配列の個体だけを母集団にする
// （食材配列の良し悪しは評価に入れず、サブスキル・性格だけを比べる）。
// 呼び出し側は env = { lv, N, camp, mon, by: 'energy', arr, heal, tap, team, healAmt, healTimes, recipeBonus, recipeLevel } を渡す。
// arr は開いている枠の食材配列（候補の番号をつないだ文字列。例 '012'）。
import { fillCurve, NO_SUBS } from '../../../js/calc.js';
import { mk as mkOf, mixed, timesMix, curveOf, energyAt, ingSlotsOf, buildDist, distStore } from '../engine.js';
import { TEAM_OTHERS, HB_SPEED } from '../berry/constants.js';
import { berryEnergy } from '../berry/calc.js';
import { MONS, natCat, allArrs } from './constants.js';
import { prepare, slotsOf, mults } from './calc.js';
import { ING_ENERGY, BERRY_BASE, BERRY_OF, recipeMul } from './energy.js';

export { mults };
// 食材タイプの berry は1回のきのみおてつだいで拾う個数（1＋きのみの数S）。./calc.js と同じ。
const mk = (e, up, down) => mkOf(e, up, down, 1);

// エナジーで評価する条件か。
export const byEnergy = (env) => !!env && env.by === 'energy';
// ポケモン mon のきのみの名前と、レベル LV のきのみ1個のエナジー。
export const berryOf = (mon, LV) => ({ name: BERRY_OF[mon], energy: berryEnergy(BERRY_BASE[BERRY_OF[mon]], LV) });
// 条件の料理の倍率。
export const recipeMulOf = (env) => recipeMul(env.recipeBonus, env.recipeLevel);
// 食材ごとの個数 { 食材名: 個数 } のエナジーの合計（料理の倍率 mul を掛ける）。
export const ingEnergy = (counts, mul = 1) => Object.entries(counts).reduce((s, [name, n]) => s + n * ING_ENERGY[name], 0) * mul;
// 条件の食材配列（文字列）を番号の配列にする。
export const arrOf = (env) => [...env.arr].map(Number);

// 所持数0から n 回（小数）おてつだいしたときに拾う、スロットごとの食材の期待個数 got、きのみの期待個数 berries、
// 満タンになる確率 full。./calc.js の segIngredients と同じ規則に、きのみ（満タン後のおてつだいはきのみ）を足したもの。
// c は所持数の遷移（共通の fillCurve）。回数が小数なら、前後の整数回の結果を小数部分の割合で混ぜる。
function segAll(c, n) {
  return c.cached('energy', n, () => {
    const lo = Math.floor(n), f = n - lo;
    c.upTo(lo + 1);
    const at = (j) => ({ got: c.got.map((xs) => xs[j]), berries: c.berries[j], full: 1 - c.open[j] });
    const a = at(lo);
    if (f < 1e-12) return a;
    const b = at(lo + 1);
    const mix = (x, y) => x + (y - x) * f;
    return { got: a.got.map((x, i) => mix(x, b.got[i])), berries: mix(a.berries, b.berries), full: mix(a.full, b.full) };
  });
}

// 1日の、スロットごとの食材の期待個数（日中 day・睡眠中 night）、きのみの期待個数（berryDay・berryNight）、
// 睡眠中に満タンになる確率 full、所持数からあふれて捨てた食材の個数 lost。食材は ./calc.js の runDay と同じ規則。
function runDay(r, env, berry, amts) {
  const day = amts.map(() => 0), night = amts.map(() => 0);
  let full = 0, lost = 0, berryDay = 0, berryNight = 0;
  const each = amts.map((a) => (r.ingP * a) / amts.length);
  const c = fillCurve(r.cap, r.ingP, berry, amts);
  r.segs.forEach(([ha, hs]) => {
    if (hs === 0 && env.tap === 'always') {
      each.forEach((x, i) => { day[i] += ha * x; });
      berryDay += ha * berry * (1 - r.ingP);
      return;
    }
    const n = hs > 0 ? hs : ha;
    const v = segAll(c, n);
    const to = hs > 0 ? night : day;
    v.got.forEach((x, i) => { to[i] += x; });
    if (hs > 0) berryNight += v.berries; else berryDay += v.berries;
    lost += each.reduce((s, x) => s + n * x, 0) - v.got.reduce((s, x) => s + x, 0);
    if (hs > 0) full = v.full;
  });
  return { day, night, full, lost, berryDay, berryNight };
}

// スロットごとの個数を食材ごとにまとめる { 食材名: 個数 }。
const byIngredient = (mon, slots, xs) => slots.reduce((o, [k], i) => {
  const name = mon.ings[k];
  o[name] = (o[name] || 0) + xs[i];
  return o;
}, {});

// 表示用の1日の値。./calc.js の daily と同じ値に、きのみの個数（berryDay・berryNight）と、きのみ berryInfo を足したもの。
export function daily(m, arr, env) {
  const mon = MONS[env.mon];
  const slots = slotsOf(mon, arr, ingSlotsOf(env));
  const amts = slots.map(([, a]) => a);
  const parts = timesMix(env).map(([e, w]) => {
    const r = prepare(m, e);
    return [{ ...r, ...runDay(r, e, m.berry, amts) }, w];
  });
  const avgOf = (f) => parts.reduce((s, [d, w]) => s + w * f(d), 0);
  return {
    ...parts[0][0],
    Ha: avgOf((d) => d.Ha), Hs: avgOf((d) => d.Hs), full: avgOf((d) => d.full), lost: avgOf((d) => d.lost),
    berryDay: avgOf((d) => d.berryDay), berryNight: avgOf((d) => d.berryNight), berry: m.berry,
    berryInfo: berryOf(env.mon, parts[0][0].LV),
    day: byIngredient(mon, slots, amts.map((_, i) => avgOf((d) => d.day[i]))),
    night: byIngredient(mon, slots, amts.map((_, i) => avgOf((d) => d.night[i]))),
    genki: energyAt(env, m.wake, m.rec), wakeE: Math.round(mixed(env, (e) => curveOf(e, m.wake, m.rec)(0))),
  };
}

export const envKey = (env) => [
  env.lv, env.N, env.camp, env.mon, 'energy', env.arr, env.heal, env.tap, env.team, env.healAmt, env.healTimes, env.recipeBonus, env.recipeLevel,
].join('|');

export function createEngine() {
  const metricCache = new Map();

  // 自分の1日のエナジー（すべての食材＋きのみ）。発動回数が小数のときは前後の整数回の日の割合で平均する。
  const metric = (m, arr, env) => mixed(env, (e) => metricOne(m, arr, e));
  function metricOne(m, arr, env) {
    const r = prepare(m, env);
    const key = `${envKey(env)}|${arr.slice(0, r.ingSlots).join('')}|${r.Te}|${r.ingP.toFixed(8)}|${r.cap}|${m.berry}|${m.wake}|${m.rec}`;
    if (!metricCache.has(key)) {
      const mon = MONS[env.mon];
      const slots = slotsOf(mon, arr, r.ingSlots);
      const d = runDay(r, env, m.berry, slots.map(([, a]) => a));
      const all = byIngredient(mon, slots, d.day.map((x, i) => x + d.night[i]));
      metricCache.set(key, ingEnergy(all, recipeMulOf(env)) + (d.berryDay + d.berryNight) * berryOf(env.mon, r.LV).energy);
    }
    return metricCache.get(key);
  }

  // 比較の基準は、同じ食材配列 arr の無補正個体（サブスキルなし・無補正性格）。
  // arr を渡さないとき（食材配列が決まっていないときの表示）は、無補正個体のうちエナジーが最も高い食材配列。
  function reference(env, arr) {
    const m = mk(NO_SUBS, null, null);
    if (arr && !arr.slice(0, ingSlotsOf(env)).includes(null)) {
      const a = arr.slice(0, ingSlotsOf(env));
      return { arr: a, v: metric(m, a, env) };
    }
    return allArrs(MONS[env.mon], ingSlotsOf(env))
      .map(({ arr: a }) => ({ arr: a, v: metric(m, a, env) }))
      .reduce((a, b) => (b.v > a.v ? b : a));
  }
  const baseMetric = (env, arr) => reference(env, arr).v;

  // ほかのメンバー TEAM_OTHERS 匹（同じポケモン・同じ食材配列・サブスキルなし・無補正性格）が、
  // おてつだいボーナスでおてつだいスピードが HB_SPEED 上がって増やすエナジーの合計。
  const gainCache = new Map();
  function teamGain(env, arr) {
    const ref = reference(env, arr);
    const k = `${envKey(env)}|${ref.arr.join('')}`;
    if (!gainCache.has(k)) gainCache.set(k, TEAM_OTHERS * (metric(mk({ ...NO_SUBS, sp: HB_SPEED }, null, null), ref.arr, env) - ref.v));
    return gainCache.get(k);
  }
  // チームへの効果。おてつだいボーナスを持たないか、含めない設定なら0。
  const team = (m, env, arr) => (env.team && m.hb ? teamGain(env, arr) : 0);
  // 順位の基準の値 = 自分のエナジー + チームへの効果。
  const value = (m, arr, env) => metric(m, arr, env) + team(m, env, arr);
  const score = (subs, up, down, arr, env) => value(mults(subs, up, down), arr, env) / baseMetric(env, arr);

  // 上位%の分布は、食材配列を env.arr に固定し、同じ食材配列の個体（サブスキル・性格）だけを数え上げる。
  // スキル確率アップは食材ときのみに影響しないので、それ以外の効果が同じ組み合わせをまとめる。
  const store = distStore(envKey, (env) => {
    const arr = arrOf(env), b = baseMetric(env, arr);
    return buildDist(env.N, natCat, true, (e, u, d) => [[value(mk(e, u, d), arr, env) / b, 1]], MONS[env.mon]);
  });

  return { metric, value, team, reference, baseMetric, score, daily, ...store };
}
