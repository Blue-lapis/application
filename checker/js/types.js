// きのみタイプ・食材タイプ・スキルタイプの定義をまとめる。ポケモンのキーは3タイプで重ならない。
import { TYPE_LABELS } from './monpick.js';
import * as ingredient from './ingredient/constants.js';
import * as berry from './berry/constants.js';
import * as skill from './skill/constants.js';
import { mults as ingMults, createEngine as ingEngine } from './ingredient/calc.js';
import { mults as berryMults, createEngine as berryEngine } from './berry/calc.js';
import { mults as skillMults, createEngine as skillEngine } from './skill/calc.js';

// 並び順はタブの順。
export const TYPES = {
  berry: { ...TYPE_LABELS.berry, ...berry, mults: berryMults, createEngine: berryEngine },
  ingredient: { ...TYPE_LABELS.ingredient, ...ingredient, mults: ingMults, createEngine: ingEngine },
  skill: { ...TYPE_LABELS.skill, ...skill, mults: skillMults, createEngine: skillEngine },
};

export const DEFAULT_TYPE = 'berry';

export const typeOf = (mon) => Object.keys(TYPES).find((t) => typeof mon === 'string' && Object.hasOwn(TYPES[t].MONS, mon)) || null;

export const createEngines = () => Object.fromEntries(Object.entries(TYPES).map(([t, d]) => [t, d.createEngine()]));
