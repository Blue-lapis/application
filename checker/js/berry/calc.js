// きのみタイプ向けの期待値計算エンジン。DOM に触れない。
// げんきの推移とおてつだい回数は共通の energyCurve・helpsPerTap（../../../js/calc.js）を使う。
// 呼び出し側は env = { N, camp, mon, heal, tap, team, healAmt, healTimes } を渡す。mon は MONS のキー。
// heal はヒーラーの数（0/1/2）か 'g80'（げんき常に81%以上）、tap は日中の受け取り（'none' / '3h'）、
// team はおてつだいボーナスのチームへの効果を含めるか。
import { WAKE_ENERGY, WAKE_ENERGY_ERB, NAT, byId, LEVEL } from '../../../js/constants.js';
import { energyCurve, helpsPerTap, helpTime, rateOf, subsetDist, AWAKE_SEC, DAY_SEC, mergeSame, SAME_REL } from '../../../js/calc.js';
import { MONS, natCat, amountPatterns, TAP_EVERY, TEAM_OTHERS, HB_SPEED, EVO_CAP, ENERGY_REC } from './constants.js';

const natMul = (up, down, key, hi, lo) => (up === key ? hi : 1) * (down === key ? lo : 1);

// e: サブスキル効果の合計 { sp, inv, ing, berry, erb, hb }（subsetDist の要素と同じ形）
// berry はきのみの数Sで増える個数。1回あたりの個数はポケモンの基礎値に足して prepare で決める。
export function mk(e, up, down) {
  return {
    timeMul: natMul(up, down, 'speed', 0.9, 1.075) * (1 - Math.min(0.35, e.sp)),
    ingMul: natMul(up, down, 'ing', 1.2, 0.8) * (1 + e.ing),
    inv: e.inv,
    berry: e.berry,
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

// 1日のおてつだい回数を、所持品の受け取りで区切った区間ごとに [日中, 睡眠中] で返す（期待値なので小数）。
// 「3時間ごと」は起床中に3時間ごとと就寝時に受け取り、睡眠は所持数0から始まる。
// 「なし」は区切らない（すべてきのみになるので区間は使わない）。起床中と睡眠中は別々に数える（にとよんツールと同じ）。
// おてつだいのタイミングはきのみの個数や食材確率に依存しないので、同じ条件の計算を使い回す。
const schedCache = new Map();
function scheduleOf(Te, env, wake, rec) {
  const k = `${Te}|${env.heal}|${env.healAmt}|${env.healTimes}|${env.tap}|${wake}|${rec}`;
  if (!schedCache.has(k)) {
    // げんき1以下は、げんき0と同じ倍率（1.0）で数える（にとよんツールと同じ）。
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
  const T = helpTime(mon.time, LV, m.timeMul);
  const Te = env.camp ? T / 1.2 : T;
  const ingP = rateOf(mon.ingP, m.ingMul);
  // 最終進化形は進化してきた個体とみなし、進化1回ごとに最大所持数が5増える（にとよんツールと同じ）。
  const cap0 = mon.cap + EVO_CAP * mon.evo + m.inv;
  const cap = env.camp ? Math.ceil(cap0 * 1.2) : cap0;
  const berry = mon.berries + m.berry;
  const energy = berryEnergy(mon.berryBase, LV);
  const segs = scheduleOf(Te, env, m.wake, m.rec);
  const sum = (i) => segs.reduce((s, x) => s + x[i], 0);
  return { LV, T, Te, ingP, cap, berry, energy, segs, Ha: sum(0), Hs: sum(1), noTap: env.tap === 'none' };
}

// 所持品を受け取ってから次に受け取るまで（日中 ha 回・睡眠中 hs 回のおてつだい）で拾うきのみと食材の期待個数。
// 受け取った時点で所持数0から始まる。
// 満タンになるまでは、食材確率で食材おてつだい（amts から均等に1つ選んだ個数）、それ以外はきのみおてつだい。
// 満タンになった後は食材確率に関係なくきのみだけを拾い、あふれたきのみはエナジーになる（いつのまに育成）。
// あふれた食材は捨てられる。
// きのみ = berry × (おてつだい回数 − 満タンになる前の食材おてつだい回数) になる。
export function dayBerries(cap, ha, hs, ingP, berry, amts) {
  let d = new Float64Array(cap), n = new Float64Array(cap);
  d[0] = 1;
  const pa = ingP / amts.length;
  let open = 1, day = 0, night = 0, ings = 0, fullBed = 0;
  for (let j = 0; j < ha + hs; j++) {
    const got = berry * (1 - ingP * open);
    if (j < ha) day += got; else night += got;
    if (j === ha) fullBed = 1 - open;
    // 満タン後も上のきのみ加算は同じ順序で続け、空の分布の更新だけ省く。
    if (open === 0) continue;
    n.fill(0);
    for (let c = 0; c < cap; c++) {
      const x = d[c];
      if (!x) continue;
      if (c + berry < cap) n[c + berry] += x * (1 - ingP);
      for (const a of amts) {
        ings += x * pa * Math.min(a, cap - c);
        if (c + a < cap) n[c + a] += x * pa;
      }
    }
    [d, n] = [n, d];
    open = d.reduce((s, x) => s + x, 0);
  }
  if (!hs) fullBed = 1 - open;
  return { day, night, ings, fullBed, full: 1 - open };
}

// レベル Lv のきのみ1個のエナジー。
export const berryEnergy = (base, lv) => Math.max(base + lv - 1, Math.round(base * 1.025 ** (lv - 1)));

// 1日を受け取りで区切った区間ごとに所持数0から追い、足し合わせる。
// 満タンになる確率は、fullBed が就寝時（就寝時に受け取るなら、その直前の区間の終わり）、full が起床時。
// 受け取りなしは一度も受け取らないので、所持数はずっと満タンで、すべてのおてつだいがきのみになる。
// 食材配列は入力しないので、配列ごとの値を出現確率で平均する。
function runDays(r, segOf) {
  if (r.noTap) return { day: r.berry * r.Ha, night: r.berry * r.Hs, ings: 0, fullBed: 1, full: 1 };
  const o = { day: 0, night: 0, ings: 0, fullBed: 0, full: 0 };
  const last = r.segs.length - 1;
  // 最後の区間が睡眠中だけなら、就寝時に受け取っている。
  const bedAt = last > 0 && r.segs[last][0] === 0 ? last - 1 : last;
  for (const { amts, p } of amountPatterns(MONS[r.mon])) {
    r.segs.forEach(([ha, hs], i) => {
      const v = segOf(ha, hs, amts);
      o.day += p * v.day;
      o.night += p * v.night;
      o.ings += p * v.ings;
      if (i === bedAt) o.fullBed += p * (i === last ? v.fullBed : v.full);
      if (i === last) o.full += p * v.full;
    });
  }
  return o;
}

// おてつだい回数が小数の区間は、前後の整数回の結果を小数部分の割合で混ぜる（にとよんツールと同じ）。
// 区間は日中だけか睡眠中だけなので、小数部分は回数のあるほうに付く。
export function segBerries(cap, ha, hs, ingP, berry, amts) {
  const n = hs > 0 ? hs : ha;
  const lo = Math.floor(n), f = n - lo;
  const at = (k) => dayBerries(cap, hs > 0 ? ha : k, hs > 0 ? k : 0, ingP, berry, amts);
  if (f < 1e-12) return at(lo);
  const a = at(lo), b = at(lo + 1);
  return Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b[k] - a[k]) * f]));
}

