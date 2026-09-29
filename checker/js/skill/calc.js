// スキルタイプ向けの期待値計算エンジン。DOM に触れない。
// げんきの推移とおてつだい回数はきのみタイプ・食材タイプと同じ規則（共通の energyCurve・helpsPerTap と、きのみタイプの curveOf・timesMix）を使い、
// 共通の計算（../../../js/calc.js の抽選回数・ストックの発動回数）を、ポケモンごとの基礎値・天井・食材の個数で使う。
// スキルの数え方はにとよんツールと同じ（天井込みの実質確率で抽選し、満タン後は抽選しない）。
// 呼び出し側は env = { N, camp, mon, heal, tap, team, healAmt, healTimes } を渡す。
// heal・healAmt・healTimes・team はきのみタイプと共通、tap は日中の受け取り（'always' / '3h'、食材タイプと共通）。
import { WAKE_ENERGY, WAKE_ENERGY_ERB, NAT, byId, LEVEL } from '../../../js/constants.js';
import { helpsPerTap, helpTime, rateOf, eff, segRolls, stockSkills, subsetDist, mergeSame, SAME_REL, AWAKE_SEC, DAY_SEC } from '../../../js/calc.js';
import { curveOf, timesMix, mixed, energyAt } from '../berry/calc.js';
import { EVO_CAP, ENERGY_REC, TEAM_OTHERS, HB_SPEED } from '../berry/constants.js';
import { MONS, natCat, ceilOf, amountPatterns, TAP_EVERY } from './constants.js';

const natMul = (up, down, key, hi, lo) => (up === key ? hi : 1) * (down === key ? lo : 1);

// e: サブスキル効果の合計 { sk, sp, inv, ing, berry, erb, hb }（subsetDist の要素と同じ形）
export function mk(e, up, down) {
  return {
    skillMul: natMul(up, down, 'skill', 1.2, 0.8) * (1 + e.sk),
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
      sk: a.sk + (s.skill || 0), sp: a.sp + (s.speed || 0), inv: a.inv + (s.inv || 0), ing: a.ing + (s.ing || 0),
      berry: a.berry + (s.berry || 0), erb: a.erb || !!s.erb, hb: a.hb || id === 'hb',
    };
  }, NO_SUBS);
  return mk(e, up, down);
}

// 1日のおてつだい回数を、所持品の受け取りで区切った区間ごとに { night, tap, n } で返す（期待値なので小数）。
// 「常にタップ」は日中を1区間とし、所持数を見ない。「3時間ごと」は起床中に3時間ごとと就寝時に受け取る。
// 睡眠中は所持数0から起床まで。起床中と睡眠中は別々に数える（食材タイプと同じ）。
const schedCache = new Map();
function scheduleOf(Te, env, wake, rec) {
  const k = `${Te}|${env.heal}|${env.healAmt}|${env.healTimes}|${env.tap}|${wake}|${rec}`;
  if (!schedCache.has(k)) {
    // げんき1以下は、げんき0と同じ倍率（1.0）で数える（きのみタイプと同じ）。
    const f = curveOf(env, wake, rec);
    const energy = (t) => (f(t) <= 1 ? 0 : f(t));
    const tap = env.tap !== '3h';
    const awake = helpsPerTap(Te, energy, 0, TAP_EVERY[env.tap] || AWAKE_SEC, AWAKE_SEC);
    const sleep = helpsPerTap(Te, energy, AWAKE_SEC, DAY_SEC - AWAKE_SEC, DAY_SEC - AWAKE_SEC);
    schedCache.set(k, [...awake.map((n) => ({ night: false, tap, n })), { night: true, tap: false, n: sleep.reduce((a, b) => a + b, 0) }]);
  }
  return schedCache.get(k);
}

export function prepare(m, env) {
  const mon = MONS[env.mon];
  const LV = LEVEL[env.N];
  const T = helpTime(mon.time, LV, m.timeMul);
  const Te = env.camp ? T / 1.2 : T;
  const p = rateOf(mon.skillP, m.skillMul);
  const ingP = rateOf(mon.ingP, m.ingMul);
  // 最終進化形は進化してきた個体とみなし、進化1回ごとに最大所持数が5増える（きのみタイプと同じ）。
  const cap0 = mon.cap + EVO_CAP * mon.evo + m.inv;
  const cap = env.camp ? Math.ceil(cap0 * 1.2) : cap0;
  const segs = scheduleOf(Te, env, m.wake, m.rec);
  const sum = (night) => segs.reduce((s, x) => s + (x.night === night ? x.n : 0), 0);
  return { LV, T, Te, p, ingP, cap, ceil: ceilOf(mon), segs, Ha: sum(false), Hs: sum(true) };
}

