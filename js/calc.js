// 3タイプの計算エンジン（checker/js/*/calc.js）が共有する計算。DOM に一切触れない。
// げんきとおてつだいのタイミング、スキル抽選回数、サブスキルの抽選分布。
import {
  SLEEP, ENERGY_TICK, WAKE_ENERGY, ENERGY_BANDS, QUEUE_AFTER_FULL, RARITY_P, SUBS, byId, HEAL_CAP, COOK_AT, cookRecovery,
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

export const NO_SUBS = { sk: 0, sp: 0, inv: 0, ing: 0, berry: 0, erb: false, hb: false };

// hb はおてつだいボーナスを持つか（チーム全体への効果を数えるのに使う）。
export function addSub(e, s) {
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

// サブスキルの ID の並びから効果の合計を求める。ID のないもの（未選択・なし他）は飛ばす。
export const sumSubs = (ids) => ids.reduce((e, id) => (byId[id] ? addSub(e, byId[id]) : e), NO_SUBS);

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

// 所持数0からおてつだいを1回ずつ重ねたときの所持数の分布（3タイプ共通）。
// 食材確率 ingP で食材おてつだい（amts から均等に1つ選んだ個数）、それ以外はきのみ（berry 個）を拾う。
// 遷移はおてつだいの回数に依らないので、同じ所持数・確率・個数の組は、回数（おてつだいの速さで変わる）が違っても使い回し、
// 必要な回数まで伸ばしながら次の累積値を記録する（添字 j は j 回おてつだいした後）。
// - open[j]: 満タンでない確率
// - got[i][j]: スロット i で拾った食材の期待個数（所持数を超える分は捨てる）。ings[j] はその全スロットの合計
// - berries[j]: 拾ったきのみの期待個数（満タンになった後のおてつだいはすべてきのみ）
// 1回の分布計算で数百〜千組ほど作る。画面側で使い続けても増えすぎないよう、上限を超えたらすべて捨てる。
const curves = new Map();
const MAX_CURVES = 5000;
export const clearCurves = () => { curves.clear(); };
export function fillCurve(cap, ingP, berry, amts) {
  const key = `${cap}|${ingP}|${berry}|${amts}`;
  let c = curves.get(key);
  if (!c) {
    if (curves.size >= MAX_CURVES) curves.clear();
    c = newCurve(cap, ingP, berry, amts);
    curves.set(key, c);
  }
  return c;
}

function newCurve(cap, ingP, berry, amts) {
  let d = new Float64Array(cap), nx = new Float64Array(cap);
  d[0] = 1;
  const pa = ingP / amts.length;
  const cur = amts.map(() => 0);
  const c = { open: [1], ings: [0], berries: [0], got: amts.map(() => [0]), memos: {} };
  // 回数から求めた値（区間の結果）を、種類 kind・回数 n ごとに使い回す。
  c.cached = (kind, n, fn) => {
    const memo = c.memos[kind] || (c.memos[kind] = new Map());
    let v = memo.get(n);
    if (v === undefined) { v = fn(); memo.set(n, v); }
    return v;
  };
  let open = 1, ings = 0, berries = 0;
  c.upTo = (k) => {
    for (let j = c.open.length; j <= k; j++) {
      berries += berry * (1 - ingP * open);
      // 満タンになった後は分布が変わらないので、更新を省く。
      if (open > 0) {
        nx.fill(0);
        for (let s = 0; s < cap; s++) {
          const x = d[s];
          if (!x) continue;
          if (s + berry < cap) nx[s + berry] += x * (1 - ingP);
          for (let i = 0; i < amts.length; i++) {
            const a = amts[i];
            const g = x * pa * Math.min(a, cap - s);
            cur[i] += g;
            ings += g;
            if (s + a < cap) nx[s + a] += x * pa;
          }
        }
        [d, nx] = [nx, d];
        open = d.reduce((t, x) => t + x, 0);
      }
      c.open.push(open);
      c.ings.push(ings);
      c.berries.push(berries);
      c.got.forEach((xs, i) => xs.push(cur[i]));
    }
    return c;
  };
  return c;
}

// 所持数0からのおてつだいHs回のうち、スキル抽選が行われる回数の分布。
// 所持数が満タンになった後も、おてつだいキューに残る QUEUE_AFTER_FULL 回は抽選される（ポケモンスリープ攻略・検証 Wiki）。
// にとよんツールは満タンになったおてつだいまでしか抽選しないので、ここだけ値が違う。
// ing は食材おてつだい1回で拾う個数の候補（食材配列の3スロット）。
export function nightRolls(cap, Hs, ingP, berry, ing) {
  return curveNightRolls(fillCurve(cap, ingP, berry, ing), Hs);
}

function curveNightRolls(c, Hs) {
  const { open } = c.upTo(Hs);
  const P = new Float64Array(Hs + 1);
  // j 回目のおてつだいで満タンになったら、その後キューに残る分まで抽選する。
  for (let j = 1; j <= Hs; j++) {
    const g = open[j - 1] - open[j];
    if (g) P[Math.min(Hs, j + QUEUE_AFTER_FULL)] += g;
  }
  P[Hs] += open[Hs];
  return { P, full: 1 - open[Hs] };
}

// おてつだいが小数回（lo + f 回）の区間の、スキル抽選が行われる回数の分布。
// 前後の整数回（lo 回と lo + 1 回）の nightRolls を f の割合で混ぜる（f の確率で1回多い日とみなす）。
// 結果は使い回すので、呼び出し側は中身を変えない。
export function segRolls(cap, n, ingP, berry, ing) {
  return curveRolls(fillCurve(cap, ingP, berry, ing), n);
}

// segRolls の、所持数の遷移（fillCurve）を渡す版。
export function curveRolls(c, n) {
  return c.cached('rolls', n, () => {
    const lo = Math.floor(n), f = n - lo;
    const a = curveNightRolls(c, lo);
    if (f < 1e-12) return { P: a.P, full: a.full, n: lo };
    const b = curveNightRolls(c, lo + 1);
    const P = new Float64Array(lo + 2);
    for (let i = 0; i <= lo; i++) P[i] = (1 - f) * a.P[i];
    for (let i = 0; i <= lo + 1; i++) P[i] += f * b.P[i];
    return { P, full: a.full + (b.full - a.full) * f, n: lo + 1 };
  });
}

// ストックのある区間（3時間ごとの受け取りの区間と睡眠中）の期待発動回数。
// 抽選が k 回行われる確率 P[k] で、k 回の二項分布の発動回数を2回（ストックの上限）で打ち切って平均する。
// p は天井込みの実質スキル確率。区間ごとに独立に数え、天井の途中経過は持ち越さない（にとよんツールと同じ）。
export function stockSkills(p, P) {
  const q = 1 - p;
  let s = 0;
  // qk1 は q の k − 1 乗。k を1つ進めるたびに q を掛ける。
  for (let k = 1, qk1 = 1; k < P.length; k++) {
    const qk = qk1 * q;
    if (P[k]) s += P[k] * (2 - 2 * qk - k * p * qk1);
    qk1 = qk;
  }
  return s;
}

// サブスキルN枠の効果合計の分布。1枠ごとに色を RARITY_P で抽選し、
// その色の中で未所持のものから均等に選ぶ（重複なし）。
// 結果は枠の数だけで決まるので、枠の数ごとに使い回す。呼び出し側は中身を変えない。
const subsetCache = new Map();
export function subsetDist(n) {
  if (!subsetCache.has(n)) subsetCache.set(n, buildSubsetDist(n));
  return subsetCache.get(n);
}

// 効果は選んだサブスキルの組（選んだ順番によらない）で決まるので、順番を数え上げず、組ごとの確率を1枠ずつ伸ばして求める（5枠で6,188組）。
function buildSubsetDist(n) {
  const colors = Object.keys(RARITY_P);
  const byRarity = colors.map((c) => SUBS.flatMap((s, i) => (s.rarity === c ? [i] : [])));
  let layer = new Map([[0, 1]]);
  for (let depth = 0; depth < n; depth++) {
    const next = new Map();
    for (const [mask, p] of layer) {
      const avail = byRarity.map((list) => list.filter((i) => !(mask & (1 << i))));
      const pc = colors.reduce((a, c, ci) => a + (avail[ci].length ? RARITY_P[c] : 0), 0);
      colors.forEach((c, ci) => {
        const list = avail[ci];
        if (!list.length) return;
        const q = p * (RARITY_P[c] / pc) / list.length;
        for (const i of list) {
          const m = mask | (1 << i);
          next.set(m, (next.get(m) || 0) + q);
        }
      });
    }
    layer = next;
  }
  const out = new Map();
  for (const [mask, p] of layer) {
    const e = SUBS.reduce((a, s, i) => (mask & (1 << i) ? addSub(a, s) : a), NO_SUBS);
    const k = `${e.sk.toFixed(4)}|${Math.min(0.35, e.sp).toFixed(4)}|${e.inv}|${e.ing.toFixed(4)}|${e.berry}|${e.erb}|${e.hb}`;
    const o = out.get(k);
    if (o) o.p += p; else out.set(k, { e, p });
  }
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
