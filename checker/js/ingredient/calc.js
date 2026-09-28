// 食材タイプ向けの期待値計算エンジン。DOM に触れない。
// おてつだいのタイミング（げんき・日またぎ）は共通の schedule（../../../js/calc.js）を使う。
// 呼び出し側は env = { N, camp, g80, mon, target } を渡す。mon は MONS のキー、target は狙う食材（'A' など）。
import { WAKE_ENERGY, WAKE_ENERGY_ERB, NAT, byId, LEVEL } from '../../../js/constants.js';
import { schedule, subsetDist } from '../../../js/calc.js';
import { MONS, natCat, allArrs } from './constants.js';

const natMul = (up, down, key, hi, lo) => (up === key ? hi : 1) * (down === key ? lo : 1);

// e: サブスキル効果の合計 { sp, inv, ing, berry, erb }（subsetDist の要素と同じ形）
export function mk(e, up, down) {
  return {
    timeMul: natMul(up, down, 'speed', 0.9, 1.075) * (1 - Math.min(0.35, e.sp)),
    ingMul: natMul(up, down, 'ing', 1.2, 0.8) * (1 + e.ing),
    inv: e.inv,
    berry: 1 + e.berry,
    wake: e.erb ? WAKE_ENERGY_ERB : WAKE_ENERGY,
  };
}

export const NO_SUBS = { sk: 0, sp: 0, inv: 0, ing: 0, berry: 0, erb: false };

export function mults(subs, up, down) {
  const e = subs.reduce((a, id) => {
    const s = byId[id];
    if (!s) return a;
    return {
      sk: a.sk, sp: a.sp + (s.speed || 0), inv: a.inv + (s.inv || 0), ing: a.ing + (s.ing || 0),
      berry: a.berry + (s.berry || 0), erb: a.erb || !!s.erb,
    };
  }, NO_SUBS);
  return mk(e, up, down);
}

// 食材配列 arr の各スロットの [食材, 個数]。
export const slotsOf = (mon, arr) => arr.map((k, i) => mon.slots[i][k]);

// おてつだいのタイミングは食材配列や食材確率に依存しないので、同じ条件の計算を使い回す。
const schedCache = new Map();
function scheduleOf(Te, g80, wake) {
  const k = `${Te}|${g80}|${wake}`;
  if (!schedCache.has(k)) schedCache.set(k, schedule(Te, g80, wake));
  return schedCache.get(k);
}

export function prepare(m, env) {
  const mon = MONS[env.mon];
  const LV = LEVEL[env.N];
  const T = Math.floor(mon.time * (1 - (LV - 1) * 0.002) * m.timeMul);
  const Te = env.camp ? T / 1.2 : T;
  const ingP = Math.min(1, mon.ingP * m.ingMul);
  const cap0 = mon.cap + m.inv;
  const cap = env.camp ? Math.ceil(cap0 * 1.2) : cap0;
  return { T, Te, ingP, cap, ...scheduleOf(Te, env.g80, m.wake) };
}

