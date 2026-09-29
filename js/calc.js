// 3タイプの計算エンジン（checker/js/*/calc.js）が共有する計算。DOM に一切触れない。
// げんきとおてつだいのタイミング、スキル抽選回数、サブスキルの抽選分布。
import {
  SLEEP, ENERGY_TICK, WAKE_ENERGY, ENERGY_BANDS, RARITY_P, SUBS, HEAL_CAP, COOK_AT, cookRecovery,
} from './constants.js';

export const DAY_SEC = 86400;
export const AWAKE_SEC = Math.round((24 - SLEEP) * 3600);

// 天井込みの実質スキル確率。ceil は発動が確定するおてつだいの回数（ポケモンごとに違う）。
export const eff = (p, ceil) => (p >= 1 ? 1 : p / (1 - (1 - p) ** ceil));

// 小数第4位までの切り捨て（にとよんツールと同じ。浮動小数の誤差を小数第6位で丸めてから切り捨てる）。
export const trunc4 = (v) => Math.floor(+(v * 1e4).toFixed(6)) / 1e4;

// おてつだい時間（秒）。レベル・性格・サブスキルの倍率の積を小数第4位まで切り捨て、基準のおてつだい時間に掛ける。
// 秒は切り捨てない（にとよんツールと同じ）。timeMul は性格 × (1 − サブスキル合計)。
export const helpTime = (time, LV, timeMul) => time * trunc4(((501 - LV) / 500) * timeMul);

// 食材確率・スキル確率。基礎値 × 性格 × (1 + サブスキル合計) を小数第4位まで切り捨てる（上限1）。
export const rateOf = (base, mul) => Math.min(1, trunc4(base * mul));

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

// 所持数0からのおてつだいHs回のうち、スキル抽選が行われる回数の分布。
// 所持数が満タンになったおてつだいまで抽選され、その後は抽選されない（にとよんツールと同じ）。
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
    P[j] += open - s;
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

// ストックのある区間（3時間ごとの受け取りの区間と睡眠中）の期待発動回数。
// 抽選が k 回行われる確率 P[k] で、k 回の二項分布の発動回数を2回（ストックの上限）で打ち切って平均する。
// p は天井込みの実質スキル確率。区間ごとに独立に数え、天井の途中経過は持ち越さない（にとよんツールと同じ）。
export function stockSkills(p, P) {
  const q = 1 - p;
  let s = 0;
  for (let k = 1; k < P.length; k++) {
    if (!P[k]) continue;
    const once = k * p * q ** (k - 1);
    s += P[k] * (2 - 2 * q ** k - once);
  }
  return s;
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
