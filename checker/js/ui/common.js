// 厳選チェッカーの画面の小さな部品（ver1.11 で ui.js から分けた）。要素の取得・画像の場所・今のタイプの定義・単位・URL・お知らせ。
// 両アプリで共通の部品は ../dom.js にある。
import { TYPES } from '../types.js';
import { state, hasMon } from '../state.js';

export const $ = (id) => document.getElementById(id);
// ポケモンの画像。img/mon/ はゲーム内のメニュー画像を切り詰めたもの。
export const monSrc = (key) => `img/mon/${key}.webp`;
// 今のタイプの定義（types.js の TYPES）。
export const def = () => TYPES[state.type];
// 数値に小さめの単位を付ける（帯とヒーローの大きな数字用）。
export const withUnit = (v, u) => `${v}<span class="u">${u}</span>`;
// 選んだポケモンを URL にも残して、ブックマークや共有で開けるようにする。
// 未選択のときは ?mon= を外す。
export const syncUrl = () => {
  try { history.replaceState(null, '', hasMon() ? `?mon=${encodeURIComponent(state.mon)}` : location.pathname); } catch { /* history unavailable */ }
};

// 下に出る短いお知らせ。「元に戻す」などの操作を1つだけ持ち、5秒で消える。
// 記録のダイアログを開いているときはダイアログの中に出す（ダイアログの背面に隠れないように）。
let toastFn = null, toastTimer = 0;
export function toast(msg, act, fn) {
  const t = $('toast');
  ($('logDlg').open ? $('logDlg') : document.body).append(t);
  $('toastMsg').textContent = msg;
  $('toastAct').textContent = act;
  toastFn = fn;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
export function hideToast() {
  $('toast').hidden = true;
  toastFn = null;
  clearTimeout(toastTimer);
}
// お知らせの操作のボタン（元に戻す・記録を見る）。
export function initToast() {
  $('toastAct').onclick = () => { const f = toastFn; hideToast(); if (f) f(); };
}
