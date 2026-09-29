// スキルタイプ版だけで使う定義。サブスキル・性格・げんきなどの共通データは ../../../js/constants.js を使う。
import { cat } from '../../../js/constants.js';

// ポケモンごとの基礎値は mons.js にまとめる。
export { MONS } from './mons.js';
export const DEFAULT_MON = 'mewtwo';

// スキル発動回数に影響するサブスキル。スキルレベルアップなどは「なし他」にまとめる。
export const PICK = ['skM', 'skS', 'spM', 'spS', 'hb', 'berry', 'invS', 'invM', 'invL', 'ingM', 'ingS', 'erb', 'none'];

export const NATL = { skill: 'スキル', speed: 'おてスピ', ing: '食材', energy: 'げんき回復', other: 'なし他' };
export const NAT_CATS = ['skill', 'speed', 'ing', 'energy', 'other'];

// 日中の受け取りは食材タイプと同じ選択肢で、設定も共通（ヒーラー・回復量・発動回数はきのみタイプと共通）。
export { TAPS, TAP_EVERY } from '../ingredient/constants.js';
// おてつだいボーナスのチーム効果は、ほかの4匹を同じポケモン（サブスキルなし・無補正性格）として数える。

// げんき回復量は睡眠中のおてつだいの速さに効く。
export const natCat = (s) => (s === 'en' ? 'energy' : cat(s));

// 発動が確定するおてつだいの回数。スキルとくいは Ceil[142000 / 基準おてつだい時間] 回続けて不発なら、次のおてつだいで発動する
// （にとよんツールと同じ。基準おてつだい時間で約40時間分）。
export const ceilOf = (mon) => Math.ceil(142000 / mon.time) + 1;
