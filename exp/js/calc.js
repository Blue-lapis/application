// 育成日数の計算。DOM 非依存（Node のテストからも呼ぶ）。
// EXP は「Lv.0 からの累計」で持ち、レベルは累計から決める。日付は UTC の 0 時で数える日の番号（1970-01-01 が 0）。
import { MAX_LEVEL, TOTAL_EXP, SHARDS_PER_CANDY, EXP_TYPES, NATURE_RATE, candyExp, SLEEP_BONUS, NAP } from './data.js';

const DAY_MIN = 1440;
// 小数の掛け算の誤差（200 × 0.82 = 163.99…）で1少なくならないように、わずかに足してから切り捨てる。
const floor = (x) => Math.floor(x + 1e-9);

// 経験値タイプごとの累計EXP（Lv.0〜70）。600タイプの累計に倍率を掛けて四捨五入する。
export const thresholds = (expType) => TOTAL_EXP.map((e) => Math.round(e * EXP_TYPES[expType]));

// 累計EXP から今のレベル。
export function levelOf(cum, th) {
  let lv = 1;
  while (lv < MAX_LEVEL && cum >= th[lv + 1]) lv++;
  return lv;
}

// 手持ちのアメを今のレベルから順に使う（低いレベルほど1個のEXPが多く、ゆめのかけらが少ないので、先に使うのが最もよい）。
// 1レベルずつ、上げるのに要る個数（切り上げ）を使い、あまりは次のレベルに持ち越す。目標に届くか、アメかゆめのかけらが尽きたら止める。
export function useCandy({ cum, th, target, nature, candy, shardCap = null }) {
  let lv = levelOf(cum, th), used = 0, shards = 0;
  const passed = []; // アメで届いたレベル
  while (lv < target && used < candy) {
    const per = candyExp(lv, nature), cost = SHARDS_PER_CANDY[lv + 1];
    const want = Math.ceil((th[lv + 1] - cum) / per);
    const afford = shardCap == null ? Infinity : Math.floor((shardCap - shards) / cost);
    const n = Math.min(want, candy - used, afford);
    if (n <= 0) break;
    used += n;
    shards += n * cost;
    cum += n * per;
    while (lv < MAX_LEVEL && cum >= th[lv + 1]) passed.push(++lv);
    if (n < want) break;
  }
  return { cum, level: lv, used, shards, passed };
}

// ---- グッドスリープデー ----
// グッドスリープデーは満月の日を中心にした3日間。前後の日は睡眠EXPが2倍、まん中の満月の日は3倍。
// 満月の日は、満月の時刻（Meeus『Astronomical Algorithms』49章の式、誤差は数分）を日本時間にした日付。
// 実際の日程は公式のお知らせで決まるので、日程ごとに手で前後にずらしたり、なしにしたりできる（plan の gsd）。
const rad = (d) => (d * Math.PI) / 180;
// k 番目（2000年1月の朔から数える）の満月の時刻（Unix ms、UTC）。
export function fullMoonMs(k) {
  k += 0.5;
  const T = k / 1236.85;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = rad(2.5534 + 29.1053567 * k - 0.0000014 * T * T - 0.00000011 * T ** 3);
  const Mp = rad(201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T ** 3 - 0.000000058 * T ** 4);
  const F = rad(160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * T ** 3 + 0.000000011 * T ** 4);
  const O = rad(124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * T ** 3);
  jde += -0.40614 * Math.sin(Mp) + 0.17302 * E * Math.sin(M) + 0.01614 * Math.sin(2 * Mp) + 0.01043 * Math.sin(2 * F)
    + 0.00734 * E * Math.sin(Mp - M) - 0.00515 * E * Math.sin(Mp + M) + 0.00209 * E * E * Math.sin(2 * M)
    - 0.00111 * Math.sin(Mp - 2 * F) - 0.00057 * Math.sin(Mp + 2 * F) + 0.00056 * E * Math.sin(2 * Mp + M)
    - 0.00042 * Math.sin(3 * Mp) + 0.00042 * E * Math.sin(M + 2 * F) + 0.00038 * E * Math.sin(M - 2 * F)
    - 0.00024 * E * Math.sin(2 * Mp - M) - 0.00017 * Math.sin(O);
  return (jde - 2440587.5) * 864e5 - 69e3; // 力学時から UTC へ（ΔT は約69秒）
}
const JST = 9 * 3600e3;
// 満月の日（日本時間の日付の番号）の見込み。2000年〜2120年ぶんを最初に一度だけ作る。
let FULL_DAYS = null;
const fullDays = () => (FULL_DAYS ??= Array.from({ length: 1500 }, (_, k) => Math.floor((fullMoonMs(k) + JST) / 864e5)));

