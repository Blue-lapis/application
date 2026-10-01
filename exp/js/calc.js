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
// 預けて t 分で貯まるEXP。チケットの分（1日600）を先に、そのあと1日150。性格は上昇だけ効く。
function napExp(t, nature, tickets) {
  const rate = Math.max(NATURE_RATE[nature], 1);
  const tk = Math.min(t, tickets * NAP.ticketDays * DAY_MIN);
  return floor((rate * (NAP.ticketPerDay * tk + NAP.perDay * (t - tk))) / DAY_MIN);
}
// f(t) >= need となる最小の t（分）。hi までに届かなければ null。
function firstMinute(f, need, hi) {
  if (f(hi) < need) return null;
  let lo = 0;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (f(mid) >= need) hi = mid; else lo = mid + 1; }
  return lo;
}
// need のEXP を島で貯めるのに要る分。7日未満で引き取ると半分なので、「半分で引き取る」と「7日待つ」の早いほう。
export function napMinutes(need, nature, tickets) {
  const full = NAP.fullDays * DAY_MIN;
  const t = firstMinute((m) => napExp(m, nature, tickets), need, NAP.maxDays * DAY_MIN);
  if (t == null) return null;
  if (t >= full) return { minutes: t, half: false };
  const h = firstMinute((m) => Math.floor(napExp(m, nature, tickets) / 2), need, full - 1);
  return h == null ? { minutes: full, half: false } : { minutes: h, half: true };
}
const ticketsUsed = (minutes, tickets) => Math.min(tickets, Math.ceil(minutes / (NAP.ticketDays * DAY_MIN)));

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
  return { days: r.minutes / DAY_MIN, half: r.half, tickets: ticketsUsed(r.minutes, o.tickets), passed: [] };
}

// C. 併用。7日ごとに、睡眠とおひるね島のどちらが多く稼げるかを比べて多いほうにする（島は7日預けて引き取る）。
// その7日の中で届くときは、睡眠で届く日と、島で届く時刻（半分で引き取るか7日待つか）の早いほう。
function routeMix(cum, th, goal, o) {
  let lv = levelOf(cum, th), day = 0, tickets = o.tickets, incense = 0, ticketsSpent = 0;
  const passed = [], blocks = [];
  const levelUps = (days) => { while (lv < MAX_LEVEL && cum >= th[lv + 1]) passed.push({ level: ++lv, days }); };
  while (day < MAX_SLEEP_DAYS) {
    const need = goal - cum;
    const week = Array.from({ length: 7 }, (_, i) => sleepDay(o.startDay + day + i + 1, o));
    let acc = 0, sleepEnd = null;
    for (let i = 0; i < 7 && sleepEnd == null; i++) { acc += week[i].exp; if (acc >= need) sleepEnd = i + 1; }
    const tk = tickets > 0 ? 1 : 0;
    const nap = napMinutes(need, o.nature, tk);
    const napEnd = nap && nap.minutes <= 7 * DAY_MIN ? nap.minutes / DAY_MIN : null;
    if (sleepEnd != null || napEnd != null) {
      if (napEnd != null && (sleepEnd == null || napEnd < sleepEnd)) {
        cum = goal;
        ticketsSpent += tk;
        blocks.push({ mode: 'nap', from: day, days: napEnd, ticket: tk > 0, half: nap.half });
        levelUps(day + napEnd);
        return { days: day + napEnd, passed, blocks, incense, tickets: ticketsSpent };
      }
      for (let i = 0; i < sleepEnd; i++) { cum += week[i].exp; incense += week[i].incense; levelUps(day + i + 1); }
      blocks.push({ mode: 'sleep', from: day, days: sleepEnd, exp: acc });
      return { days: day + sleepEnd, passed, blocks, incense, tickets: ticketsSpent };
    }
    const sleep7 = acc, nap7 = napExp(7 * DAY_MIN, o.nature, tk);
    if (nap7 > sleep7) {
      cum += nap7;
      tickets -= tk;
      ticketsSpent += tk;
      blocks.push({ mode: 'nap', from: day, days: 7, exp: nap7, ticket: tk > 0 });
      levelUps(day + 7);
    } else {
      week.forEach((w, i) => { cum += w.exp; incense += w.incense; levelUps(day + i + 1); });
      blocks.push({ mode: 'sleep', from: day, days: 7, exp: sleep7, kinds: week.map((w) => w.kind) });
    }
    day += 7;
  }
  return null;
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
