// スキルタイプ向けの期待値計算エンジン。DOM に触れない。
// 共通の計算（../../../js/calc.js のげんきとおてつだいのタイミング・睡眠中の抽選回数・天井カウンタ）を、
// ポケモンごとの基礎値・天井・食材の個数で使う。呼び出し側は env = { N, camp, g80, mon } を渡す。
import { WAKE_ENERGY, WAKE_ENERGY_ERB, NAT, byId, LEVEL } from '../../../js/constants.js';
import { schedule, nightRolls, runDays, subsetDist } from '../../../js/calc.js';
import { MONS, natCat, ceilOf, amountPatterns } from './constants.js';

const natMul = (up, down, key, hi, lo) => (up === key ? hi : 1) * (down === key ? lo : 1);

// e: サブスキル効果の合計 { sk, sp, inv, ing, berry, erb }（subsetDist の要素と同じ形）
export function mk(e, up, down) {
  return {
    skillMul: natMul(up, down, 'skill', 1.2, 0.8) * (1 + e.sk),
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
      sk: a.sk + (s.skill || 0), sp: a.sp + (s.speed || 0), inv: a.inv + (s.inv || 0), ing: a.ing + (s.ing || 0),
      berry: a.berry + (s.berry || 0), erb: a.erb || !!s.erb,
    };
  }, NO_SUBS);
  return mk(e, up, down);
}

// おてつだいのタイミングはスキル確率や所持数に依存しないので、同じ条件の計算を使い回す。
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
  const p = Math.min(1, mon.skillP * m.skillMul);
  const ingP = Math.min(1, mon.ingP * m.ingMul);
  const cap0 = mon.cap + m.inv;
  const cap = env.camp ? Math.ceil(cap0 * 1.2) : cap0;
  return { LV, T, Te, p, ingP, cap, ceil: ceilOf(mon), ...scheduleOf(Te, env.g80, m.wake) };
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// 食材配列は入力しないので、配列ごとに天井カウンタを追った結果を出現確率で平均する。
// rollsOf(hs, amts) は睡眠中 hs 回のおてつだいに対する nightRolls の結果。
function averagePatterns(r, mon, rollsOf) {
  const o = { day: 0, night: 0, rolls: 0, full: 0 };
  for (const { amts, p } of amountPatterns(mon)) {
    const d = runDays(r.p, r.Ha, r.Hs, (hs) => rollsOf(hs, amts), r.ceil);
    Object.keys(o).forEach((k) => { o[k] += p * d[k]; });
  }
  return o;
}

export function daily(m, env) {
  const r = prepare(m, env);
  // 捨て日を含め、同じ回数・食材配列の夜間分布を再計算しない。
  const nights = new Map();
  const d = averagePatterns(r, MONS[env.mon], (hs, amts) => {
    const key = `${hs}|${amts.join(',')}`;
    if (!nights.has(key)) nights.set(key, nightRolls(r.cap, hs, r.ingP, m.berry, amts));
    return nights.get(key);
  });
  return { ...r, ...d, Ha: avg(r.Ha), Hs: avg(r.Hs) };
}

export const envKey = (env) => `${env.N}|${env.camp}|${env.g80}|${env.mon}`;

export function createEngine() {
  const metricCache = new Map();
  const distCache = new Map();

  // 睡眠中の抽選回数分布が同じ（例: 所持数が満タンにならない）個体は結果も同じなので、
  // 分布の中身をキーにして計算を共有する。
  const rollsCache = new Map();
  const rollsIds = new Map();
  function rollsFor(cap, hs, ingP, berry, amts) {
    const key = `${cap}|${hs}|${ingP.toFixed(6)}|${berry}|${amts.join(',')}`;
    if (!rollsCache.has(key)) {
      const r = nightRolls(cap, hs, ingP, berry, amts);
      const sig = Array.from(r.P, (x) => x.toFixed(12)).join(',');
      if (!rollsIds.has(sig)) rollsIds.set(sig, rollsIds.size);
      rollsCache.set(key, { ...r, id: rollsIds.get(sig) });
    }
    return rollsCache.get(key);
  }

  // 1日の期待スキル発動回数（日中＋睡眠中）。
  function metric(m, env) {
    const r = prepare(m, env), mon = MONS[env.mon];
    const rollsOf = (hs, amts) => rollsFor(r.cap, hs, r.ingP, m.berry, amts);
    const sig = amountPatterns(mon).map(({ amts }) => r.Hs.map((hs) => rollsOf(hs, amts).id).join(',')).join('/');
    const key = `${envKey(env)}|${r.p.toFixed(8)}|${r.Ha.join(',')}|${sig}`;
    if (!metricCache.has(key)) {
      const d = averagePatterns(r, mon, rollsOf);
      metricCache.set(key, d.day + d.night);
    }
    return metricCache.get(key);
  }

  const baseMetric = (env) => metric(mk(NO_SUBS, null, null), env);
  const score = (subs, up, down, env) => metric(mults(subs, up, down), env) / baseMetric(env);

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
        const k = (metric(mk(e, u, d), env) / b).toFixed(9);
        acc.set(k, (acc.get(k) || 0) + p * v);
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

  return { metric, baseMetric, score, dist, ready, setDist, atLeast, daily };
}
