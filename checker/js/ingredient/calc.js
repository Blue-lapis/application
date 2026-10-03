// 食材タイプ向けの期待値計算エンジン。DOM に触れない。
// 倍率・げんきの推移・おてつだい回数・分布の数え上げは共通の部品（../engine.js）を使う。
// 呼び出し側は env = { lv, N, camp, mon, target, heal, tap, team, healAmt, healTimes } を渡す。lv はレベル、N はサブスキルの枠の数、
// mon は MONS のキー、target は狙う食材（'A' など）。
// heal・healAmt・healTimes はきのみタイプと共通の設定、tap は日中の受け取り（'always' / '3h'）、
// team はおてつだいボーナスのチームへの効果（同じポケモン4匹の狙い食材の増加）を含めるか。
// by: 'energy' のときは、狙い食材の個数の代わりに、すべての食材ときのみのエナジーの合計で評価する（ver1.12）。
// このとき target は使わない（条件にも入れない）。
import { fillCurve, NO_SUBS } from '../../../js/calc.js';
import { mk as mkOf, mults as multsOf, mixed, timesMix, curveOf, energyAt, scheduleOf, pairSegs, basics, ingSlotsOf, buildDist, distStore } from '../engine.js';
import { TEAM_OTHERS, HB_SPEED } from '../berry/constants.js';
import { berryEnergy } from '../berry/calc.js';
import { MONS, natCat, allArrs } from './constants.js';
import { ING_ENERGY, BERRY_BASE, BERRY_OF } from './energy.js';

// エナジーで評価する条件か。
export const byEnergy = (env) => env.by === 'energy';
// ポケモン mon のきのみの名前と、レベル LV のきのみ1個のエナジー。
export const berryOf = (mon, LV) => ({ name: BERRY_OF[mon], energy: berryEnergy(BERRY_BASE[BERRY_OF[mon]], LV) });

// 食材タイプの berry は1回のきのみおてつだいで拾う個数（1＋きのみの数S）。
const mk = (e, up, down) => mkOf(e, up, down, 1);
export const mults = (subs, up, down) => multsOf(subs, up, down, 1);

// 食材配列 arr の、開いている k 枠の [食材, 個数]（Lv.50 は Lv.60 の枠がまだ開いていないので2枠）。
export const slotsOf = (mon, arr, k = arr.length) => arr.slice(0, k).map((x, i) => mon.slots[i][x]);

// 1日のおてつだい回数を、所持品の受け取りで区切った区間ごとに [日中, 睡眠中] で返す（期待値なので小数）。
// 「常にタップ」は日中を1区間とし、所持数を見ない。「3時間ごと」は起床中に3時間ごとと就寝時に受け取る。

export function prepare(m, env) {
  const b = basics(MONS[env.mon], m, env);
  const segs = scheduleOf(b.Te, env, m.wake, m.rec, pairSegs);
  const sum = (i) => segs.reduce((s, x) => s + x[i], 0);
  return { ...b, segs, Ha: sum(0), Hs: sum(1) };
}

