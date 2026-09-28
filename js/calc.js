// 3タイプの計算エンジン（checker/js/*/calc.js）が共有する計算。DOM に一切触れない。
// げんきとおてつだいのタイミング、睡眠中のスキル抽選回数、天井カウンタ、サブスキルの抽選分布。
import {
  SLEEP, ENERGY_TICK, WAKE_ENERGY, ENERGY_BANDS, QUEUE_AFTER_FULL, WARMUP_DAYS, CHAIN_WARMUP, DAYS, RARITY_P, SUBS,
} from './constants.js';

const DAY_SEC = 86400;
const AWAKE_SEC = Math.round((24 - SLEEP) * 3600);

// 天井込みの実質スキル確率。ceil は連続不発の天井（ポケモンごとに違う）。
export const eff = (p, ceil) => (p >= 1 ? 1 : p / (1 - (1 - p) ** ceil));

const NO_SUBS = { sk: 0, sp: 0, inv: 0, ing: 0, berry: 0, erb: false };

function addSub(e, s) {
  return {
    sk: e.sk + (s.skill || 0),
    sp: e.sp + (s.speed || 0),
    inv: e.inv + (s.inv || 0),
    ing: e.ing + (s.ing || 0),
    berry: e.berry + (s.berry || 0),
    erb: e.erb || !!s.erb,
  };
}

export const band = (e) => ENERGY_BANDS.find(([min]) => e >= min)[1];

// おてつだいのタイムラインを起床時刻を0として秒単位で追う。
// 次のおてつだいの所要時間は、ひとつ前のおてつだいが終わった時点のげんきで決まる。
// 起床時のげんき回復は進行中のおてつだいにも即座に反映される。
// 日をまたいで端数を持ち越すため、捨て日のあとの DAYS 日分の回数を返す。
export function schedule(Te, g80, wake) {
  const energy = (t) => (g80 ? WAKE_ENERGY : Math.max(0, wake - Math.floor(t / ENERGY_TICK)));
  const Ha = [], Hs = [];
  let rest = 1;
  for (let d = 0; d < WARMUP_DAYS + DAYS; d++) {
    let t = 0, ha = 0, hs = 0;
    for (;;) {
      const dur = Te * band(energy(t));
      const fin = t + rest * dur;
      if (fin > DAY_SEC) { rest -= (DAY_SEC - t) / dur; break; }
      if (fin <= AWAKE_SEC) ha++; else hs++;
      t = fin;
      rest = 1;
    }
    if (d >= WARMUP_DAYS) { Ha.push(ha); Hs.push(hs); }
  }
  return { Ha, Hs };
}

// 睡眠中のおてつだいHs回のうち、スキル抽選が行われる回数の分布。
// 所持数が満タンになったおてつだいの後も、キューに残る QUEUE_AFTER_FULL 回は抽選される。
// ing は食材おてつだい1回で拾う個数の候補（食材配列の3スロット）。
export function nightRolls(cap, Hs, ingP, berry, ing) {
  const P = new Float64Array(Hs + 1);
  let d = new Float64Array(cap), n = new Float64Array(cap);
  d[0] = 1;
  let open = 1;
  for (let j = 1; j <= Hs; j++) {
    n.fill(0);
    for (let c = 0; c < cap; c++) {
      const x = d[c];
      if (!x) continue;
      if (c + berry < cap) n[c + berry] += x * (1 - ingP);
      for (const q of ing) if (c + q < cap) n[c + q] += x * ingP / ing.length;
    }
    [d, n] = [n, d];
    let s = 0;
    for (let c = 0; c < cap; c++) s += d[c];
    P[Math.min(Hs, j + QUEUE_AFTER_FULL)] += open - s;
    open = s;
    // 未満タンの確率が0なら、以後の遷移で分布は変わらない。
    if (open === 0) break;
  }
  P[Hs] += open;
  return { P, full: 1 - open };
}

