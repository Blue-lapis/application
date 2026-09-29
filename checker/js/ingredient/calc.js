// 食材タイプ向けの期待値計算エンジン。DOM に触れない。
// げんきの推移とおてつだい回数はきのみタイプと同じ規則（共通の energyCurve・helpsPerTap と、きのみタイプの curveOf・timesMix）を使う。
// 呼び出し側は env = { N, camp, mon, heal, tap, team, healAmt, healTimes } を渡す。mon は MONS のキー。
// heal・healAmt・healTimes はきのみタイプと共通の設定、tap は日中の受け取り（'always' / '3h'）、
// team はおてつだいボーナスのチームへの効果（ライチュウ4匹。./team.js）を含めるか。
import { WAKE_ENERGY, WAKE_ENERGY_ERB, NAT, byId, LEVEL, ING_ENERGY } from '../../../js/constants.js';
import { helpsPerTap, subsetDist, AWAKE_SEC, DAY_SEC, mergeSame, SAME_REL } from '../../../js/calc.js';
import { curveOf, timesMix, mixed, energyAt } from '../berry/calc.js';
import { EVO_CAP, ENERGY_REC } from '../berry/constants.js';
import { MONS, natCat, allArrs, TAP_EVERY } from './constants.js';
import { teamGain } from './team.js';

const natMul = (up, down, key, hi, lo) => (up === key ? hi : 1) * (down === key ? lo : 1);

// e: サブスキル効果の合計 { sp, inv, ing, berry, erb, hb }（subsetDist の要素と同じ形）
export function mk(e, up, down) {
  return {
    timeMul: natMul(up, down, 'speed', 0.9, 1.075) * (1 - Math.min(0.35, e.sp)),
    ingMul: natMul(up, down, 'ing', 1.2, 0.8) * (1 + e.ing),
    inv: e.inv,
    berry: 1 + e.berry,
    wake: e.erb ? WAKE_ENERGY_ERB : WAKE_ENERGY,
    rec: up === 'energy' ? ENERGY_REC.up : down === 'energy' ? ENERGY_REC.down : 1,
    hb: !!e.hb,
  };
}

export const NO_SUBS = { sk: 0, sp: 0, inv: 0, ing: 0, berry: 0, erb: false, hb: false };

export function mults(subs, up, down) {
  const e = subs.reduce((a, id) => {
    const s = byId[id];
    if (!s) return a;
    return {
      sk: a.sk, sp: a.sp + (s.speed || 0), inv: a.inv + (s.inv || 0), ing: a.ing + (s.ing || 0),
      berry: a.berry + (s.berry || 0), erb: a.erb || !!s.erb, hb: a.hb || id === 'hb',
    };
  }, NO_SUBS);
  return mk(e, up, down);
}

// 食材配列 arr の各スロットの [食材, 個数]。
export const slotsOf = (mon, arr) => arr.map((k, i) => mon.slots[i][k]);

// 1日のおてつだい回数を、所持品の受け取りで区切った区間ごとに [日中, 睡眠中] で返す（期待値なので小数）。
// 「常にタップ」は日中を1区間とし、所持数を見ない。「3時間ごと」は起床中に3時間ごとと就寝時に受け取る。
// 睡眠中は所持数0から起床まで。起床中と睡眠中は別々に数える（きのみタイプと同じ）。
const schedCache = new Map();
function scheduleOf(Te, env, wake, rec) {
  const k = `${Te}|${env.heal}|${env.healAmt}|${env.healTimes}|${env.tap}|${wake}|${rec}`;
  if (!schedCache.has(k)) {
    // げんき1以下は、げんき0と同じ倍率（1.0）で数える（きのみタイプと同じ）。
    const f = curveOf(env, wake, rec);
    const energy = (t) => (f(t) <= 1 ? 0 : f(t));
    const every = TAP_EVERY[env.tap] || AWAKE_SEC;
    const awake = helpsPerTap(Te, energy, 0, every, AWAKE_SEC);
    const sleep = helpsPerTap(Te, energy, AWAKE_SEC, DAY_SEC - AWAKE_SEC, DAY_SEC - AWAKE_SEC);
    schedCache.set(k, [...awake.map((n) => [n, 0]), [0, sleep.reduce((a, b) => a + b, 0)]]);
  }
  return schedCache.get(k);
}

export function prepare(m, env) {
  const mon = MONS[env.mon];
  const LV = LEVEL[env.N];
  const T = Math.floor(mon.time * (1 - (LV - 1) * 0.002) * m.timeMul);
  const Te = env.camp ? T / 1.2 : T;
  const ingP = Math.min(1, mon.ingP * m.ingMul);
  // 最終進化形は進化してきた個体とみなし、進化1回ごとに最大所持数が5増える（きのみタイプと同じ）。
  const cap0 = mon.cap + EVO_CAP * mon.evo + m.inv;
  const cap = env.camp ? Math.ceil(cap0 * 1.2) : cap0;
  const segs = scheduleOf(Te, env, m.wake, m.rec);
  const sum = (i) => segs.reduce((s, x) => s + x[i], 0);
  return { LV, T, Te, ingP, cap, segs, Ha: sum(0), Hs: sum(1) };
}

