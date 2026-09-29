// 食材タイプ版だけで使う定義。サブスキル・性格・げんきなどの共通データは ../../js/constants.js を使う。
import { cat, slotWeights } from '../../../js/constants.js';

// ポケモンごとの基礎値は mons.js にまとめる。
export { MONS } from './mons.js';
export const DEFAULT_MON = 'flygon';

export const SLOT_LV = ['Lv.1', 'Lv.30', 'Lv.60'];

// 食材の個数に影響するサブスキル。スキル確率アップなどは「なし他」にまとめる。
export const PICK = ['ingM', 'ingS', 'spM', 'spS', 'hb', 'berry', 'invS', 'invM', 'invL', 'erb', 'none'];

export const NATL = { ing: '食材', speed: 'おてスピ', energy: 'げんき回復', other: 'なし他' };
export const NAT_CATS = ['ing', 'speed', 'energy', 'other'];

// 日中の受け取り。「常にタップ」は所持数があふれない。「3時間ごと」は起床から3時間ごとと就寝時に受け取る。
// ヒーラー・回復量・発動回数はきのみタイプと共通（../berry/constants.js）。
export const TAPS = ['always', '3h'];
export const TAP_EVERY = { always: 0, '3h': 3 * 3600 };
// おてつだいボーナスのチーム効果は、ほかの4匹を同じポケモン（基準の食材配列・サブスキルなし・無補正性格）として数える。

// スキル補正は食材の個数に影響しないので「なし他」と同じ扱いにする。げんき回復量は睡眠中のおてつだいの速さに効く。
export const natCat = (s) => {
  if (s === 'en') return 'energy';
  const c = cat(s);
  return c === 'skill' ? 'other' : c;
};

// 食材配列 arr はスロットごとの候補の番号（例: [0, 0, 0] = AAA）。
export const arrName = (mon, arr) => arr.map((k, i) => mon.slots[i][k][0]).join('');

// すべての食材配列と、その出現確率（各スロットの候補の確率は slotWeights）。ポケモンごとに使い回す。
const arrCache = new WeakMap();
export function allArrs(mon) {
  if (!arrCache.has(mon)) {
    arrCache.set(mon, mon.slots.reduce(
      (acc, opts) => acc.flatMap(({ arr, p }) => opts.map((_, k) => ({ arr: [...arr, k], p: p * slotWeights(opts.length)[k] }))),
      [{ arr: [], p: 1 }],
    ));
  }
  return arrCache.get(mon);
}