// 1日の期待発動回数。天井込みの実質確率 pe = eff(p, ceil) で抽選する。
// 常にタップする日中の区間は、おてつだい n 回（小数）のすべてで抽選する（n × pe）。
// それ以外の区間（3時間ごとの受け取りの区間と睡眠中）は所持数0から追い、ストックは2回まで（stockSkills）。
// rolls は区間の segRolls の結果。
function daySkills(r, segs) {
  const pe = eff(r.p, r.ceil);
  const o = { day: 0, night: 0, rolls: 0, full: 0 };
  for (const s of segs) {
    if (s.tap) { o.day += s.n * pe; continue; }
    const got = stockSkills(pe, s.rolls.P);
    if (s.night) {
      o.night += got;
      o.rolls = s.rolls.P.reduce((a, w, k) => a + w * k, 0);
      o.full = s.rolls.full;
    } else {
      o.day += got;
    }
  }
  return o;
}

// 食材配列は入力しないので、配列ごとの結果を出現確率で平均する。
// rollsOf(n, amts) は所持数0から n 回（小数）おてつだいする区間の segRolls の結果。
function averagePatterns(r, mon, rollsOf) {
  const o = { day: 0, night: 0, rolls: 0, full: 0 };
  for (const { amts, p } of amountPatterns(mon)) {
    const d = daySkills(r, r.segs.map((s) => (s.tap ? s : { ...s, rolls: rollsOf(s.n, amts) })));
    Object.keys(o).forEach((k) => { o[k] += p * d[k]; });
  }
  return o;
}

// 表示用の1日の値。発動回数が小数のときは、回数に関係する値を前後の整数回の日の割合で平均する。
const MIXED_KEYS = ['day', 'night', 'rolls', 'full', 'Ha', 'Hs'];
export function daily(m, env) {
  const parts = timesMix(env).map(([e, w]) => {
    const r = prepare(m, e);
    const d = averagePatterns(r, MONS[e.mon], (n, amts) => segRolls(r.cap, n, r.ingP, m.berry, amts));
    return [{ ...r, ...d }, w];
  });
  const out = { ...parts[0][0], genki: energyAt(env, m.wake, m.rec), wakeE: Math.round(mixed(env, (e) => curveOf(e, m.wake, m.rec)(0))) };
  MIXED_KEYS.forEach((k) => { out[k] = parts.reduce((s, [d, w]) => s + w * d[k], 0); });
  return out;
}

export const envKey = (env) => [env.N, env.camp, env.mon, env.heal, env.tap, env.team, env.healAmt, env.healTimes].join('|');

export function createEngine() {
  const metricCache = new Map();
  const distCache = new Map();

  const rollsCache = new Map();
  function rollsFor(cap, n, ingP, berry, amts) {
    const key = `${cap}|${n}|${ingP}|${berry}|${amts.join(',')}`;
    if (!rollsCache.has(key)) rollsCache.set(key, segRolls(cap, n, ingP, berry, amts));
    return rollsCache.get(key);
  }

  // 自分の1日の期待スキル発動回数（日中＋睡眠中）。発動回数が小数のときは前後の整数回の日の割合で平均する。
  const metric = (m, env) => mixed(env, (e) => metricOne(m, e));
  function metricOne(m, env) {
    const r = prepare(m, env);
    const key = `${envKey(env)}|${r.Te}|${r.p}|${r.ingP}|${r.cap}|${m.berry}|${m.wake}|${m.rec}`;
    if (!metricCache.has(key)) {
      const d = averagePatterns(r, MONS[env.mon], (n, amts) => rollsFor(r.cap, n, r.ingP, m.berry, amts));
      metricCache.set(key, d.day + d.night);
    }
    return metricCache.get(key);
  }

  const baseMetric = (env) => metric(mk(NO_SUBS, null, null), env);

  // ほかのメンバー TEAM_OTHERS 匹（同じポケモン・サブスキルなし・無補正性格・食材配列は出現率で平均）が、
  // おてつだいボーナスでおてつだいスピードが HB_SPEED 上がって増やす発動回数の合計。
  const gainCache = new Map();
  function teamGain(env) {
    const k = envKey(env);
    if (!gainCache.has(k)) gainCache.set(k, TEAM_OTHERS * (metric(mk({ ...NO_SUBS, sp: HB_SPEED }, null, null), env) - baseMetric(env)));
    return gainCache.get(k);
  }
  // チームへの効果。おてつだいボーナスを持たないか、含めない設定なら0。
  const team = (m, env) => (env.team && m.hb ? teamGain(env) : 0);
  // 順位の基準の値 = 自分の発動回数 + チームへの効果。
  const value = (m, env) => metric(m, env) + team(m, env);
  const score = (subs, up, down, env) => value(mults(subs, up, down), env) / baseMetric(env);

  // 上位%の分布は、サブスキル（色別抽選・重複なし）と性格25種をすべて数え上げる。
  function buildDist(env) {
    const natCount = {};
    NAT.forEach(([, u, d]) => {
      const k = `${natCat(u)}|${natCat(d)}`;
      natCount[k] = (natCount[k] || 0) + 1 / NAT.length;
    });
    const natEntries = Object.entries(natCount).map(([k, v]) => [...k.split('|'), v]);

    const b = baseMetric(env);
    const acc = new Map();
    for (const { e, p } of subsetDist(env.N)) {
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

  return { metric, baseMetric, teamGain, team, score, dist, ready, setDist, atLeast, daily };
}
