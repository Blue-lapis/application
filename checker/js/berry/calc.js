// きのみタイプ向けの期待値計算エンジン。DOM に触れない。
// おてつだいのタイミング（げんき・日またぎ）は共通の schedule（../../../js/calc.js）を使う。
// 呼び出し側は env = { N, camp, g80, mon } を渡す。mon は MONS のキー。
import { WAKE_ENERGY, WAKE_ENERGY_ERB, NAT, byId, LEVEL } from '../../../js/constants.js';
import { schedule, subsetDist } from '../../../js/calc.js';
import { MONS, natCat, amountPatterns } from './constants.js';

const natMul = (up, down, key, hi, lo) => (up === key ? hi : 1) * (down === key ? lo : 1);

// e: サブスキル効果の合計 { sp, inv, ing, berry, erb }（subsetDist の要素と同じ形）
// berry はきのみの数Sで増える個数。1回あたりの個数はポケモンの基礎値に足して prepare で決める。
export function mk(e, up, down) {
  return {
    timeMul: natMul(up, down, 'speed', 0.9, 1.075) * (1 - Math.min(0.35, e.sp)),
    ingMul: natMul(up, down, 'ing', 1.2, 0.8) * (1 + e.ing),
    inv: e.inv,
    berry: e.berry,
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

// おてつだいのタイミングはきのみの個数や食材確率に依存しないので、同じ条件の計算を使い回す。
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
  const berry = mon.berries + m.berry;
  const energy = berryEnergy(mon.berryBase, LV);
  return { LV, T, Te, ingP, cap, berry, energy, ...scheduleOf(Te, env.g80, m.wake) };
}

// 起床から次の起床までの1日（日中 ha 回・睡眠中 hs 回のおてつだい）で拾うきのみと食材の期待個数。
// 起床時に所持品を受け取るので所持数0から始まり、日中はタップしない（いつのまに育成）。
// 満タンになるまでは、食材確率で食材おてつだい（amts から均等に1つ選んだ個数）、それ以外はきのみおてつだい。
// 満タンになった後は食材確率に関係なくきのみだけを拾い、あふれたきのみはエナジーになる。
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

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// 食材配列は入力しないので、配列ごとの値を出現確率で平均する。捨て日のあとの日ごとの値を平均する。
function runDays(r, dayOf) {
  const pats = amountPatterns(MONS[r.mon]);
  const o = { day: 0, night: 0, ings: 0, fullBed: 0, full: 0 };
  r.Ha.forEach((ha, k) => {
    for (const { amts, p } of pats) {
      const v = dayOf(ha, r.Hs[k], amts);
      Object.keys(o).forEach((key) => { o[key] += p * v[key]; });
    }
  });
  Object.keys(o).forEach((k) => { o[k] /= r.Ha.length; });
  return o;
}

export function daily(m, env) {
  const r = { ...prepare(m, env), mon: env.mon };
  const days = new Map();
  const d = runDays(r, (ha, hs, amts) => {
    const key = `${ha}|${hs}|${amts.join(',')}`;
    if (!days.has(key)) days.set(key, dayBerries(r.cap, ha, hs, r.ingP, r.berry, amts));
    return days.get(key);
  });
  return { ...r, ...d, Ha: avg(r.Ha), Hs: avg(r.Hs) };
}

export const envKey = (env) => `${env.N}|${env.camp}|${env.g80}|${env.mon}`;

export function createEngine() {
  const metricCache = new Map();
  const dayCache = new Map();
  const distCache = new Map();

  // きのみのエナジー（きのみ1個のエナジー × 個数）。
  function metric(m, env) {
    const r = { ...prepare(m, env), mon: env.mon };
    const key = `${envKey(env)}|${r.Te}|${r.ingP.toFixed(8)}|${r.cap}|${r.berry}|${m.wake}`;
    if (!metricCache.has(key)) {
      const dayOf = (ha, hs, amts) => {
        const k = `${env.mon}|${r.cap}|${ha}|${hs}|${r.ingP.toFixed(8)}|${r.berry}|${amts.join(',')}`;
        if (!dayCache.has(k)) dayCache.set(k, dayBerries(r.cap, ha, hs, r.ingP, r.berry, amts));
        return dayCache.get(k);
      };
      const d = runDays(r, dayOf);
      metricCache.set(key, (d.day + d.night) * r.energy);
    }
    return metricCache.get(key);
  }

  // 比較の基準は無補正個体（サブスキルなし・無補正性格、食材配列は全パターンの平均）。
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

    // スキル確率アップはきのみに影響しないので、それ以外の効果が同じ組み合わせをまとめる。
    const subs = new Map();
    for (const { e, p } of subsetDist(env.N)) {
      const k = `${Math.min(0.35, e.sp).toFixed(4)}|${e.inv}|${e.ing.toFixed(4)}|${e.berry}|${e.erb}`;
      const o = subs.get(k);
      if (o) o.p += p; else subs.set(k, { e, p });
    }

    const b = baseMetric(env);
    const acc = new Map();
    for (const { e, p } of subs.values()) {
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