// 天井カウンタの分布を日ごとに追い、捨て日のあとの DAYS 日分の平均発動回数を返す。
// rollsOf(hs) は睡眠中 hs 回のおてつだいに対する nightRolls の結果。
//
// 連続不発回数 j の分布は、おてつだい1回ごとに「全体が1つ右にずれて (1-p) 倍、発動した分が j=0 へ」
// となるだけなので、リングバッファの先頭位置 h と共通倍率 sc を動かして1回あたり O(1) で進める。
// 睡眠中はストック数ごとに b0（ストック0）・b1（ストック1）を持ち、ストック2になった分は
// 抽選が止まって j=0 に固定されるのでスカラー z で持つ。
export function runDays(p, Ha, Hs, rollsOf, ceil) {
  const L = ceil - 1, q = 1 - p;
  const b0 = new Float64Array(ceil), b1 = new Float64Array(ceil), fc = new Float64Array(ceil);
  let h = 0, sc = 1;
  const at = (j) => (h + j) % ceil;
  // おてつだい1回分、分布を1つずらして (1-p) 倍する。先頭 j=0 の値は呼び出し側で入れる。
  const step = () => {
    const slot = at(L);
    h = slot;
    sc *= q;
    if (sc < 1e-150) {
      for (let k = 0; k < ceil; k++) { b0[k] *= sc; b1[k] *= sc; }
      sc = 1;
    }
  };
  b0[0] = 1;
  let sumDay = 0, sumNight = 0, sumRolls = 0, sumFull = 0;

  for (let d = -CHAIN_WARMUP; d < DAYS; d++) {
    const k = (d + DAYS) % DAYS;
    const ha = Ha[k], hs = Hs[k];
    const { P: RP, full } = rollsOf(hs);

    // 日中: 常にタップするのでストックは発生しない。分布の総量は常に1。
    let day = 0;
    for (let i = 0; i < ha; i++) {
      const last = b0[at(L)] * sc;
      const trig = p * (1 - last) + last;
      day += trig;
      step();
      b0[h] = trig / sc;
    }

    // 睡眠中: 抽選回数が i 回で止まる確率 RP[i] で、その時点の状態を足し合わせる。
    let A0 = 1, A1 = 0, z = 0, fz = 0, night = 0;
    fc.fill(0);
    const collect = (w) => {
      for (let j = 0; j < ceil; j++) { const x = at(j); fc[j] += w * (b0[x] + b1[x]) * sc; }
      fz += w * z;
      night += w * (A1 + 2 * z);
    };
    if (RP[0]) collect(RP[0]);
    for (let i = 0; i < hs; i++) {
      const x = at(L);
      const last0 = b0[x] * sc, last1 = b1[x] * sc;
      const t0 = p * (A0 - last0) + last0;
      const t1 = p * (A1 - last1) + last1;
      step();
      b0[h] = 0;
      b1[h] = t0 / sc;
      z += t1;
      A0 -= t0;
      A1 += t0 - t1;
      if (RP[i + 1]) collect(RP[i + 1]);
    }

    // 起床時にストックは回収され、不発回数の分布だけが翌日に引き継がれる。
    h = 0; sc = 1;
    b0.set(fc);
    b0[0] += fz;
    b1.fill(0);

    if (d >= 0) {
      sumDay += day;
      sumNight += night;
      for (let j = 0; j <= hs; j++) sumRolls += j * RP[j];
      sumFull += full;
    }
  }
  return { day: sumDay / DAYS, night: sumNight / DAYS, rolls: sumRolls / DAYS, full: sumFull / DAYS };
}

// サブスキルN枠の効果合計の分布。1枠ごとに色を RARITY_P で抽選し、
// その色の中で未所持のものから均等に選ぶ（重複なし）。
// 結果は枠の数だけで決まり、5枠では数え上げに時間がかかるので、枠の数ごとに使い回す。呼び出し側は中身を変えない。
const subsetCache = new Map();
export function subsetDist(n) {
  if (!subsetCache.has(n)) subsetCache.set(n, buildSubsetDist(n));
  return subsetCache.get(n);
}

function buildSubsetDist(n) {
  const byRarity = {};
  SUBS.forEach((s, i) => { (byRarity[s.rarity] = byRarity[s.rarity] || []).push(i); });
  const colors = Object.keys(RARITY_P);
  const out = new Map();
  const rec = (depth, mask, p, e) => {
    if (depth === n) {
      const k = `${e.sk.toFixed(4)}|${Math.min(0.35, e.sp).toFixed(4)}|${e.inv}|${e.ing.toFixed(4)}|${e.berry}|${e.erb}`;
      const o = out.get(k);
      if (o) o.p += p; else out.set(k, { e, p });
      return;
    }
    const avail = colors.map((c) => byRarity[c].filter((i) => !(mask & (1 << i))));
    const pc = colors.reduce((a, c, ci) => a + (avail[ci].length ? RARITY_P[c] : 0), 0);
    colors.forEach((c, ci) => {
      const list = avail[ci];
      if (!list.length) return;
      const q = p * (RARITY_P[c] / pc) / list.length;
      for (const i of list) rec(depth + 1, mask | (1 << i), q, addSub(e, SUBS[i]));
    });
  };
  rec(0, 0, 1, NO_SUBS);
  return [...out.values()];
}
