// 3タイプの計算エンジン（checker/js/*/calc.js）が共有する計算。DOM に一切触れない。
// げんきとおてつだいのタイミング、スキル抽選回数、天井カウンタ、サブスキルの抽選分布。
import {
  SLEEP, ENERGY_TICK, WAKE_ENERGY, ENERGY_BANDS, QUEUE_AFTER_FULL, CHAIN_MAX_DAYS, CHAIN_TOL, RARITY_P, SUBS, HEAL_CAP, COOK_AT, cookRecovery,
} from './constants.js';

export const DAY_SEC = 86400;
export const AWAKE_SEC = Math.round((24 - SLEEP) * 3600);

// 天井込みの実質スキル確率。ceil は連続不発の天井（ポケモンごとに違う）。
export const eff = (p, ceil) => (p >= 1 ? 1 : p / (1 - (1 - p) ** ceil));

const NO_SUBS = { sk: 0, sp: 0, inv: 0, ing: 0, berry: 0, erb: false, hb: false };

// hb はおてつだいボーナスを持つか（チーム全体への効果を数えるのに使う）。
function addSub(e, s) {
  return {
    sk: e.sk + (s.skill || 0),
    sp: e.sp + (s.speed || 0),
    inv: e.inv + (s.inv || 0),
    ing: e.ing + (s.ing || 0),
    berry: e.berry + (s.berry || 0),
    erb: e.erb || !!s.erb,
    hb: e.hb || s.id === 'hb',
  };
}

export const band = (e) => ENERGY_BANDS.find(([min]) => e >= min)[1];

// 起床からの秒 t のげんきを返す関数（きのみタイプ）。起床中・睡眠中を問わず10分ごとに1減る（0で止まる）。
// 起床中は次の回復が入る（どちらも10分単位の時刻で、同じ時刻の10分ごとの減少のあとに入る）。
// - ヒーラー（チーム全員を回復するスキル）: 起床中を heals + 1 等分した時刻（10分単位に切り捨て）に1回ずつ amt × rec 回復する（上限 HEAL_CAP）。
// - 料理: 起床から COOK_AT 分後に、そのときのげんきに応じて cookRecovery だけ回復する。
// 回復したげんきは整数に切り上げる。睡眠中は回復しない。
// 起床時は睡眠で 100 × rec 回復する（上限 wakeMax）。rec は性格のげんき回復量の補正で、回復量が100に届かないと
// 前の晩の残りによって起床時のげんきが変わる。毎日同じ推移になるとして、前の晩の残りから起床時のげんきを決める（にとよんツールと同じ2回の計算）。
export function energyCurve(wakeMax, heals, amt, rec = 1) {
  const events = new Map();
  const add = (min, f) => { const k = min * 60; events.set(k, [...(events.get(k) || []), f]); };
  for (let i = 0; i < heals; i++) {
    add(Math.floor(((i + 1) * AWAKE_SEC) / 60 / (heals + 1) / 10) * 10, (e) => Math.ceil(Math.min(HEAL_CAP, e + amt * rec)));
  }
  COOK_AT.forEach((min) => add(min, (e) => e + cookRecovery(e)));
  const sleepRec = Math.min(wakeMax, WAKE_ENERGY * rec);
  // 変化点の時刻 ts と、その時刻からの値 vs。end は次の起床の直前（回復前）のげんき。
  const build = (wake) => {
    const ts = [0], vs = [wake];
    let e = wake;
    for (let k = 1; k * ENERGY_TICK < DAY_SEC; k++) {
      const tk = k * ENERGY_TICK;
      e = Math.max(0, e - 1);
      for (const f of events.get(tk) || []) e = f(e);
      ts.push(tk); vs.push(e);
    }
    return { ts, vs, end: Math.max(0, e - 1) };
  };
  const wake = Math.min(wakeMax, Math.ceil(build(sleepRec).end + sleepRec));
  const { ts, vs } = build(wake);
  return (t) => {
    let lo = 0, hi = ts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ts[mid] <= t) lo = mid; else hi = mid - 1;
    }
    return vs[lo];
  };
}