// 手での直し（{ 見込みの満月の日: ずらす日数 | 'off' }）を当てた、満月の日の集まりと、日の種類を返す関数。
export function gsdCalendar(gsd = {}) {
  const set = new Set(fullDays());
  for (const [est, v] of Object.entries(gsd)) {
    const d = Number(est);
    if (!set.has(d)) continue;
    set.delete(d);
    if (v !== 'off') set.add(d + Number(v));
  }
  return (day) => (set.has(day) ? 'full' : set.has(day - 1) || set.has(day + 1) ? 'gsd' : 'normal');
}
const DEFAULT_KIND = gsdCalendar();
export const dayKind = (day) => DEFAULT_KIND(day);

// from〜to にかかるグッドスリープデーの一覧（見込みの満月の日、直した後の満月の日、ずらした日数、なしにしたか）。
export function gsdSchedule(from, to, gsd = {}) {
  return fullDays().filter((d) => d >= from - 4 && d <= to + 4).map((est) => {
    const v = gsd[est];
    const off = v === 'off', shift = off || v == null ? 0 : Number(v);
    return { est, full: off ? null : est + shift, shift, off };
  }).filter((g) => g.off || (g.full + 1 >= from && g.full - 1 <= to));
}

// ---- 睡眠EXP ----
const KIND_RATE = { normal: 1, gsd: 2, full: 3 };
// せいちょうのおこうの使い方。返すのは [日の倍率, その日に使うおこうの数]。
// every2Days は、ふつうの日は2日に1回使う平均（×1.5、0.5個）として数える。
export const INCENSE = ['none', 'fullMoon', 'gsd', 'every2Days', 'everyDay'];
function dayRate(kind, incense) {
  const r = KIND_RATE[kind];
  switch (incense) {
    case 'fullMoon': return kind === 'full' ? [r * 2, 1] : [r, 0];
    case 'gsd': return kind !== 'normal' ? [r * 2, 1] : [r, 0];
    case 'every2Days': return kind !== 'normal' ? [r * 2, 1] : [r * 1.5, 0.5];
    case 'everyDay': return [r * 2, 1];
    default: return [r, 0];
  }
}

// 1日の睡眠EXP。基本EXP = round(スコア × (1 + 0.14 × ボーナスの数))、その日のEXP = floor(基本 × 日の倍率 × 性格)。
export const sleepBase = (score, bonus) => Math.round(score * (1 + SLEEP_BONUS * bonus));
export function sleepDay(day, { score, bonus, incense, nature, kindOf = dayKind }) {
  const kind = kindOf(day);
  const [rate, used] = dayRate(kind, incense);
  return { exp: floor(sleepBase(score, bonus) * rate * NATURE_RATE[nature]), kind, incense: used };
}

// ---- ゴンベのおひるね島 ----
// 預けて t 分で貯まるEXP。チケットの分（1日600、tk 分まで）を先に、そのあと1日150。性格は上昇だけ効く。
function napExp(t, nature, tk) {
  const rate = Math.max(NATURE_RATE[nature], 1);
  const u = Math.min(t, tk);
  return floor((rate * (NAP.ticketPerDay * u + NAP.perDay * (t - u))) / DAY_MIN);
}
// f(t) >= need となる最小の t（分）。hi までに届かなければ null。
function firstMinute(f, need, hi) {
  if (f(hi) < need) return null;
  let lo = 0;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (f(mid) >= need) hi = mid; else lo = mid + 1; }
  return lo;
}
// need のEXP を島で貯めるのに要る分（ticketDays はチケットの残り日数）。
// 7日未満で引き取ると半分なので、「半分で引き取る」と「7日待つ」の早いほう。maxDays は1回に預ける日数の上限。
function napFinish(need, nature, ticketDays, maxDays = NAP.maxDays) {
  const full = NAP.fullDays * DAY_MIN, tk = ticketDays * DAY_MIN;
  const t = firstMinute((m) => napExp(m, nature, tk), need, maxDays * DAY_MIN);
  if (t == null) return null;
  if (t >= full) return { minutes: t, half: false };
  const h = firstMinute((m) => Math.floor(napExp(m, nature, tk) / 2), need, full - 1);
  return h == null ? { minutes: full, half: false } : { minutes: h, half: true };
}
export const napMinutes = (need, nature, tickets) => napFinish(need, nature, tickets * NAP.ticketDays);
const ticketsOf = (ticketMinutes) => Math.ceil(ticketMinutes / (NAP.ticketDays * DAY_MIN) - 1e-9);

