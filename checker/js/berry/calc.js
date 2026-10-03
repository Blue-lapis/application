// きのみタイプ向けの期待値計算エンジン。DOM に触れない。
// 倍率・げんきの推移・おてつだい回数・分布の数え上げは共通の部品（../engine.js）を使う。
// 呼び出し側は env = { lv, N, camp, mon, heal, tap, team, healAmt, healTimes } を渡す（lv はレベル、N はサブスキルの枠の数）。mon は MONS のキー。
// heal はヒーラーの数（0/1/2）か 'g80'（げんき常に81%以上）、tap は日中の受け取り（'none' / '3h'）、
// team はおてつだいボーナスのチームへの効果を含めるか。
import { fillCurve, NO_SUBS, AWAKE_SEC, DAY_SEC } from '../../../js/calc.js';
import { mk, mults as multsOf, mixed, timesMix, curveOf, energyAt, scheduleOf, pairSegs, basics, amountPatterns, buildDist, distStore } from '../engine.js';
import { MONS, natCat, TEAM_OTHERS, HB_SPEED, FAV_MUL } from './constants.js';

// きのみタイプの berry はきのみの数Sで増える個数。1回あたりの個数はポケモンの基礎値に足して prepare で決める。
export const mults = (subs, up, down) => multsOf(subs, up, down, 0);

// 1日のおてつだい回数を、所持品の受け取りで区切った区間ごとに [日中, 睡眠中] で返す（期待値なので小数）。
// 「3時間ごと」は起床中に3時間ごとと就寝時に受け取り、睡眠は所持数0から始まる。
// 「なし」は区切らない（すべてきのみになるので区間は使わない）。

export function prepare(m, env) {
  const mon = MONS[env.mon];
  const b = basics(mon, m, env);
  const berry = mon.berries + m.berry;
  const energy = berryEnergy(mon.berryBase, b.LV);
  const segs = scheduleOf(b.Te, env, m.wake, m.rec, pairSegs);
  const sum = (i) => segs.reduce((s, x) => s + x[i], 0);
  return { ...b, berry, energy, segs, Ha: sum(0), Hs: sum(1), noTap: env.tap === 'none' };
}

// 所持品を受け取ってから次に受け取るまで（日中 ha 回・睡眠中 hs 回のおてつだい）で拾うきのみと食材の期待個数。
// 受け取った時点で所持数0から始まる。
// 満タンになるまでは、食材確率で食材おてつだい（amts から均等に1つ選んだ個数）、それ以外はきのみおてつだい。
// 満タンになった後は食材確率に関係なくきのみだけを拾い、あふれたきのみはエナジーになる（いつのまに育成）。
// あふれた食材は捨てられる。
// きのみ = berry × (おてつだい回数 − 満タンになる前の食材おてつだい回数) になる。
// c は所持数の遷移（共通の fillCurve）で、回数が違っても同じ遷移を使い回す。
export function dayBerries(c, ha, hs) {
  const k = ha + hs;
  c.upTo(k);
  const full = 1 - c.open[k];
  return {
    day: c.berries[ha],
    night: c.berries[k] - c.berries[ha],
    ings: c.ings[k],
    fullBed: hs ? 1 - c.open[ha] : full,
    full,
  };
}

// レベル Lv のきのみ1個のエナジー。
export const berryEnergy = (base, lv) => Math.max(base + lv - 1, Math.round(base * 1.025 ** (lv - 1)));

// フィールドボーナス（bonus %）と好きなきのみ（fav）を掛けたきのみ1個のエナジー。
// どちらも1個ごとに切り上げる（にとよんツールと同じ）。浮動小数の誤差で切り上がらないよう、ボーナスは整数で割る。
// 倍率は自分・ほかのメンバー・無補正の個体（どれも同じポケモン・同じレベル）に同じだけ掛かるので、
// 無補正比・分布・順位は変わらない。そのため計算エンジン（metric・分布）には入れず、表示にだけ使う。
export const boostedEnergy = (energy, bonus, fav) => Math.ceil(Math.ceil(energy * (100 + bonus) / 100) * (fav ? FAV_MUL : 1));

// 1日を受け取りで区切った区間ごとに所持数0から追い、足し合わせる。
// 満タンになる確率は、fullBed が就寝時（就寝時に受け取るなら、その直前の区間の終わり）、full が起床時。
// 受け取りなしは一度も受け取らないので、所持数はずっと満タンで、すべてのおてつだいがきのみになる。
// 食材配列は入力しないので、配列ごとの値を出現確率で平均する。
function runDays(r) {
  if (r.noTap) return { day: r.berry * r.Ha, night: r.berry * r.Hs, ings: 0, fullBed: 1, full: 1 };
  const o = { day: 0, night: 0, ings: 0, fullBed: 0, full: 0 };
  const last = r.segs.length - 1;
  // 最後の区間が睡眠中だけなら、就寝時に受け取っている。
  const bedAt = last > 0 && r.segs[last][0] === 0 ? last - 1 : last;
  for (const { amts, p } of amountPatterns(MONS[r.mon], r.ingSlots)) {
    const c = fillCurve(r.cap, r.ingP, r.berry, amts);
    r.segs.forEach(([ha, hs], i) => {
      const v = segBerries(c, ha, hs);
      o.day += p * v.day;
      o.night += p * v.night;
      o.ings += p * v.ings;
      if (i === bedAt) o.fullBed += p * (i === last ? v.fullBed : v.full);
      if (i === last) o.full += p * v.full;
    });
  }
  return o;
}