// きのみタイプのおてつだい回数（期待値なので小数で数える。にとよんツールと同じ数え方）。
// 起床からの秒 start から duration 秒のあいだを、tap 秒ごとの受け取りで区切り、区間ごとの回数を返す。
// 次のおてつだいにかかる時間は、そのおてつだいを始めた時点のげんき energy(t) で決まる。
// 区間の境目をまたいだおてつだいは次の区間に入る。最後の区間は、終わりまでに進んだ途中の分を小数で足す。
export function helpsPerTap(Te, energy, start, tap, duration) {
  const next = (t) => t + Te * band(energy(t));
  // from から len 秒で終わるおてつだいの回数と、次のおてつだいの途中の割合。
  const inInterval = (from, len) => {
    const stop = from + len;
    let cur = from, count = 0;
    for (;;) {
      const nx = next(cur);
      if (nx <= stop) { count++; cur = nx; }
      if (nx >= stop) {
        const d = nx - cur;
        return { count, frac: d === 0 ? 0 : (stop - cur) / d, over: nx - stop, at: cur };
      }
    }
  };
  const end = start + duration;
  const out = [];
  let segStart = start, pending = 0, helpStart = start, tapEnd = start + tap;
  for (;;) {
    const last = tapEnd >= end;
    const segEnd = last ? end : tapEnd;
    // 前の区間からのおてつだいがまだ終わっていない。
    if (segStart > segEnd) {
      if (last) {
        const d = segStart - helpStart;
        const f = d > 0 ? (segEnd - helpStart) / d : 0;
        if (f > 0) out.push(f);
        break;
      }
      tapEnd += tap;
      continue;
    }
    const r = inInterval(segStart, segEnd - segStart);
    const count = pending + r.count;
    if (last) {
      if (count + r.frac > 0) out.push(count + r.frac);
      break;
    }
    helpStart = r.at;
    if (r.over > 0) { pending = 1; segStart = tapEnd + r.over; } else { pending = 0; segStart = tapEnd; }
    if (count > 0) out.push(count);
    tapEnd += tap;
  }
  return out;
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

// おてつだいが小数回（lo + f 回）の区間の、スキル抽選が行われる回数の分布。
// 前後の整数回（lo 回と lo + 1 回）の nightRolls を f の割合で混ぜる（f の確率で1回多い日とみなす）。
export function segRolls(cap, n, ingP, berry, ing) {
  const lo = Math.floor(n), f = n - lo;
  const a = nightRolls(cap, lo, ingP, berry, ing);
  if (f < 1e-12) return { P: a.P, full: a.full, n: lo };
  const b = nightRolls(cap, lo + 1, ingP, berry, ing);
  const P = new Float64Array(lo + 2);
  for (let i = 0; i <= lo; i++) P[i] = (1 - f) * a.P[i];
  for (let i = 0; i <= lo + 1; i++) P[i] += f * b.P[i];
  return { P, full: a.full + (b.full - a.full) * f, n: lo + 1 };
}

// 天井カウンタの分布を、毎日同じ区間の並び segs で追い、分布が落ち着いた日の発動回数を返す。
// segs の要素は { night, tap, n, rolls }。
// - tap: 常にタップする日中の区間。おてつだい n 回（小数）のすべてで抽選し、ストックは発生しない。
//   小数の分は、最後の1回を f の確率で行うとみなす。
// - それ以外: 所持数0から追う区間（3時間ごとの受け取りの区間と睡眠中）。ストックは2回までで、2回たまると抽選が止まる。
//   rolls は segRolls の結果（抽選が i 回で止まる確率 P[i]）。区間の終わりにストックを受け取る。
//
// 連続不発回数 j の分布は、おてつだい1回ごとに「全体が1つ右にずれて (1-p) 倍、発動した分が j=0 へ」
// となるだけなので、リングバッファの先頭位置 h と共通倍率 sc を動かして1回あたり O(1) で進める。
// ストックのある区間はストック数ごとに b0（ストック0）・b1（ストック1）を持ち、ストック2になった分は
// 抽選が止まって j=0 に固定されるのでスカラー z で持つ。
export function runSegs(p, segs, ceil) {
  const L = ceil - 1, q = 1 - p;
  const b0 = new Float64Array(ceil), b1 = new Float64Array(ceil), fc = new Float64Array(ceil), prev = new Float64Array(ceil);
  let h = 0, sc = 1;
  const at = (j) => (h + j) % ceil;
  const step = () => {
    const slot = at(L);
    h = slot;
    sc *= q;
    if (sc < 1e-150) {
      for (let k = 0; k < ceil; k++) { b0[k] *= sc; b1[k] *= sc; }
      sc = 1;
    }
  };
  // リングバッファを普通の並び（h = 0、sc = 1）に戻して、値 v で置き換える。
  const reset = (v) => { h = 0; sc = 1; b0.set(v); b1.fill(0); };
  const tapStep = () => {
    const last = b0[at(L)] * sc;
    const trig = p * (1 - last) + last;
    step();
    b0[h] = trig / sc;
    return trig;
  };

  const runDay = () => {
    const o = { day: 0, night: 0, rolls: 0, full: 0 };
    for (const s of segs) {
      if (s.tap) {
        const lo = Math.floor(s.n), f = s.n - lo;
        for (let i = 0; i < lo; i++) o.day += tapStep();
        if (f > 1e-12) {
          for (let j = 0; j < ceil; j++) fc[j] = b0[at(j)] * sc;
          o.day += f * tapStep();
          for (let j = 0; j < ceil; j++) fc[j] = (1 - f) * fc[j] + f * b0[at(j)] * sc;
          reset(fc);
        }
        continue;
      }
      // 抽選回数が i 回で止まる確率 RP[i] で、その時点の状態を足し合わせる。
      const RP = s.rolls.P, hs = s.rolls.n;
      let A0 = 1, A1 = 0, z = 0, fz = 0, got = 0;
      fc.fill(0);
      const collect = (w) => {
        for (let j = 0; j < ceil; j++) { const x = at(j); fc[j] += w * (b0[x] + b1[x]) * sc; }
        fz += w * z;
        got += w * (A1 + 2 * z);
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
      // 受け取り（起床）時にストックは回収され、不発回数の分布だけが引き継がれる。
      fc[0] += fz;
      reset(fc);
      if (s.night) {
        o.night += got;
        for (let j = 0; j < RP.length; j++) o.rolls += j * RP[j];
        o.full = s.rolls.full;
      } else {
        o.day += got;
      }
    }
    return o;
  };

  // 毎日同じ区間なので、日の終わりの不発回数の分布が変わらなくなるまで日を進める。
  b0[0] = 1;
  let o;
  for (let d = 0; d < CHAIN_MAX_DAYS; d++) {
    for (let j = 0; j < ceil; j++) prev[j] = b0[at(j)] * sc;
    o = runDay();
    let diff = 0;
    for (let j = 0; j < ceil; j++) diff += Math.abs(b0[at(j)] * sc - prev[j]);
    if (d > 0 && diff < CHAIN_TOL) break;
  }
  return o;
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
      const k = `${e.sk.toFixed(4)}|${Math.min(0.35, e.sp).toFixed(4)}|${e.inv}|${e.ing.toFixed(4)}|${e.berry}|${e.erb}|${e.hb}`;
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

// 同じ性能とみなす無補正比の差（相対）。順位・同等以上の確率・分布の行のすべてで同じ値を使う。
export const SAME_REL = 1e-7;

// 無補正比ごとの分布 [{ r, p }] で、差が SAME_REL 以内の値を1行にまとめる（計算の丸め誤差で分かれた同じ性能をそろえる）。
// 高い順に並べ、まとめた行の値はその中で最大のもの、確率は合計。
export function mergeSame(rows) {
  const sorted = [...rows].sort((a, b) => b.r - a.r);
  const out = [];
  for (const x of sorted) {
    const top = out[out.length - 1];
    if (top && top.r - x.r <= top.r * SAME_REL) top.p += x.p;
    else out.push({ r: x.r, p: x.p });
  }
  return out;
}
