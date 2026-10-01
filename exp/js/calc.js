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

// ---- 月齢とグッドスリープデー（近似） ----
// 月齢は 2000-01-06 18:14 UTC の新月から数える。満月は月齢の割合が 0.48〜0.52 の日（UTC 0 時で判定）、
// グッドスリープデーは満月の日の前後の日。実際の日程は公式のお知らせで決まり、1日ずれることがある。
const LUNAR = 29.530588;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const moonRatio = (day) => {
  const age = (((day * 864e5 - NEW_MOON) / 864e5) % LUNAR + LUNAR) % LUNAR;
  return age / LUNAR;
};
const isFull = (day) => { const r = moonRatio(day); return r > 0.48 && r < 0.52; };
export function dayKind(day) {
  if (isFull(day)) return 'full';
  if (isFull(day - 1) || isFull(day + 1)) return 'gsd';
  return 'normal';
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
export function sleepDay(day, { score, bonus, incense, nature }) {
  const kind = dayKind(day);
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
// 7日未満で引き取ると半分なので、「半分で引き取る」と「7日待つ」の早いほう。
function napFinish(need, nature, ticketDays) {
  const full = NAP.fullDays * DAY_MIN, tk = ticketDays * DAY_MIN;
  const t = firstMinute((m) => napExp(m, nature, tk), need, NAP.maxDays * DAY_MIN);
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

// B. おひるね島のみ。始める日に預け、届いたら引き取る。
function routeNap(cum, goal, o) {
  const r = napMinutes(goal - cum, o.nature, o.tickets);
  if (!r) return null;
  return { days: r.minutes / DAY_MIN, half: r.half, tickets: ticketsOf(Math.min(r.minutes, o.tickets * NAP.ticketDays * DAY_MIN)), passed: [] };
}

// C. 最適な組み合わせ。日ごとに「その夜はチームで寝る」か「島に k 日（7〜13日）預けて引き取る」かを選び、
// 日ごと・チケットの残り日数ごとに、得られる最大のEXP を持つ（動的計画法）。14日以上の預けは 7〜13日をつないで表す
// （1日あたりのEXP は整数なので、つないでも切り捨てで減らない）。最後は、どの日から預けても届く時刻（半分で引き取るか
// 7日待つか）を候補にし、睡眠で届く日とあわせて最も早いものを選ぶ。グッドスリープデー・満月が週をまたいでも取りこぼさない。
const NAP_SEG = [7, 8, 9, 10, 11, 12, 13];
function routeMix(cum0, th, goal, o) {
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
      const r = napFinish(need - e, o.nature, t);
      if (r && d + r.minutes / DAY_MIN < best) { best = d + r.minutes / DAY_MIN; end = { d, t, nap: r }; }
      const s = sd(d + 1).exp;
      if (s > 0) reach(d + 1, t, e + s, t * 16);
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
      const used = Math.min(a.nap.minutes, a.t * DAY_MIN), days = a.nap.minutes / DAY_MIN, exp = goal - cum;
      cum = goal;
      ticketMin += used;
      levelUps(a.d + days);
      if (last()?.mode === 'nap' && !a.nap.half) { last().days += days; last().exp += exp; last().ticketDays += used / DAY_MIN; } else blocks.push({ mode: 'nap', from: a.d, days, exp, ticketDays: used / DAY_MIN, half: a.nap.half });
    } else {
      const used = Math.min(a.t, a.kind), exp = dayNap(a.kind, used);
      cum += exp;
      ticketMin += used * DAY_MIN;
      levelUps(a.d + a.kind);
      if (last()?.mode === 'nap') { last().days += a.kind; last().exp += exp; last().ticketDays += used; } else blocks.push({ mode: 'nap', from: a.d, days: a.kind, exp, ticketDays: used });
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
  const o = { ...input };
  const rest = (r) => (r ? { ...r, need: goal - candy.cum } : null);
  out.routes = {
    sleep: rest(routeSleep(candy.cum, th, goal, o)),
    nap: rest(routeNap(candy.cum, goal, o)),
    mix: rest(routeMix(candy.cum, th, goal, o)),
  };
  return out;
}

// これから先の満月・グッドスリープデー（表示用）。
export function upcomingMoon(startDay, days = 40) {
  const res = [];
  for (let d = startDay + 1; d <= startDay + days; d++) { const k = dayKind(d); if (k !== 'normal') res.push({ day: d, kind: k }); }
  return res;
}
