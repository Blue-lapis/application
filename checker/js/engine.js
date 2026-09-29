// 3タイプの計算エンジン（./*/calc.js）が共有する部品。DOM に触れない。
// 性格・サブスキルの倍率、げんきの推移とおてつだい回数、基礎値からの時間・確率・所持数、食材配列のパターン、上位%の分布。
// タイプごとの calc.js は「何を数えるか」だけを持つ。
import { WAKE_ENERGY, WAKE_ENERGY_ERB, NAT, LEVEL, slotWeights } from '../../js/constants.js';
import {
  energyCurve, helpsPerTap, helpTime, rateOf, subsetDist, sumSubs, mergeSame, SAME_REL, AWAKE_SEC, DAY_SEC, clearCurves,
} from '../../js/calc.js';
import { ENERGY_REC, EVO_CAP, TAP_EVERY as BERRY_TAP } from './berry/constants.js';
import { TAP_EVERY as ING_TAP } from './ingredient/constants.js';

const natMul = (up, down, key, hi, lo) => (up === key ? hi : 1) * (down === key ? lo : 1);

// e: サブスキル効果の合計 { sk, sp, inv, ing, berry, erb, hb }（subsetDist の要素と同じ形）。
// berry は1回のきのみおてつだいで拾う個数の、ポケモンの基礎値 berryBase に足す分（きのみの数S）。
// きのみタイプは基礎値をポケモンごとに prepare で足すので 0、食材・スキルタイプは 1 を渡す。
export function mk(e, up, down, berryBase = 0) {
  return {
    skillMul: natMul(up, down, 'skill', 1.2, 0.8) * (1 + e.sk),
    timeMul: natMul(up, down, 'speed', 0.9, 1.075) * (1 - Math.min(0.35, e.sp)),
    ingMul: natMul(up, down, 'ing', 1.2, 0.8) * (1 + e.ing),
    inv: e.inv,
    berry: berryBase + e.berry,
    wake: e.erb ? WAKE_ENERGY_ERB : WAKE_ENERGY,
    rec: up === 'energy' ? ENERGY_REC.up : down === 'energy' ? ENERGY_REC.down : 1,
    hb: !!e.hb,
  };
}

// 選んだサブスキルの ID と性格の補正から倍率を求める。
export const mults = (subs, up, down, berryBase = 0) => mk(sumSubs(subs), up, down, berryBase);

// 1日の発動回数が小数（2.5回など）のときは、その前後の整数回の日（2回と3回）が混ざるとみなし、
// それぞれの条件と割合 [env, 重み] を返す。整数ならその条件だけ。ヒーラーなし・常に81%以上では回数は効かない。
export function timesMix(env) {
  const t = env.healTimes;
  if (env.heal !== 1 || Number.isInteger(t)) return [[env, 1]];
  const lo = Math.floor(t), f = Math.round((t - lo) * 100) / 100;
  return [[{ ...env, healTimes: lo }, 1 - f], [{ ...env, healTimes: lo + 1 }, f]];
}
// 条件ごとの値 fn(env) を、timesMix の割合で平均する。
export const mixed = (env, fn) => timesMix(env).reduce((s, [e, w]) => s + w * fn(e), 0);

// げんきの推移。'g80' は常に81%以上（倍率0.45）として一定の値にする。
// wake は起床時のげんきの上限（げんき回復ボーナスで105）、rec は性格のげんき回復量の補正。
export function curveOf(env, wake, rec = 1) {
  if (env.heal === 'g80') return () => WAKE_ENERGY;
  return energyCurve(wake, env.heal * env.healTimes, env.healAmt, rec);
}

// 就寝時と起床直前のげんき（表示用）。発動回数が小数のときは前後の整数回の日の平均（整数に丸める）。
export function energyAt(env, wake, rec = 1) {
  const at = (t) => Math.round(mixed(env, (e) => curveOf(e, wake, rec)(t)));
  return { bed: at(AWAKE_SEC), end: at(DAY_SEC - 1) };
}