// 所持数0から n 回（小数）おてつだいしたときに拾う、スロットごとの食材の期待個数 got、きのみの期待個数 berries と、満タンになる確率 full。
// 満タンになった後のおてつだいはきのみになる（きのみタイプと同じ）。
// 食材おてつだいは開いている枠から均等に1つ選ぶ。それ以外はきのみ。狙い以外の食材も所持数を埋める。
// 所持数を超える分は捨てられ、満タンになった後のおてつだいでは何も増えない。
// c は所持数の遷移（共通の fillCurve）。回数が小数なら、前後の整数回の結果を小数部分の割合で混ぜる（きのみタイプと同じ）。
function segIngredients(c, n) {
  return c.cached('ing', n, () => {
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

// 1日の、スロットごとの食材の期待個数（日中 day・睡眠中 night）と、睡眠中に満タンになる確率 full、
// 所持数からあふれて捨てた食材の個数 lost、きのみの期待個数（日中 berryDay・睡眠中 berryNight）。
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
    const v = segIngredients(c, n);
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

// 表示用の1日の値。発動回数が小数のときは、前後の整数回の日の割合で平均する。
// day・night は食材ごとの個数 { 食材名: 個数 }。
export function daily(m, arr, env) {
  const mon = MONS[env.mon];
  const slots = slotsOf(mon, arr, ingSlotsOf(env));
  const amts = slots.map(([, a]) => a);
  const parts = timesMix(env).map(([e, w]) => {
    const r = prepare(m, e);
    const d = runDay(r, e, m.berry, amts);
    return [{ ...r, ...d }, w];
  });
  const avgOf = (f) => parts.reduce((s, [d, w]) => s + w * f(d), 0);
  const day = byIngredient(mon, slots, amts.map((_, i) => avgOf((d) => d.day[i])));
  const night = byIngredient(mon, slots, amts.map((_, i) => avgOf((d) => d.night[i])));
  return {
    ...parts[0][0],
    Ha: avgOf((d) => d.Ha), Hs: avgOf((d) => d.Hs), full: avgOf((d) => d.full), lost: avgOf((d) => d.lost),
    berryDay: avgOf((d) => d.berryDay), berryNight: avgOf((d) => d.berryNight), berry: m.berry,
    berryInfo: berryOf(env.mon, parts[0][0].LV),
    day, night,
    genki: energyAt(env, m.wake, m.rec), wakeE: Math.round(mixed(env, (e) => curveOf(e, m.wake, m.rec)(0))),
  };
}

// 食材ごとの個数 { 食材名: 個数 } のエナジーの合計。
export const ingEnergy = (counts) => Object.entries(counts).reduce((s, [name, n]) => s + n * ING_ENERGY[name], 0);

// エナジーで評価する条件は狙い食材を使わないので、キーにも入れない（狙い食材を変えても同じ分布を使う）。
export const envKey = (env) => (byEnergy(env)
  ? [env.lv, env.N, env.camp, env.mon, 'energy', env.heal, env.tap, env.team, env.healAmt, env.healTimes]
  : [env.lv, env.N, env.camp, env.mon, env.target, env.heal, env.tap, env.team, env.healAmt, env.healTimes]).join('|');

export function createEngine() {
  const metricCache = new Map();

  // 自分の狙い食材の1日の個数（エナジーで評価するときは、すべての食材ときのみの1日のエナジー）。
  // 発動回数が小数のときは前後の整数回の日の割合で平均する。
  const metric = (m, arr, env) => mixed(env, (e) => metricOne(m, arr, e));
  function metricOne(m, arr, env) {
    const r = prepare(m, env);
    const key = `${envKey(env)}|${arr.slice(0, r.ingSlots).join('')}|${r.Te}|${r.ingP.toFixed(8)}|${r.cap}|${m.berry}|${m.wake}|${m.rec}`;
    if (!metricCache.has(key)) {
      const mon = MONS[env.mon];
      const slots = slotsOf(mon, arr, r.ingSlots);
      const d = runDay(r, env, m.berry, slots.map(([, a]) => a));
      const all = byIngredient(mon, slots, d.day.map((x, i) => x + d.night[i]));
      metricCache.set(key, byEnergy(env)
        ? ingEnergy(all) + (d.berryDay + d.berryNight) * berryOf(env.mon, r.LV).energy
        : all[mon.ings[env.target]] || 0);
    }
    return metricCache.get(key);
  }

  // 比較の基準は、無補正個体（サブスキルなし・無補正性格）のうち狙い食材が最も多く取れる食材配列（狙いが A なら AAA）。
  // エナジーで評価するときは、無補正個体のうちエナジーが最も高い食材配列。
  // 配列は開いている枠の分だけ（Lv.50 なら AA）。
  function reference(env) {
    const m = mk(NO_SUBS, null, null);
    return allArrs(MONS[env.mon], ingSlotsOf(env))
      .map(({ arr }) => ({ arr, v: metric(m, arr, env) }))
      .reduce((a, b) => (b.v > a.v ? b : a));
  }
  const baseMetric = (env) => reference(env).v;

  // ほかのメンバー TEAM_OTHERS 匹（同じポケモン・基準の食材配列・サブスキルなし・無補正性格）が、
  // おてつだいボーナスでおてつだいスピードが HB_SPEED 上がって増やす狙い食材の個数（エナジーで評価するときはエナジー）の合計。
  const gainCache = new Map();
  function teamGain(env) {
    const k = envKey(env);
    if (!gainCache.has(k)) {
      const arr = reference(env).arr;
      gainCache.set(k, TEAM_OTHERS * (metric(mk({ ...NO_SUBS, sp: HB_SPEED }, null, null), arr, env) - baseMetric(env)));
    }
    return gainCache.get(k);
  }
  // チームへの効果。おてつだいボーナスを持たないか、含めない設定なら0。
  const team = (m, env) => (env.team && m.hb ? teamGain(env) : 0);
  // 順位の基準の値 = 自分の狙い食材の個数 + チームへの効果。
  const value = (m, arr, env) => metric(m, arr, env) + team(m, env);
  const score = (subs, up, down, arr, env) => value(mults(subs, up, down), arr, env) / baseMetric(env);

  // 上位%の分布は、サブスキル・性格・食材配列（捕獲時の配列の確率 slotWeights）をすべて数え上げる。
  // スキル確率アップは食材に影響しないので、それ以外の効果が同じ組み合わせをまとめる。
  const store = distStore(envKey, (env) => {
    const arrs = allArrs(MONS[env.mon], ingSlotsOf(env));
    const b = baseMetric(env);
    return buildDist(env.N, natCat, true, (e, u, d) => {
      const m = mk(e, u, d);
      return arrs.map((a) => [value(m, a.arr, env) / b, a.p]);
    }, MONS[env.mon]);
  });

  return { metric, value, team, reference, baseMetric, score, daily, ...store };
}