// 就寝時と起床直前のげんき（表示用）。発動回数が小数のときは前後の整数回の日の平均（整数に丸める）。
export function energyAt(env, wake, rec = 1) {
  const at = (t) => Math.round(mixed(env, (e) => curveOf(e, wake, rec)(t)));
  return { bed: at(AWAKE_SEC), end: at(DAY_SEC - 1) };
}

// 表示用の1日の値。発動回数が小数のときは、回数に関係する値を前後の整数回の日の割合で平均する。
const MIXED_KEYS = ['day', 'night', 'ings', 'fullBed', 'full', 'Ha', 'Hs'];
export function daily(m, env) {
  const parts = timesMix(env).map(([e, w]) => [dailyOne(m, e), w]);
  const out = { ...parts[0][0], genki: energyAt(env, m.wake, m.rec), wakeE: Math.round(mixed(env, (e) => curveOf(e, m.wake, m.rec)(0))) };
  MIXED_KEYS.forEach((k) => { out[k] = parts.reduce((s, [d, w]) => s + w * d[k], 0); });
  return out;
}

function dailyOne(m, env) {
  const r = { ...prepare(m, env), mon: env.mon };
  const days = new Map();
  const d = runDays(r, (ha, hs, amts) => {
    const key = `${ha}|${hs}|${amts.join(',')}`;
    if (!days.has(key)) days.set(key, segBerries(r.cap, ha, hs, r.ingP, r.berry, amts));
    return days.get(key);
  });
  return { ...r, ...d };
}