// 日中の受け取りの間隔（秒）。「なし」（きのみタイプ）と「常にタップ」（食材・スキルタイプ）は起床中を1区間にする。
const TAP_EVERY = { ...BERRY_TAP, ...ING_TAP };

// 1日のおてつだい回数を、所持品の受け取りで区切った区間ごとに返す（期待値なので小数）。
// awake は起床中の区間ごとの回数、sleep は睡眠中（所持数0から起床まで）の回数。起床中と睡眠中は別々に数える（にとよんツールと同じ）。
// 「3時間ごと」は起床中に3時間ごとと就寝時に受け取る。
// おてつだいのタイミングは所持数や確率に依存しないので、同じ条件の計算を使い回す。
// shape はタイプごとの区間の形に直す関数で、直した結果もタイプごとに使い回す。
const schedCaches = new Map();
export function scheduleOf(Te, env, wake, rec, shape) {
  if (!schedCaches.has(shape)) schedCaches.set(shape, new Map());
  const cache = schedCaches.get(shape);
  const k = `${Te}|${env.heal}|${env.healAmt}|${env.healTimes}|${env.tap}|${wake}|${rec}`;
  if (!cache.has(k)) {
    // げんき1以下は、げんき0と同じ倍率（1.0）で数える（にとよんツールと同じ）。
    const f = curveOf(env, wake, rec);
    const energy = (t) => (f(t) <= 1 ? 0 : f(t));
    const awake = helpsPerTap(Te, energy, 0, TAP_EVERY[env.tap] || AWAKE_SEC, AWAKE_SEC);
    const sleep = helpsPerTap(Te, energy, AWAKE_SEC, DAY_SEC - AWAKE_SEC, DAY_SEC - AWAKE_SEC).reduce((a, b) => a + b, 0);
    cache.set(k, shape(awake, sleep, env));
  }
  return cache.get(k);
}

// 区間と所持数の遷移のキャッシュを捨てる。Worker は分布を1つ計算するたびに呼び、メモリを増やし続けないようにする。
export function clearCaches() {
  schedCaches.clear();
  clearCurves();
}

// きのみタイプ・食材タイプの区間の形。区間ごとに [日中の回数, 睡眠中の回数] で、最後が睡眠中。
export const pairSegs = (awake, sleep) => [...awake.map((n) => [n, 0]), [0, sleep]];

// 基礎値と倍率から、計算に使うレベル・おてつだい時間（チケット込み Te）・食材確率・最大所持数を求める。
export function basics(mon, m, env) {
  const LV = LEVEL[env.N];
  const T = helpTime(mon.time, LV, m.timeMul);
  const Te = env.camp ? T / 1.2 : T;
  const ingP = rateOf(mon.ingP, m.ingMul);
  // 最終進化形は進化してきた個体とみなし、進化1回ごとに最大所持数が5増える（にとよんツールと同じ）。
  const cap0 = mon.cap + EVO_CAP * mon.evo + m.inv;
  const cap = env.camp ? Math.ceil(cap0 * 1.2) : cap0;
  return { LV, T, Te, ingP, cap };
}

// すべての食材配列について、各スロットで拾う個数と出現確率（各スロットの候補の確率は slotWeights）。
// 食材の種類を見ない計算（きのみタイプ・スキルタイプ）のため、個数の並びが同じ配列はまとめる。ポケモンごとに使い回す。
const patternCache = new WeakMap();
export function amountPatterns(mon) {
  if (!patternCache.has(mon)) {
    const all = mon.slots.reduce(
      (acc, opts) => acc.flatMap(({ amts, p }) => opts.map(([, a], k) => ({ amts: [...amts, a], p: p * slotWeights(opts.length)[k] }))),
      [{ amts: [], p: 1 }],
    );
    const out = new Map();
    for (const { amts, p } of all) {
      const k = amts.join(',');
      const o = out.get(k);
      if (o) o.p += p; else out.set(k, { amts, p });
    }
    patternCache.set(mon, [...out.values()]);
  }
  return patternCache.get(mon);
}

