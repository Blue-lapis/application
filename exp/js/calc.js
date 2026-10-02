// 育成日数の計算。DOM 非依存（Node のテストからも呼ぶ）。
// EXP は「Lv.0 からの累計」で持ち、レベルは累計から決める。日付は UTC の 0 時で数える日の番号（1970-01-01 が 0）。
import { MAX_LEVEL, TOTAL_EXP, SHARDS_PER_CANDY, EXP_TYPES, NATURE_RATE, candyExp, SLEEP_BONUS, NAP, NAP_EVENING_MIN, BOOST } from './data.js';

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
// アメブースト（boost = 'mini' | 'full'）のときは、先に boostLimit 個（null なら全部）までブーストで使い（EXP 2倍、かけら4倍・5倍）、
// 残りはふつうに使う。ブーストでゆめのかけらが足りなくなったら、ブーストを切って続ける。
export function useCandy({ cum, th, target, nature, candy, shardCap = null, boost = 'none', boostLimit = null }) {
  let lv = levelOf(cum, th), used = 0, shards = 0, stop = false;
  const passed = []; // アメで届いたレベル
  // count 個まで、倍率 m で使う。使った個数を返す。ゆめのかけらが足りなくなったら止める。
  const run = (count, m) => {
    let k = 0;
    while (lv < target && k < count) {
      const per = candyExp(lv, nature) * m.exp, cost = SHARDS_PER_CANDY[lv + 1] * m.shards;
      const want = Math.ceil((th[lv + 1] - cum) / per);
      const afford = shardCap == null ? Infinity : Math.floor((shardCap - shards) / cost);
      const n = Math.min(want, count - k, afford);
      if (n < want && n === afford) stop = true;
      k += n;
      shards += n * cost;
      cum += n * per;
      while (lv < MAX_LEVEL && cum >= th[lv + 1]) passed.push(++lv);
      if (stop || n < want) break;
    }
    return k;
  };
  const b = BOOST[boost] && boost !== 'none' ? BOOST[boost] : null;
  const boosted = b ? run(Math.min(candy, boostLimit ?? candy), b) : 0;
  stop = false;
  used = boosted + run(candy - boosted, BOOST.none);
  return { cum, level: lv, used, boosted, shards, passed };
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
// 3つのルートは同じ計算（route）で、使える行動だけが違う。
//   睡眠のみ: 毎晩チームで寝る。島のみ: 島に預けるだけ（上限があれば引き取ってすぐ預け直す）。組み合わせ: 両方。
// 日ごとに「その夜はチームで寝る（翌朝にEXP）」か「朝に島へ k 日（7〜13日）預けて k 日後の朝に引き取る」かを選び、
// 日ごと・チケットの残り日数ごとに、得られる最大のEXP を持つ（動的計画法）。14日以上の預けは 7〜13日をつないで表す
// （1日あたりのEXP は整数なので、つないでも切り捨てで減らない）。最後は、どの日から預けても届く時刻（半分で引き取るか
// 7日待つか）を候補にし、睡眠で届く日とあわせて最も早いものを選ぶ。グッドスリープデーが週をまたいでも取りこぼさない。
// 1回に預ける日数の上限 napMax（null なら1年）があるときは、上限で引き取ってすぐ預け直す（7日の数えはやり直し）。
// 途中で7日未満（1〜6日）で引き取る（EXPは半分）こともできる。チケットが余っているときや睡眠スコアが低いとき、
// グッドスリープデーの前に島へ預けて途中で引き取ると早いことがある。チケットの残りは引き取っても次の預けに持ち越す。
// 島から引き取るのはふつうは朝（すぐ預け直すか、その日の夜から寝る）。睡眠に戻る日は、寝る前（夕方〜夜）まで預けてから
// 引き取ることもできる（EVE を足した行動）。そのぶん NAP_EVENING_MIN 分多く貯まり、その夜から寝る。チケットの残りは日で
// 持つので、夕方まで使った日のチケットはその日の分まで使ったとみなす（残りの数時間は数えない）。
const MAX_DAYS = 3650;
// 行動の番号。0 は寝る、7〜13 は島に k 日預ける、HALF + k（k = 1〜6）は k 日で引き取る（半分）。
// EVE を足すと、k 日目の夕方に引き取ってその夜に寝る（k + 1 日後の朝まで）。
// 親への戻り先は「チケットの残り日数 × ACT + 行動」に詰める。
const SLEEP = 0, HALF = 16, EVE = 32, ACT = 64;
const napDays = (a) => { const b = a % EVE; return b > HALF ? b - HALF : b; };
const actDays = (a) => (a === SLEEP ? 1 : napDays(a) + (a >= EVE ? 1 : 0));
function route(cum0, th, goal, o, { sleep = true, nap = true, midHalf = true } = {}) {
  const cap = o.napMax == null ? NAP.maxDays : Math.max(NAP.fullDays, o.napMax);
  const segs = nap ? Array.from({ length: Math.min(13, cap) - 6 }, (_, i) => 7 + i) : [];
  const halves = nap && midHalf ? [1, 2, 3, 4, 5, 6] : [];
  // 夕方に引き取る預け（預けている時間が上限を超えないもの）。7日未満は半分。
  const eves = [...(midHalf ? halves : []), ...segs].filter((k) => k * DAY_MIN + NAP_EVENING_MIN <= cap * DAY_MIN);
  const need = goal - cum0;
  // 島で1日に貯まるのはチケットありで600以上なので、need ÷ 600 日を超えるチケットは届く前に使い切れない。
  const TD = nap ? Math.min(o.tickets * NAP.ticketDays, Math.ceil(need / NAP.ticketPerDay)) : 0, W = TD + 1;
  const val = [], par = [];
  const ensure = (d) => { while (val.length <= d) { val.push(new Float64Array(W).fill(-1)); par.push(new Int32Array(W)); } };
  const sleepCache = [], napCache = new Map();
  const sd = (d) => (sleepCache[d] ??= sleepDay(o.startDay + d, o));
  const dayNap = (k, used) => { const key = k * 64 + used; let v = napCache.get(key); if (v === undefined) napCache.set(key, (v = napExp(k * DAY_MIN, o.nature, used * DAY_MIN))); return v; };
  // 夕方に引き取る預けのEXP（code は行動の番号から EVE を引いたもの）。
  const eveNap = (k, t) => {
    const min = k * DAY_MIN + NAP_EVENING_MIN, raw = napExp(min, o.nature, Math.min(t * DAY_MIN, min));
    const half = k < NAP.fullDays;
    return { min, raw, exp: half ? Math.floor(raw / 2) : raw, half, code: half ? HALF + k : k };
  };
  let best = Infinity, end = null;
  const reach = (d, t, e, p) => {
    if (e >= need) { if (d < best) { best = d; end = { d, t, prev: p, nap: null }; } return; }
    if (e > val[d][t]) { val[d][t] = e; par[d][t] = p; }
  };
  ensure(0);
  val[0][TD] = 0;
  for (let d = 0; d < MAX_DAYS && d < best; d++) {
    ensure(d + 14);
    for (let t = 0; t <= TD; t++) {
      const e = val[d][t];
      if (e < 0) continue;
      if (nap) {
        const r = napFinish(need - e, o.nature, t, cap);
        if (r && d + r.minutes / DAY_MIN < best) { best = d + r.minutes / DAY_MIN; end = { d, t, nap: r }; }
      }
      const s = sleep ? sd(d + 1).exp : 0;
      if (s > 0) reach(d + 1, t, e + s, t * ACT + SLEEP);
      for (const k of segs) { const used = Math.min(t, k); reach(d + k, t - used, e + dayNap(k, used), t * ACT + k); }
      for (const k of halves) { const used = Math.min(t, k); reach(d + k, t - used, e + Math.floor(dayNap(k, used) / 2), t * ACT + HALF + k); }
      if (sleep && s > 0) {
        // k 日目の夕方に引き取り、その夜から寝る。
        for (const k of eves) {
          const g = eveNap(k, t);
          reach(d + k + 1, t - Math.min(t, k + 1), e + g.exp + sd(d + k + 1).exp, t * ACT + EVE + g.code);
        }
      }
    }
  }
  if (!end) return null;

  // 選んだ行動を後ろからたどる。
  const acts = [];
  const back = (d, p) => { const a = p % ACT; return { kind: a === SLEEP ? 'sleep' : a >= EVE ? 'eve' : 'nap', days: napDays(a) || 1, half: a % EVE > HALF, d: d - actDays(a), t: Math.floor(p / ACT) }; };
  let cur = end.nap ? { kind: 'final', d: end.d, t: end.t, nap: end.nap } : back(end.d, end.prev);
  acts.push(cur);
  while (cur.d > 0 || cur.t !== TD) { cur = back(cur.d, par[cur.d][cur.t]); acts.push(cur); }
  acts.reverse();

  // 前から並べ直して、予定・レベルの区切り・おこう・チケットを数える。島の預けは最後に1回の預けごとに分け直す。
  let cum = cum0, lv = levelOf(cum, th), incense = 0, ticketMin = 0;
  const passed = [], blocks = [];
  const levelUps = (days) => { while (lv < MAX_LEVEL && cum >= th[lv + 1]) passed.push({ level: ++lv, days }); };
  // 島の預けはいったん行動ごとに並べ、最後に1回の預けごとにまとめ直す（regroup）。
  const addNap = (from, days, exp, ticketDays, half, raw, eve = false) => blocks.push({ mode: 'nap', from, days, exp, ticketDays, half, raw, eve });
  const addSleep = (d, x) => {
    const b = blocks[blocks.length - 1];
    if (b?.mode === 'sleep') { b.days++; b.exp += x.exp; } else blocks.push({ mode: 'sleep', from: d, days: 1, exp: x.exp });
  };
  for (const a of acts) {
    if (a.kind === 'sleep') {
      const x = sd(a.d + 1);
      cum += x.exp;
      incense += x.incense;
      levelUps(a.d + 1);
      addSleep(a.d, x);
    } else if (a.kind === 'eve') {
      // 夕方に引き取る預け（日数は朝から朝で数え、夕方の分はEXPにだけ入る）と、その夜の睡眠。
      const g = eveNap(a.days, a.t), x = sd(a.d + a.days + 1);
      cum += g.exp;
      ticketMin += Math.min(a.t, a.days + 1) * DAY_MIN; // 夕方まで使った日は1日分とみなす
      levelUps(a.d + a.days + NAP_EVENING_MIN / DAY_MIN);
      addNap(a.d, a.days, g.exp, Math.min(a.t * DAY_MIN, g.min) / DAY_MIN, g.half, g.raw, true);
      cum += x.exp;
      incense += x.incense;
      levelUps(a.d + a.days + 1);
      addSleep(a.d + a.days, x);
    } else if (a.kind === 'final') {
      const used = Math.min(a.nap.minutes, a.t * DAY_MIN), days = a.nap.minutes / DAY_MIN;
      const raw = napExp(a.nap.minutes, o.nature, used), exp = a.nap.half ? Math.floor(raw / 2) : raw;
      cum += exp;
      ticketMin += used;
      levelUps(a.d + days);
      addNap(a.d, days, exp, used / DAY_MIN, a.nap.half, raw);
    } else {
      const used = Math.min(a.t, a.days), raw = dayNap(a.days, used), exp = a.half ? Math.floor(raw / 2) : raw;
      cum += exp;
      ticketMin += used * DAY_MIN;
      levelUps(a.d + a.days);
      addNap(a.d, a.days, exp, used, a.half, raw);
    }
  }
  return { days: best, passed, blocks: regroup(blocks, cap, o.nature), incense, tickets: ticketsOf(ticketMin) };
}

// 7日以上の預けが続くところは、なるべく上限いっぱい（cap 日）の預けに分け直す（動的計画法は7〜13日をつなぐので、
// そのままだと13日ずつなどになる）。1日あたりのEXPは整数なので、分け方を変えても貯まるEXPの合計は同じ。
// 最後の預けが7日に足りなくなるときは、1つ前の預けを短くする。夕方に引き取る預けは、夕方の分も上限に数える。
function regroup(blocks, cap, nature) {
  const out = [];
  for (let i = 0; i < blocks.length;) {
    const b = blocks[i];
    if (b.mode !== 'nap' || b.half) { out.push(b); i++; continue; }
    let j = i, days = 0, tk = 0;
    while (j < blocks.length && blocks[j].mode === 'nap' && !blocks[j].half) { days += blocks[j].days; tk += blocks[j].ticketDays; j++; if (blocks[j - 1].eve) break; }
    const eve = blocks[j - 1].eve, extra = eve ? NAP_EVENING_MIN / DAY_MIN : 0;
    const n = Math.ceil((days + extra) / cap - 1e-9);
    const len = Array(n).fill(cap);
    len[n - 1] = days + extra - cap * (n - 1);
    // 最後の預けも7日（夕方に引き取るなら7日と夕方の分）は要る。
    const last = NAP.fullDays + extra;
    if (n > 1 && len[n - 1] < last) { len[n - 2] -= last - len[n - 1]; len[n - 1] = last; }
    let from = b.from, tkLeft = tk * DAY_MIN;
    len.forEach((L, k) => {
      const min = Math.round(L * DAY_MIN), use = Math.min(tkLeft, min), raw = napExp(min, nature, use);
      tkLeft -= use;
      const last = k === n - 1;
      out.push({ mode: 'nap', from, days: last ? L - extra : L, exp: raw, raw, ticketDays: use / DAY_MIN, half: false, eve: last && eve });
      from += L;
    });
    i = j;
  }
  return out;
}

// 入力から、アメの使い方と3つのルートの結果を出す。
// input: { expType, level, toNext（次のレベルまでのEXP）, target, nature, candy, shardCap, boost, boostLimit, score, bonus, incense, tickets, napMax, startDay, gsd }
export function plan(input) {
  const th = thresholds(input.expType);
  const { level, target } = input;
  const span = th[level + 1] - th[level];
  const toNext = Math.min(Math.max(input.toNext ?? span, 1), span);
  const start = th[level] + (span - toNext);
  const goal = th[target];
  const candy = useCandy({ cum: start, th, target, nature: input.nature, candy: input.candy, shardCap: input.shardCap, boost: input.boost, boostLimit: input.boostLimit });
  const out = { goal, need: goal - start, candy, routes: null };
  if (candy.cum >= goal) return out;
  const o = { ...input, kindOf: gsdCalendar(input.gsd) };
  const rest = (r) => (r ? { ...r, need: goal - candy.cum } : null);
  out.routes = {
    sleep: rest(route(candy.cum, th, goal, o, { nap: false })),
    nap: rest(route(candy.cum, th, goal, o, { sleep: false, midHalf: input.midHalf !== false })),
    mix: rest(route(candy.cum, th, goal, o, { midHalf: input.midHalf !== false })),
  };
  return out;
}
