// きのみタイプ版だけで使う定義。サブスキル・性格・げんきなどの共通データは ../../js/constants.js を使う。
import { cat } from '../../../js/constants.js';

// ポケモンごとの基礎値は mons.js にまとめる。
export { MONS } from './mons.js';
export const DEFAULT_MON = 'walrein';

// パラメーター（きのみタイプだけ）。ヒーラーは げんきオールS を持つポケモンの数（なし / 1匹）で、'g80' は「常に81%以上」。
// 以前あった「2匹」を保存していた人は、読み込み時に既定の1匹に戻る。
export const HEALS = [0, 1, 'g80'];
export const TAPS = ['none', '3h'];
// げんきオールS の1回の回復量と、ヒーラー1匹あたりの1日の発動回数の既定値。
export const HEAL_AMT = 18;
export const HEAL_TIMES = 3;
export const PARAM_LIMITS = { healAmt: [1, 150], healTimes: [0, 20], fieldBonus: [0, 500] };
// フィールドボーナス（%）の既定値と、好きなきのみのエナジーの倍率。どちらもきのみのエナジーにだけ掛かる。
export const FIELD_BONUS = 0;
export const FAV_MUL = 2;
// 日中の受け取り「3時間ごと」は、起床から3時間ごとに所持品を受け取る（起床中だけ）。
export const TAP_EVERY = { none: 0, '3h': 3 * 3600 };
// おてつだいボーナスでおてつだい時間が短くなる、ほかのメンバーの数と短縮率。
export const TEAM_OTHERS = 4;
export const HB_SPEED = 0.05;
// 進化1回ごとに増える最大所持数。
export const EVO_CAP = 5;

// きのみの個数に影響するサブスキル。スキル確率アップなどは「なし他」にまとめる。
export const PICK = ['berry', 'spM', 'spS', 'hb', 'invS', 'invM', 'invL', 'erb', 'ingM', 'ingS', 'none'];

export const NATL = { speed: 'おてスピ', ing: '食材', energy: 'げんき回復', other: 'なし他' };
export const NAT_CATS = ['speed', 'ing', 'energy', 'other'];
// 性格のげんき回復量の補正（睡眠とげんきオールSの回復量に掛かる。料理の回復には掛からない）。
export const ENERGY_REC = { up: 1.2, down: 0.88 };

// スキル補正はきのみの個数に影響しないので「なし他」と同じ扱いにする。げんき回復量は睡眠中のおてつだいの速さに効く。
export const natCat = (s) => {
  if (s === 'en') return 'energy';
  const c = cat(s);
  return c === 'skill' ? 'other' : c;
};
