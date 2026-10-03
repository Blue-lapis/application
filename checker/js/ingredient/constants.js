// 食材タイプ版だけで使う定義。サブスキル・性格・げんきなどの共通データは ../../js/constants.js を使う。
import { cat, slotWeights, ingOpen, ING_UNLOCK } from '../../../js/constants.js';

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
// 評価のしかた。'count' は狙い食材の個数、'energy' はすべての食材ときのみの1日のエナジー（ver1.12）。
export const BYS = ['count', 'energy'];
// おてつだいボーナスのチーム効果は、ほかの4匹を同じポケモン（基準の食材配列・サブスキルなし・無補正性格）として数える。

// スキル補正は食材の個数に影響しないので「なし他」と同じ扱いにする。げんき回復量は睡眠中のおてつだいの速さに効く。
export const natCat = (s) => {
  if (s === 'en') return 'energy';
  const c = cat(s);
  return c === 'skill' ? 'other' : c;
};

// 食材配列 arr はスロットごとの候補の番号（例: [0, 0, 0] = AAA）。
export const arrName = (mon, arr) => arr.map((k, i) => mon.slots[i][k][0]).join('');

// 狙い食材がレベル lv で開いている食材の枠に出るか。出ないとき（Lv.50 で Lv.60 の枠だけに出る食材）は
// 無補正の個体の個数も0になり、無補正比（0 ÷ 0）・確率・順位は出せない。
export const targetOpen = (mon, lv, target) => mon.slots.slice(0, ingOpen(lv)).some((opts) => opts.some(([k]) => k === target));
// 狙い食材が出る最初の食材の枠のレベル（1 / 30 / 60）。
export const targetLevel = (mon, target) => ING_UNLOCK[mon.slots.findIndex((opts) => opts.some(([k]) => k === target))];

// 開いている n 枠のすべての食材配列と、その出現確率（各スロットの候補の確率は slotWeights）。ポケモンと枠の数ごとに使い回す。
const arrCache = new WeakMap();
export function allArrs(mon, n = mon.slots.length) {
  if (!arrCache.has(mon)) arrCache.set(mon, new Map());
  const cache = arrCache.get(mon);
  if (!cache.has(n)) {
    cache.set(n, mon.slots.slice(0, n).reduce(
      (acc, opts) => acc.flatMap(({ arr, p }) => opts.map((_, k) => ({ arr: [...arr, k], p: p * slotWeights(opts.length)[k] }))),
      [{ arr: [], p: 1 }],
    ));
  }
  return cache.get(n);
}
