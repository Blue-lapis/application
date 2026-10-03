// きのみタイプ・食材タイプ・スキルタイプの定義をまとめる。ポケモンのキーは3タイプで重ならない。
import { TYPE_LABELS } from './monpick.js';
import * as ingredient from './ingredient/constants.js';
import * as berry from './berry/constants.js';
import * as skill from './skill/constants.js';
import { mults as ingMults, createEngine as ingCountEngine } from './ingredient/calc.js';
import { createEngine as ingEnergyEngine, byEnergy } from './ingredient/energycalc.js';
import { mults as berryMults, createEngine as berryEngine } from './berry/calc.js';
import { mults as skillMults, createEngine as skillEngine } from './skill/calc.js';

// 食材タイプは、条件（env）の by が 'energy' ならエナジーのエンジン（./ingredient/energycalc.js）、
// それ以外は狙い食材の個数のエンジン（./ingredient/calc.js）に、そのまま渡す。どちらのエンジンも書き換えない。
// [関数の名前, 引数のうち env の位置]。
const ING_METHODS = [
  ['metric', 2], ['value', 2], ['daily', 2], ['team', 1], ['reference', 0], ['baseMetric', 0], ['score', 4],
  ['dist', 0], ['ready', 0], ['setDist', 0], ['atLeast', 1], ['rankOf', 1],
];
function ingEngine() {
  const count = ingCountEngine(), energy = ingEnergyEngine();
  return Object.fromEntries(ING_METHODS.map(([name, at]) => [name, (...args) => (byEnergy(args[at]) ? energy : count)[name](...args)]));
}

// 並び順はタブの順。
export const TYPES = {
  berry: { ...TYPE_LABELS.berry, ...berry, mults: berryMults, createEngine: berryEngine },
  ingredient: { ...TYPE_LABELS.ingredient, ...ingredient, mults: ingMults, createEngine: ingEngine },
  skill: { ...TYPE_LABELS.skill, ...skill, mults: skillMults, createEngine: skillEngine },
};

export const DEFAULT_TYPE = 'berry';
// 日中の受け取りの初期値（3タイプとも3時間ごと）。事前計算の範囲（precomputed.js）もこれに合わせる。
export const DEFAULT_TAP = '3h';

export const typeOf = (mon) => Object.keys(TYPES).find((t) => typeof mon === 'string' && Object.hasOwn(TYPES[t].MONS, mon)) || null;

export const createEngines = () => Object.fromEntries(Object.entries(TYPES).map(([t, d]) => [t, d.createEngine()]));
