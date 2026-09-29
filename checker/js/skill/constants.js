// スキルタイプ版だけで使う定義。サブスキル・性格・げんきなどの共通データは ../../../js/constants.js を使う。
import { cat, slotWeights } from '../../../js/constants.js';

// ポケモンごとの基礎値は mons.js にまとめる。
export { MONS } from './mons.js';
export const DEFAULT_MON = 'mewtwo';

// スキル発動回数に影響するサブスキル。スキルレベルアップなどは「なし他」にまとめる。
export const PICK = ['skM', 'skS', 'spM', 'spS', 'hb', 'berry', 'invS', 'invM', 'invL', 'ingM', 'ingS', 'erb', 'none'];

export const NATL = { skill: 'スキル', speed: 'おてスピ', ing: '食材', other: 'なし他' };
export const NAT_CATS = ['skill', 'speed', 'ing', 'other'];

export const natCat = cat;

// 連続不発の天井。スキルとくいは基準おてつだい時間で約40時間分（Floor[144000 / 基準おてつだい時間]）。
export const ceilOf = (mon) => Math.floor(144000 / mon.time);

// すべての食材配列について、各スロットで拾う個数と出現確率（各スロットの候補の確率は slotWeights）。
// スキル発動回数の計算では食材の種類は関係ないので、個数の並びが同じ配列はまとめる。
export function amountPatterns(mon) {
  const all = mon.slots.reduce(
    (acc, opts) => acc.flatMap(({ amts, p }) => opts.map(([, a], k) => ({ amts: [...amts, a], p: p * slotWeights(opts.length)[k] }))),
    [{ amts: [], p: 1 }],
  );
  const out = new Map();
  for (const { amts, p } of all) {
    const k = amts.join(',');
    const o = out.get(k);
    if (o) o.p += p; else out.set(k, { amts, p });
  }
  return [...out.values()];
}