// ---- ルート ----
const MAX_SLEEP_DAYS = 3650;

// A. 睡眠のみ。始める日の夜から毎日寝て、翌朝にEXPが入る。
function routeSleep(cum, th, goal, o) {
  let lv = levelOf(cum, th), incense = 0;
  const passed = [];
  for (let i = 1; i <= MAX_SLEEP_DAYS; i++) {
    const d = sleepDay(o.startDay + i, o);
    cum += d.exp;
    incense += d.incense;
    while (lv < MAX_LEVEL && cum >= th[lv + 1]) passed.push({ level: ++lv, days: i });
    if (cum >= goal) return { days: i, passed, incense };
  }
  return null;
}

// B. おひるね島のみ。C で睡眠を使わない場合として求める（預ける日数に上限があるときは、引き取ってすぐ預け直す）。
const routeNap = (cum, th, goal, o) => routeMix(cum, th, goal, { ...o, noSleep: true });

// C. 最適な組み合わせ。日ごとに「その夜はチームで寝る」か「島に k 日（7〜13日）預けて引き取る」かを選び、
// 日ごと・チケットの残り日数ごとに、得られる最大のEXP を持つ（動的計画法）。14日以上の預けは 7〜13日をつないで表す
// （1日あたりのEXP は整数なので、つないでも切り捨てで減らない）。最後は、どの日から預けても届く時刻（半分で引き取るか
// 7日待つか）を候補にし、睡眠で届く日とあわせて最も早いものを選ぶ。グッドスリープデー・満月が週をまたいでも取りこぼさない。
// 1回に預ける日数の上限 napMax（null なら1年）があるときは、上限で引き取ってすぐ預け直す。預け直すと7日の数えは
// やり直しになる。途中の預けは 7〜min(13, 上限)日をつなぎ、最後の預けは上限まで（それを超える分はつないで表す）。
function routeMix(cum0, th, goal, o) {
  const cap = o.napMax == null ? NAP.maxDays : Math.max(NAP.fullDays, o.napMax);
  const NAP_SEG = Array.from({ length: Math.min(13, cap) - 6 }, (_, i) => 7 + i);
  const need = goal - cum0, TD = o.tickets * NAP.ticketDays, W = TD + 1;
  const val = [], par = [];
  const ensure = (d) => { while (val.length <= d) { val.push(new Float64Array(W).fill(-1)); par.push(new Int32Array(W)); } };
  const sleepCache = [];
  const sd = (d) => (sleepCache[d] ??= sleepDay(o.startDay + d, o));
  const dayNap = (k, used) => napExp(k * DAY_MIN, o.nature, used * DAY_MIN);
  let best = Infinity, end = null;
  const reach = (d, t, e, p) => {
    if (e >= need) { if (d < best) { best = d; end = { d, t, prev: p, nap: null }; } return; }
    if (e > val[d][t]) { val[d][t] = e; par[d][t] = p; }
  };
  ensure(0);
  val[0][TD] = 0;
  for (let d = 0; d < MAX_SLEEP_DAYS && d < best; d++) {
    ensure(d + 13);
    for (let t = 0; t <= TD; t++) {
      const e = val[d][t];
      if (e < 0) continue;
      const r = napFinish(need - e, o.nature, t, cap);
      if (r && d + r.minutes / DAY_MIN < best) { best = d + r.minutes / DAY_MIN; end = { d, t, nap: r }; }
      const s = sd(d + 1).exp;
      if (s > 0 && !o.noSleep) reach(d + 1, t, e + s, t * 16);
      for (const k of NAP_SEG) { const used = Math.min(t, k); reach(d + k, t - used, e + dayNap(k, used), t * 16 + k); }
    }
  }
  if (!end) return null;

  // 選んだ行動を後ろからたどる。
  const acts = [];
  let d = end.d, t = end.t, p = end.prev;
  if (end.nap) acts.push({ kind: 'final', d, t, nap: end.nap });
  else { acts.push({ kind: (p & 15) || 'sleep', d: d - ((p & 15) || 1), t: p >> 4 }); d -= (p & 15) || 1; t = p >> 4; }
  while (d > 0 || t !== TD) {
    p = par[d][t];
    const k = p & 15, pt = p >> 4, pd = d - (k || 1);
    acts.push({ kind: k || 'sleep', d: pd, t: pt });
    d = pd;
    t = pt;
  }
  acts.reverse();

  // 前から並べ直して、予定・レベルの区切り・おこう・チケットを数える。
  let cum = cum0, lv = levelOf(cum, th), incense = 0, ticketMin = 0;
  const passed = [], blocks = [];
  const levelUps = (days) => { while (lv < MAX_LEVEL && cum >= th[lv + 1]) passed.push({ level: ++lv, days }); };
  const last = () => blocks[blocks.length - 1];
  for (const a of acts) {
    if (a.kind === 'sleep') {
      const x = sd(a.d + 1);
      cum += x.exp;
      incense += x.incense;
      levelUps(a.d + 1);
      if (last()?.mode === 'sleep') { last().days++; last().exp += x.exp; } else blocks.push({ mode: 'sleep', from: a.d, days: 1, exp: x.exp });
    } else if (a.kind === 'final') {
      const used = Math.min(a.nap.minutes, a.t * DAY_MIN), days = a.nap.minutes / DAY_MIN;
      const raw = napExp(a.nap.minutes, o.nature, used), exp = a.nap.half ? Math.floor(raw / 2) : raw;
      cum += exp;
      ticketMin += used;
      levelUps(a.d + days);
      if (last()?.mode === 'nap' && !a.nap.half) { last().days += days; last().exp += exp; last().ticketDays += used / DAY_MIN; last().deposits++; } else blocks.push({ mode: 'nap', from: a.d, days, exp, raw, ticketDays: used / DAY_MIN, half: a.nap.half, deposits: 1 });
    } else {
      const used = Math.min(a.t, a.kind), exp = dayNap(a.kind, used);
      cum += exp;
      ticketMin += used * DAY_MIN;
      levelUps(a.d + a.kind);
      if (last()?.mode === 'nap' && !last().half) { last().days += a.kind; last().exp += exp; last().ticketDays += used; last().deposits++; } else blocks.push({ mode: 'nap', from: a.d, days: a.kind, exp, ticketDays: used, deposits: 1 });
    }
  }
  return { days: best, passed, blocks, incense, tickets: ticketsOf(ticketMin) };
}

// 入力から、アメの使い方と3つのルートの結果を出す。
// input: { expType, level, toNext（次のレベルまでのEXP）, target, nature, candy, shardCap, score, bonus, incense, tickets, startDay }
export function plan(input) {
  const th = thresholds(input.expType);
  const { level, target } = input;
  const span = th[level + 1] - th[level];
  const toNext = Math.min(Math.max(input.toNext ?? span, 1), span);
  const start = th[level] + (span - toNext);
  const goal = th[target];
  const candy = useCandy({ cum: start, th, target, nature: input.nature, candy: input.candy, shardCap: input.shardCap });
  const out = { goal, need: goal - start, candy, routes: null };
  if (candy.cum >= goal) return out;
  const o = { ...input, kindOf: gsdCalendar(input.gsd) };
  const rest = (r) => (r ? { ...r, need: goal - candy.cum } : null);
  out.routes = {
    sleep: rest(routeSleep(candy.cum, th, goal, o)),
    nap: rest(routeNap(candy.cum, th, goal, o)),
    mix: rest(routeMix(candy.cum, th, goal, o)),
  };
  return out;
}