// おてつだい回数が小数の区間は、前後の整数回の結果を小数部分の割合で混ぜる（にとよんツールと同じ）。
// 区間は日中だけか睡眠中だけ（どちらかが0）なので、小数部分は回数のあるほうに付く。結果は区間の種類と回数ごとに使い回す。
export function segBerries(c, ha, hs) {
  const night = hs > 0;
  const n = night ? hs : ha;
  return c.cached(night ? 'night' : 'day', n, () => {
    const lo = Math.floor(n), f = n - lo;
    const at = (k) => (night ? dayBerries(c, 0, k) : dayBerries(c, k, 0));
    if (f < 1e-12) return at(lo);
    const a = at(lo), b = at(lo + 1);
    return Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b[k] - a[k]) * f]));
  });
}

// 表示用の1日の値。発動回数が小数のときは、回数に関係する値を前後の整数回の日の割合で平均する。
const MIXED_KEYS = ['day', 'night', 'ings', 'fullBed', 'full', 'Ha', 'Hs'];
export function daily(m, env) {
  const parts = timesMix(env).map(([e, w]) => [dailyOne(m, e), w]);
  const out = { ...parts[0][0], genki: energyAt(env, m.wake, m.rec), wakeE: Math.round(mixed(env, (e) => curveOf(e, m.wake, m.rec)(0))) };
  MIXED_KEYS.forEach((k) => { out[k] = parts.reduce((s, [d, w]) => s + w * d[k], 0); });
  return out;
}

function dailyOne(m, env) {
  const r = { ...prepare(m, env), mon: env.mon };
  const d = runDays(r);
  return { ...r, ...d };
}

export const envKey = (env) => [env.lv, env.N, env.camp, env.mon, env.heal, env.tap, env.team, env.healAmt, env.healTimes].join('|');

export function createEngine() {
  const metricCache = new Map();

  // 自分のきのみのエナジー（きのみ1個のエナジー × 個数）。発動回数が小数のときは前後の整数回の日の割合で平均する。
  const metric = (m, env) => mixed(env, (e) => metricOne(m, e));
  function metricOne(m, env) {
    const r = { ...prepare(m, env), mon: env.mon };
    const key = `${envKey(env)}|${r.Te}|${r.ingP.toFixed(8)}|${r.cap}|${r.berry}|${m.wake}|${m.rec}`;
    if (!metricCache.has(key)) {
      const d = runDays(r);
      metricCache.set(key, (d.day + d.night) * r.energy);
    }
    return metricCache.get(key);
  }

  // 比較の基準は無補正個体（サブスキルなし・無補正性格、食材配列は全パターンの平均）。
  const baseMetric = (env) => metric(mk(NO_SUBS, null, null), env);

  // おてつだいボーナスによる、ほかのメンバー1匹のエナジーの増加分。
  // ほかのメンバーは同じポケモン・サブスキルなし・無補正性格で、おてつだいスピードが HB_SPEED だけ上がる。
  const memberGain = (env) => metric(mk({ ...NO_SUBS, sp: HB_SPEED }, null, null), env) - baseMetric(env);
  // チームへの効果（ほかの TEAM_OTHERS 匹の増加分の合計）。おてつだいボーナスを持たないか、含めない設定なら0。
  const teamGain = (m, env) => (env.team && m.hb ? TEAM_OTHERS * memberGain(env) : 0);
  // 順位の基準の値 = 自分のきのみのエナジー + チームへの効果。
  const value = (m, env) => metric(m, env) + teamGain(m, env);
  const score = (subs, up, down, env) => value(mults(subs, up, down), env) / baseMetric(env);

  // 上位%の分布は、サブスキル（色別抽選・重複なし）と性格25種をすべて数え上げる。
  // スキル確率アップはきのみに影響しないので、それ以外の効果が同じ組み合わせをまとめる。
  const store = distStore(envKey, (env) => {
    const b = baseMetric(env);
    return buildDist(env.N, natCat, true, (e, u, d) => [[value(mk(e, u, d), env) / b, 1]], MONS[env.mon]);
  });

  return { metric, baseMetric, teamGain, value, score, daily, ...store };
}
