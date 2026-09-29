// きのみタイプ版だけで使う定義。サブスキル・性格・げんきなどの共通データは ../../js/constants.js を使う。
import { cat } from '../../../js/constants.js';

// ポケモンごとの基礎値は mons.js にまとめる。
export { MONS } from './mons.js';
export const DEFAULT_MON = 'walrein';

// パラメーター（きのみタイプだけ）。ヒーラーは げんきオールS を持つポケモンの数で、'g80' は「常に81%以上」。
export const HEALS = [0, 1, 2, 'g80'];
export const TAPS = ['none', '3h'];
// げんきオールS の1回の回復量と、ヒーラー1匹あたりの1日の発動回数の既定値。
export const HEAL_AMT = 18;
export const HEAL_TIMES = 3;
export const PARAM_LIMITS = { healAmt: [1, 150], healTimes: [0, 20] };
// 日中の受け取り「3時間ごと」は、起床から3時間ごとに所持品を受け取る（起床中だけ）。
export const TAP_EVERY = { none: 0, '3h': 3 * 3600 };
// おてつだいボーナスでおてつだい時間が短くなる、ほかのメンバーの数と短縮率。
export const TEAM_OTHERS = 4;
export const HB_SPEED = 0.05;

// きのみの個数に影響するサブスキル。スキル確率アップなどは「なし他」にまとめる。
export const PICK = ['berry', 'spM', 'spS', 'hb', 'invS', 'invM', 'invL', 'erb', 'ingM', 'ingS', 'none'];

export const NATL = { speed: 'おてスピ', ing: '食材', other: 'なし他' };
export const NAT_CATS = ['speed', 'ing', 'other'];

// スキル補正はきのみの個数に影響しないので「なし他」と同じ扱いにする。
export const natCat = (s) => {
  const c = cat(s);
  return c === 'skill' ? 'other' : c;
};

// すべての食材配列について、各スロットで拾う個数と出現確率（各スロットの候補は等確率）。
// きのみの計算では食材の種類は関係ないので、個数の並びが同じ配列はまとめる。
export function amountPatterns(mon) {
  const all = mon.slots.reduce(
    (acc, opts) => acc.flatMap(({ amts, p }) => opts.map(([, a]) => ({ amts: [...amts, a], p: p / opts.length }))),
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
