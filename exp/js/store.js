// 育成日数シミュレーターの保存データ（localStorage の expsim）を読む。DOM非依存（tests/check-exp.mjs で確かめる）。
// 項目ごとに型と範囲を確かめ、壊れた・古い形の項目はその項目だけ既定の値にする（チェッカーの state.js と同じ考え方）。
import { EXP_TYPES, NATURES, MAX_LEVEL } from './data.js';
import { INCENSE } from './calc.js';

export const DEFAULTS = { mon: '', expType: 600, nature: 'none', level: 30, toNext: null, target: 50, candy: 0, shardCap: null, score: 100, bonus: 0, incense: 'none', tickets: 0, start: '', gsd: {}, napMax: 14, boost: 'none', boostLimit: null };

// ポケモンごとに覚える入力と、初めてのポケモンの値（目標はそのまま）。
export const PER_MON = ['level', 'toNext', 'candy', 'target', 'nature'];
export const START = { level: 30, toNext: null, candy: 0, nature: 'none' };

// グッドスリープデーを見込みから前後にずらせる日数。
export const MAX_SHIFT = 3;

const int = (lo, hi) => (v) => Number.isInteger(v) && v >= lo && v <= hi;
const orNull = (ok) => (v) => v === null || ok(v);
const oneOf = (list) => (v) => list.includes(v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// 範囲は画面の入力（main.js の num など）で受け付ける範囲と同じ。始める日（start）は開くたびに今日にするので読まない。
const FIELDS = {
  mon: (v) => typeof v === 'string',
  expType: (v) => typeof v === 'number' && Object.hasOwn(EXP_TYPES, v),
  nature: oneOf(NATURES),
  level: int(1, MAX_LEVEL - 1),
  toNext: orNull(int(1, Infinity)),
  target: int(2, MAX_LEVEL),
  candy: int(0, 9999),
  shardCap: orNull(int(0, Infinity)),
  score: int(0, 100),
  bonus: int(0, 5),
  incense: oneOf(INCENSE),
  tickets: int(0, 99),
  napMax: orNull(int(7, 365)),
  boost: oneOf(['none', 'mini', 'full']),
  boostLimit: orNull(int(0, 99999)),
};
const pick = (x, keys) => Object.fromEntries(keys.filter((k) => Object.hasOwn(x, k) && FIELDS[k](x[k])).map((k) => [k, x[k]]));

// グッドスリープデーの直し { 見込みの満月の日: 'off' | ずらす日数 }。
const okShift = (v) => v === 'off' || (v !== 0 && int(-MAX_SHIFT, MAX_SHIFT)(v));
const cleanGsd = (g) => (isObj(g) ? Object.fromEntries(Object.entries(g).filter(([k, v]) => /^-?\d+$/.test(k) && okShift(v))) : {});

// ポケモンごとの入力 { ポケモン: { level, toNext, candy, target, nature } }。
const cleanByMon = (b) => (isObj(b)
  ? Object.fromEntries(Object.entries(b).filter(([, v]) => isObj(v)).map(([m, v]) => [m, pick(v, PER_MON)]))
  : {});

// 保存した文字列（なければ null）から状態を作る。
export function loadState(text) {
  let x = null;
  try { x = JSON.parse(text); } catch { /* broken JSON */ }
  if (!isObj(x)) x = {};
  return {
    ...DEFAULTS,
    ...pick(x, Object.keys(FIELDS)),
    gsd: cleanGsd(x.gsd),
    byMon: cleanByMon(x.byMon),
  };
}