// 所持数0からおてつだいを重ねたときに拾う、スロットごとの食材の期待個数 got と、満タンになる確率 full を、
// 回数 lo と lo + 1 の両方について1回の計算で返す。
// 食材おてつだいは3スロットから均等に1つ選ぶ。それ以外はきのみ（berry 個）。狙い以外の食材も所持数を埋める。
// 所持数を超える分は捨てられ、満タンになった後のおてつだいでは何も増えない。
export function capIngredients(cap, lo, ingP, berry, amts) {
  let d = new Float64Array(cap), nx = new Float64Array(cap);
  d[0] = 1;
  const pa = ingP / amts.length;
  const got = amts.map(() => 0);
  let open = 1, at = null;
  for (let j = 0; j <= lo; j++) {
    if (j === lo) at = { got: [...got], full: 1 - open };
    if (open <= 0) continue;
    nx.fill(0);
    for (let c = 0; c < cap; c++) {
      const x = d[c];
      if (!x) continue;
      if (c + berry < cap) nx[c + berry] += x * (1 - ingP);
      for (let i = 0; i < amts.length; i++) {
        const a = amts[i];
        got[i] += x * pa * Math.min(a, cap - c);
        if (c + a < cap) nx[c + a] += x * pa;
      }
    }
    [d, nx] = [nx, d];
    open = d.reduce((s, x) => s + x, 0);
  }
  return [at, { got, full: 1 - open }];
}

// おてつだい回数が小数の区間は、前後の整数回の結果を小数部分の割合で混ぜる（きのみタイプと同じ）。
function segIngredients(cap, n, ingP, berry, amts) {
  const lo = Math.floor(n), f = n - lo;
  const [a, b] = capIngredients(cap, lo, ingP, berry, amts);
  if (f < 1e-12) return a;
  return { got: a.got.map((x, i) => x + (b.got[i] - x) * f), full: a.full + (b.full - a.full) * f };
}

// 1日の、スロットごとの食材の期待個数（日中 day・睡眠中 night）と、睡眠中に満タンになる確率 full、
// 所持数からあふれて捨てた食材の個数 lost。segOf は区間の計算をキャッシュする関数。
function runDay(r, env, berry, amts, segOf) {
  const day = amts.map(() => 0), night = amts.map(() => 0);
  let full = 0, lost = 0;
  const each = amts.map((a) => (r.ingP * a) / amts.length);
  r.segs.forEach(([ha, hs]) => {
    if (hs === 0 && env.tap === 'always') {
      each.forEach((x, i) => { day[i] += ha * x; });
      return;
    }
    const n = hs > 0 ? hs : ha;
    const v = segOf(n, berry, amts);
    const to = hs > 0 ? night : day;
    v.got.forEach((x, i) => { to[i] += x; });
    lost += each.reduce((s, x) => s + n * x, 0) - v.got.reduce((s, x) => s + x, 0);
    if (hs > 0) full = v.full;
  });
  return { day, night, full, lost };
}

// スロットごとの個数を食材ごとにまとめる { 食材名: 個数 }。
const byIngredient = (mon, slots, xs) => slots.reduce((o, [k], i) => {
  const name = mon.ings[k];
  o[name] = (o[name] || 0) + xs[i];
  return o;
}, {});
const energyOf = (ings) => Object.entries(ings).reduce((s, [name, n]) => s + n * ING_ENERGY[name], 0);

// 表示用の1日の値。発動回数が小数のときは、前後の整数回の日の割合で平均する。
// day・night は食材ごとの個数 { 食材名: 個数 }。
export function daily(m, arr, env) {
  const mon = MONS[env.mon];
  const slots = slotsOf(mon, arr);
  const amts = slots.map(([, a]) => a);
  const parts = timesMix(env).map(([e, w]) => {
    const r = prepare(m, e);
    const d = runDay(r, e, m.berry, amts, (n, b, as) => segIngredients(r.cap, n, r.ingP, b, as));
    return [{ ...r, ...d }, w];
  });
  const avgOf = (f) => parts.reduce((s, [d, w]) => s + w * f(d), 0);
  const day = byIngredient(mon, slots, amts.map((_, i) => avgOf((d) => d.day[i])));
  const night = byIngredient(mon, slots, amts.map((_, i) => avgOf((d) => d.night[i])));
  return {
    ...parts[0][0],
    Ha: avgOf((d) => d.Ha), Hs: avgOf((d) => d.Hs), full: avgOf((d) => d.full), lost: avgOf((d) => d.lost),
    day, night, dayEnergy: energyOf(day), nightEnergy: energyOf(night),
    genki: energyAt(env, m.wake, m.rec), wakeE: Math.round(mixed(env, (e) => curveOf(e, m.wake, m.rec)(0))),
  };
}