// 性格25種を、そのタイプの分類（natCat）で上昇・下降の組にまとめた [上昇, 下降, 確率]。
const natCache = new Map();
function natEntries(natCat) {
  if (!natCache.has(natCat)) {
    const count = {};
    NAT.forEach(([, u, d]) => {
      const k = `${natCat(u)}|${natCat(d)}`;
      count[k] = (count[k] || 0) + 1 / NAT.length;
    });
    natCache.set(natCat, Object.entries(count).map(([k, v]) => [...k.split('|'), v]));
  }
  return natCache.get(natCat);
}

// サブスキルの効果の組と確率。ignoreSkill ならスキル確率アップを無視して、それ以外の効果が同じ組をまとめる
// （スキル確率アップが効かないきのみタイプ・食材タイプ用）。
const groupCache = new Map();
function subGroups(N, ignoreSkill) {
  if (!ignoreSkill) return subsetDist(N);
  if (!groupCache.has(N)) {
    const subs = new Map();
    for (const { e, p } of subsetDist(N)) {
      const k = `${Math.min(0.35, e.sp).toFixed(4)}|${e.inv}|${e.ing.toFixed(4)}|${e.berry}|${e.erb}|${e.hb}`;
      const o = subs.get(k);
      if (o) o.p += p; else subs.set(k, { e, p });
    }
    groupCache.set(N, [...subs.values()]);
  }
  return groupCache.get(N);
}

// 上位%の分布。サブスキル（色別抽選・重複なし）と性格25種をすべて数え上げ、無補正比ごとの確率 [{ r, p }] を高い順に返す。
// ratios(e, up, down) は、その組み合わせの無補正比と重み [[比, 重み], ...] を返す（食材タイプは食材配列ごと）。
export function buildDist(N, natCat, ignoreSkill, ratios) {
  const nats = natEntries(natCat);
  const acc = new Map();
  for (const { e, p } of subGroups(N, ignoreSkill)) {
    for (const [u, d, v] of nats) {
      for (const [r, w] of ratios(e, u, d)) {
        const k = r.toFixed(9);
        acc.set(k, (acc.get(k) || 0) + p * v * w);
      }
    }
  }
  return mergeSame([...acc].map(([r, p]) => ({ r: +r, p })));
}

// 分布の上から i 行目までの確率の合計（cum[i]）。分布は高い順なので、同等以上の確率はこの累積になる。
const cumCache = new WeakMap();
function cumulative(dist) {
  if (!cumCache.has(dist)) {
    const cum = new Float64Array(dist.length + 1);
    dist.forEach((x, i) => { cum[i + 1] = cum[i] + x.p; });
    cumCache.set(dist, cum);
  }
  return cumCache.get(dist);
}
// 高い順の分布で、値が limit 以上（strict なら limit より大きい）の行の数。二分探索で数える。
function countAbove(dist, limit, strict) {
  let lo = 0, hi = dist.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strict ? dist[mid].r > limit : dist[mid].r >= limit) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// 条件ごとの分布を持ち、同等以上の確率と順位を返す。build(env) は分布を計算する。
// setDist で Worker が計算した分布（または保存してあった分布）を入れる。どちらも高い順に並んでいる。
export function distStore(envKey, build) {
  const cache = new Map();
  const dist = (env) => {
    const k = envKey(env);
    if (!cache.has(k)) cache.set(k, build(env));
    return cache.get(k);
  };
  return {
    dist,
    ready: (env) => cache.has(envKey(env)),
    setDist: (env, d) => { cache.set(envKey(env), d); },
    // 無補正比 r 以上（差が SAME_REL 以内は同じ）になる確率。
    atLeast: (r, env) => {
      const d = dist(env);
      return cumulative(d)[countAbove(d, r * (1 - SAME_REL), false)];
    },
    // 全パターン中の順位。分布は無補正比の値ごとに1行なので、自分より高い値の数 + 1。
    rankOf: (r, env) => {
      const d = dist(env);
      return { pos: 1 + countAbove(d, r * (1 + SAME_REL), true), total: d.length };
    },
  };
}