// 睡眠中 hs 回のおてつだいで持ち帰れる食材の期待個数（狙い食材 got・全食材 all）。
// 所持数は睡眠開始時に0。食材おてつだいは3スロットから均等に1つ選ぶ。狙い以外の食材も所持数を埋める。
// 所持数を超える分は捨てられ、満タンになった後のおてつだいでは何も増えない。
export function nightIngredients(cap, hs, ingP, berry, slots, target) {
  let d = new Float64Array(cap), n = new Float64Array(cap);
  d[0] = 1;
  const pa = ingP / slots.length;
  let got = 0, all = 0, open = 1;
  for (let j = 0; j < hs; j++) {
    n.fill(0);
    for (let c = 0; c < cap; c++) {
      const x = d[c];
      if (!x) continue;
      if (c + berry < cap) n[c + berry] += x * (1 - ingP);
      for (const [ing, a] of slots) {
        const add = x * pa * Math.min(a, cap - c);
        all += add;
        if (ing === target) got += add;
        if (c + a < cap) n[c + a] += x * pa;
      }
    }
    [d, n] = [n, d];
    open = d.reduce((s, x) => s + x, 0);
    if (open === 0) break;
  }
  return { got, all, full: 1 - open };
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const perHelp = (slots, pick) => slots.reduce((s, [ing, a]) => s + (pick(ing) ? a : 0), 0) / slots.length;

// 日中は常にタップするので所持数はあふれない。捨て日のあとの日ごとの値を平均する。
function runDays(r, slots, target, nightOf) {
  const A = perHelp(slots, (ing) => ing === target);
  const Aall = perHelp(slots, () => true);
  const o = { day: 0, night: 0, dayAll: 0, nightAll: 0, full: 0 };
  r.Ha.forEach((ha, k) => {
    const nt = nightOf(r.Hs[k]);
    o.day += ha * r.ingP * A;
    o.dayAll += ha * r.ingP * Aall;
    o.night += nt.got;
    o.nightAll += nt.all;
    o.full += nt.full;
  });
  Object.keys(o).forEach((k) => { o[k] /= r.Ha.length; });
  return o;
}

export function daily(m, arr, env) {
  const r = prepare(m, env);
  const slots = slotsOf(MONS[env.mon], arr);
  // 同じおてつだい回数の日は、この表示計算内で夜間の結果を共有する。
  const nights = new Map();
  const nightOf = (hs) => {
    if (!nights.has(hs)) nights.set(hs, nightIngredients(r.cap, hs, r.ingP, m.berry, slots, env.target));
    return nights.get(hs);
  };
  const d = runDays(r, slots, env.target, nightOf);
  const uncapped = avg(r.Hs) * r.ingP * perHelp(slots, () => true);
  return { ...r, ...d, lost: uncapped - d.nightAll, Ha: avg(r.Ha), Hs: avg(r.Hs) };
}

export const envKey = (env) => `${env.N}|${env.camp}|${env.g80}|${env.mon}|${env.target}`;

export function createEngine() {
  const metricCache = new Map();
  const distCache = new Map();

  function metric(m, arr, env) {
    const r = prepare(m, env);
    const key = `${envKey(env)}|${arr.join('')}|${r.Te}|${r.ingP.toFixed(8)}|${r.cap}|${m.berry}|${m.wake}`;
    if (!metricCache.has(key)) {
      const slots = slotsOf(MONS[env.mon], arr);
      const nights = new Map();
      const nightOf = (hs) => {
        if (!nights.has(hs)) nights.set(hs, nightIngredients(r.cap, hs, r.ingP, m.berry, slots, env.target));
        return nights.get(hs);
      };
      const d = runDays(r, slots, env.target, nightOf);
      metricCache.set(key, d.day + d.night);
    }
    return metricCache.get(key);
  }

  // 比較の基準は、無補正個体（サブスキルなし・無補正性格）のうち狙い食材が最も多く取れる食材配列。
  function reference(env) {
    const m = mk(NO_SUBS, null, null);
    return allArrs(MONS[env.mon])
      .map(({ arr }) => ({ arr, v: metric(m, arr, env) }))
      .reduce((a, b) => (b.v > a.v ? b : a));
  }
  const baseMetric = (env) => reference(env).v;
  const score = (subs, up, down, arr, env) => metric(mults(subs, up, down), arr, env) / baseMetric(env);

  // 上位%の分布は、サブスキル・性格・食材配列（各スロット等確率）をすべて数え上げる。
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
      const k = `${Math.min(0.35, e.sp).toFixed(4)}|${e.inv}|${e.ing.toFixed(4)}|${e.berry}|${e.erb}`;
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
          const k = (metric(m, a.arr, env) / b).toFixed(9);
          acc.set(k, (acc.get(k) || 0) + p * v * a.p);
        }
      }
    }
    return [...acc].map(([r, p]) => ({ r: +r, p }));
  }

  function dist(env) {
    const k = envKey(env);
    if (!distCache.has(k)) distCache.set(k, buildDist(env));
    return distCache.get(k);
  }

  const ready = (env) => distCache.has(envKey(env));
  const setDist = (env, d) => { distCache.set(envKey(env), d); };
  const atLeast = (r, env) => dist(env).reduce((a, x) => a + (x.r >= r * (1 - 1e-7) ? x.p : 0), 0);

  return { metric, reference, baseMetric, score, dist, ready, setDist, atLeast, daily };
}
