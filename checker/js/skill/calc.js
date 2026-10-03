// スキルタイプ向けの期待値計算エンジン。DOM に触れない。
// 倍率・げんきの推移・おてつだい回数・分布の数え上げは共通の部品（../engine.js）を使い、
// 共通の計算（../../../js/calc.js の抽選回数・ストックの発動回数）を、ポケモンごとの基礎値・天井・食材の個数で使う。
// スキルの数え方はにとよんツールと同じ（天井込みの実質確率で抽選し、満タン後は抽選しない）。
// 呼び出し側は env = { lv, N, camp, mon, heal, tap, team, healAmt, healTimes } を渡す（lv はレベル、N はサブスキルの枠の数）。
// heal・healAmt・healTimes・team はきのみタイプと共通、tap は日中の受け取り（'always' / '3h'、食材タイプと共通）。
import { eff, rateOf, fillCurve, curveRolls, stockSkills, NO_SUBS } from '../../../js/calc.js';
import { mk as mkOf, mults as multsOf, mixed, timesMix, curveOf, energyAt, scheduleOf, basics, amountPatterns, buildDist, distStore } from '../engine.js';
import { TEAM_OTHERS, HB_SPEED } from '../berry/constants.js';
import { MONS, natCat, ceilOf } from './constants.js';

// スキルタイプの berry は1回のきのみおてつだいで拾う個数（1＋きのみの数S）。
const mk = (e, up, down) => mkOf(e, up, down, 1);
export const mults = (subs, up, down) => multsOf(subs, up, down, 1);

// 1日のおてつだい回数を、所持品の受け取りで区切った区間ごとに { night, tap, n } で返す（期待値なので小数）。
// 「常にタップ」は日中を1区間とし、所持数を見ない（tap）。「3時間ごと」は起床中に3時間ごとと就寝時に受け取る。
const segsShape = (awake, sleep, env) => {
  const tap = env.tap !== '3h';
  return [...awake.map((n) => ({ night: false, tap, n })), { night: true, tap: false, n: sleep }];
};

export function prepare(m, env) {
  const mon = MONS[env.mon];
  const b = basics(mon, m, env);
  const segs = scheduleOf(b.Te, env, m.wake, m.rec, segsShape);
  const sum = (night) => segs.reduce((s, x) => s + (x.night === night ? x.n : 0), 0);
  return { ...b, p: rateOf(mon.skillP, m.skillMul), ceil: ceilOf(mon), segs, Ha: sum(false), Hs: sum(true) };
}

// 1日の期待発動回数。天井込みの実質確率 pe = eff(p, ceil) で抽選する。
// 常にタップする日中の区間は、おてつだい n 回（小数）のすべてで抽選する（n × pe）。
// それ以外の区間（3時間ごとの受け取りの区間と睡眠中）は所持数0から追い、ストックは2回まで（stockSkills）。
// rolls は区間の curveRolls の結果。
function daySkills(r, segs) {
  const pe = eff(r.p, r.ceil);
  const o = { day: 0, night: 0, rolls: 0, full: 0 };
  for (const s of segs) {
    if (s.tap) { o.day += s.n * pe; continue; }
    const got = stockSkills(pe, s.rolls.P);
    if (s.night) {
      o.night += got;
      o.rolls = s.rolls.P.reduce((a, w, k) => a + w * k, 0);
      o.full = s.rolls.full;
    } else {
      o.day += got;
    }
  }
  return o;
}

// 食材配列は入力しないので、配列ごとの結果を出現確率で平均する。
// 区間の抽選回数は、所持数0から n 回（小数）おてつだいしたときの分布（curveRolls）。berry は1回に拾うきのみの個数。
function averagePatterns(r, mon, berry) {
  const o = { day: 0, night: 0, rolls: 0, full: 0 };
  for (const { amts, p } of amountPatterns(mon, r.ingSlots)) {
    const c = fillCurve(r.cap, r.ingP, berry, amts);
    const d = daySkills(r, r.segs.map((s) => (s.tap ? s : { ...s, rolls: curveRolls(c, s.n) })));
    Object.keys(o).forEach((k) => { o[k] += p * d[k]; });
  }
  return o;
}

// 表示用の1日の値。発動回数が小数のときは、回数に関係する値を前後の整数回の日の割合で平均する。
const MIXED_KEYS = ['day', 'night', 'rolls', 'full', 'Ha', 'Hs'];
export function daily(m, env) {
  const parts = timesMix(env).map(([e, w]) => {
    const r = prepare(m, e);
    const d = averagePatterns(r, MONS[e.mon], m.berry);
    return [{ ...r, ...d }, w];
  });
  const out = { ...parts[0][0], genki: energyAt(env, m.wake, m.rec), wakeE: Math.round(mixed(env, (e) => curveOf(e, m.wake, m.rec)(0))) };
  MIXED_KEYS.forEach((k) => { out[k] = parts.reduce((s, [d, w]) => s + w * d[k], 0); });
  return out;
}

export const envKey = (env) => [env.lv, env.N, env.camp, env.mon, env.heal, env.tap, env.team, env.healAmt, env.healTimes].join('|');

export function createEngine() {
  const metricCache = new Map();

  // 自分の1日の期待スキル発動回数（日中＋睡眠中）。発動回数が小数のときは前後の整数回の日の割合で平均する。
  const metric = (m, env) => mixed(env, (e) => metricOne(m, e));
  function metricOne(m, env) {
    const r = prepare(m, env);
    const key = `${envKey(env)}|${r.Te}|${r.p}|${r.ingP}|${r.cap}|${m.berry}|${m.wake}|${m.rec}`;
    if (!metricCache.has(key)) {
      const d = averagePatterns(r, MONS[env.mon], m.berry);
      metricCache.set(key, d.day + d.night);
    }
    return metricCache.get(key);
  }

  const baseMetric = (env) => metric(mk(NO_SUBS, null, null), env);

  // ほかのメンバー TEAM_OTHERS 匹（同じポケモン・サブスキルなし・無補正性格・食材配列は出現率で平均）が、
  // おてつだいボーナスでおてつだいスピードが HB_SPEED 上がって増やす発動回数の合計。
  const gainCache = new Map();
  function teamGain(env) {
    const k = envKey(env);
    if (!gainCache.has(k)) gainCache.set(k, TEAM_OTHERS * (metric(mk({ ...NO_SUBS, sp: HB_SPEED }, null, null), env) - baseMetric(env)));
    return gainCache.get(k);
  }
  // チームへの効果。おてつだいボーナスを持たないか、含めない設定なら0。
  const team = (m, env) => (env.team && m.hb ? teamGain(env) : 0);
  // 順位の基準の値 = 自分の発動回数 + チームへの効果。
  const value = (m, env) => metric(m, env) + team(m, env);
  const score = (subs, up, down, env) => value(mults(subs, up, down), env) / baseMetric(env);

  // 上位%の分布は、サブスキル（色別抽選・重複なし）と性格25種（ストリンダーは姿に付くものだけ）をすべて数え上げる。
  const store = distStore(envKey, (env) => {
    const b = baseMetric(env);
    return buildDist(env.N, natCat, false, (e, u, d) => [[value(mk(e, u, d), env) / b, 1]], MONS[env.mon]);
  });

  return { metric, baseMetric, teamGain, team, score, daily, ...store };
}