export const envKey = (env) => [env.N, env.camp, env.mon, env.heal, env.tap, env.team, env.healAmt, env.healTimes].join('|');

export function createEngine() {
  const metricCache = new Map();
  const dayCache = new Map();
  const distCache = new Map();

  // 自分のきのみのエナジー（きのみ1個のエナジー × 個数）。発動回数が小数のときは前後の整数回の日の割合で平均する。
  const metric = (m, env) => mixed(env, (e) => metricOne(m, e));
  function metricOne(m, env) {
    const r = { ...prepare(m, env), mon: env.mon };
    const key = `${envKey(env)}|${r.Te}|${r.ingP.toFixed(8)}|${r.cap}|${r.berry}|${m.wake}|${m.rec}`;
    if (!metricCache.has(key)) {
      const segOf = (ha, hs, amts) => {
        const k = `${env.mon}|${r.cap}|${ha}|${hs}|${r.ingP.toFixed(8)}|${r.berry}|${amts.join(',')}`;
        if (!dayCache.has(k)) dayCache.set(k, segBerries(r.cap, ha, hs, r.ingP, r.berry, amts));
        return dayCache.get(k);
      };
      const d = runDays(r, segOf);
      metricCache.set(key, (d.day + d.night) * r.energy);
    }
    return metricCache.get(key);
  }

  // 比較の基準は無補正個体（サブスキルなし・無補正性格、食材配列は全パターンの平均）。
  const baseMetric = (env) => metric(mk(NO_SUBS, null, null), env);

  // おてつだいボーナスによる、ほかのメンバー1匹のエナジーの増加分。
  // ほかのメンバーは同じポケモン・サブスキルなし・無補正性格で、おてつだいスピードが HB_SPEED だけ上がる。
  const memberGain = (env) => metric(mk({ ...NO_SUBS, sp: HB_SPEED }, null, null), env) - baseMetric(env);
  // チームへの効果（ほかの TEAM_OTHERS 匹の増加分の合計）。おてつだいボーナスを持たないか、含めない設定なら0。
  const teamGain = (m, env) => (env.team && m.hb ? TEAM_OTHERS * memberGain(env) : 0);
  // 順位の基準の値 = 自分のきのみのエナジー + チームへの効果。
  const value = (m, env) => metric(m, env) + teamGain(m, env);
  const score = (subs, up, down, env) => value(mults(subs, up, down), env) / baseMetric(env);

  // 上位%の分布は、サブスキル（色別抽選・重複なし）と性格25種をすべて数え上げる。
  function buildDist(env) {
    const natCount = {};
    NAT.forEach(([, u, d]) => {
      const k = `${natCat(u)}|${natCat(d)}`;
      natCount[k] = (natCount[k] || 0) + 1 / NAT.length;
    });
    const natEntries = Object.entries(natCount).map(([k, v]) => [...k.split('|'), v]);

    // スキル確率アップはきのみに影響しないので、それ以外の効果が同じ組み合わせをまとめる。
    const subs = new Map();
    for (const { e, p } of subsetDist(env.N)) {
      const k = `${Math.min(0.35, e.sp).toFixed(4)}|${e.inv}|${e.ing.toFixed(4)}|${e.berry}|${e.erb}|${e.hb}`;
      const o = subs.get(k);
      if (o) o.p += p; else subs.set(k, { e, p });
    }

    const b = baseMetric(env);
    const acc = new Map();
    for (const { e, p } of subs.values()) {
      for (const [u, d, v] of natEntries) {
        const k = (value(mk(e, u, d), env) / b).toFixed(9);
        acc.set(k, (acc.get(k) || 0) + p * v);
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

  return { metric, baseMetric, teamGain, value, score, dist, ready, setDist, atLeast, daily };
}