export const envKey = (env) => [env.N, env.camp, env.mon, env.heal, env.tap, env.team, env.healAmt, env.healTimes].join('|');

export function createEngine() {
  const metricCache = new Map();
  const segCache = new Map();
  const distCache = new Map();

  // 自分の食材のエナジー（食材ごとの個数 × 食材1個のエナジー）。発動回数が小数のときは前後の整数回の日の割合で平均する。
  const metric = (m, arr, env) => mixed(env, (e) => metricOne(m, arr, e));
  function metricOne(m, arr, env) {
    const r = prepare(m, env);
    const key = `${envKey(env)}|${arr.join('')}|${r.Te}|${r.ingP.toFixed(8)}|${r.cap}|${m.berry}|${m.wake}|${m.rec}`;
    if (!metricCache.has(key)) {
      const mon = MONS[env.mon];
      const slots = slotsOf(mon, arr);
      const segOf = (n, b, amts) => {
        const k = `${r.cap}|${n}|${r.ingP.toFixed(8)}|${b}|${amts.join(',')}`;
        if (!segCache.has(k)) segCache.set(k, segIngredients(r.cap, n, r.ingP, b, amts));
        return segCache.get(k);
      };
      const d = runDay(r, env, m.berry, slots.map(([, a]) => a), segOf);
      metricCache.set(key, energyOf(byIngredient(mon, slots, d.day.map((x, i) => x + d.night[i]))));
    }
    return metricCache.get(key);
  }

  // チームへの効果（ライチュウ4匹のきのみエナジーの増加分）。おてつだいボーナスを持たないか、含めない設定なら0。
  const team = (m, env) => (env.team && m.hb ? teamGain(env) : 0);
  // 順位の基準の値 = 自分の食材のエナジー + チームへの効果。
  const value = (m, arr, env) => metric(m, arr, env) + team(m, env);

  // 比較の基準は、無補正個体（サブスキルなし・無補正性格）のうち食材のエナジーが最も大きい食材配列。
  function reference(env) {
    const m = mk(NO_SUBS, null, null);
    return allArrs(MONS[env.mon])
      .map(({ arr }) => ({ arr, v: metric(m, arr, env) }))
      .reduce((a, b) => (b.v > a.v ? b : a));
  }
  const baseMetric = (env) => reference(env).v;
  const score = (subs, up, down, arr, env) => value(mults(subs, up, down), arr, env) / baseMetric(env);

  // 上位%の分布は、サブスキル・性格・食材配列（捕獲時の配列の確率 slotWeights）をすべて数え上げる。
  function buildDist(env) {
    const natCount = {};
    NAT.forEach(([, u, d]) => {
      const k = `${natCat(u)}|${natCat(d)}`;
      natCount[k] = (natCount[k] || 0) + 1 / NAT.length;
    });
    const natEntries = Object.entries(natCount).map(([k, v]) => [...k.split('|'), v]);

    // スキル確率アップは食材に影響しないので、それ以外の効果が同じ組み合わせをまとめる。
    const subs = new Map();
    for (const { e, p } of subsetDist(env.N)) {
      const k = `${Math.min(0.35, e.sp).toFixed(4)}|${e.inv}|${e.ing.toFixed(4)}|${e.berry}|${e.erb}|${!!e.hb}`;
      const o = subs.get(k);
      if (o) o.p += p; else subs.set(k, { e, p });
    }

    const arrs = allArrs(MONS[env.mon]);
    const b = baseMetric(env);
    const acc = new Map();
    for (const { e, p } of subs.values()) {
      for (const [u, d, v] of natEntries) {
        const m = mk(e, u, d);
        for (const a of arrs) {
          const k = (value(m, a.arr, env) / b).toFixed(9);
          acc.set(k, (acc.get(k) || 0) + p * v * a.p);
        }
      }
    }
    return mergeSame([...acc].map(([r, p]) => ({ r: +r, p })));
  }

  function dist(env) {
    const k = envKey(env);
    if (!distCache.has(k)) distCache.set(k, buildDist(env));
    return distCache.get(k);
  }

  const ready = (env) => distCache.has(envKey(env));
  const setDist = (env, d) => { distCache.set(envKey(env), d); };
  const atLeast = (r, env) => dist(env).reduce((a, x) => a + (x.r >= r * (1 - SAME_REL) ? x.p : 0), 0);

  return { metric, value, team, reference, baseMetric, score, dist, ready, setDist, atLeast, daily };
}
