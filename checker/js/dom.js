// 厳選チェッカーと育成日数シミュレーター（exp/）の画面で共通の部品。HTML のエスケープ、線のアイコン、表示テーマの切り替え。
// 計算のコードには依存しない。

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// 線で描くアイコン（24×24 の座標）。d は中に入れる SVG の要素。
export const icon = (d, size = 20, width = 2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
// カードの右端などに置く ＞。
export const CHEV = icon('<path d="M9 6l6 6-6 6"/>', 14, 2.4);

// 表示テーマ。自動（端末の設定）→ライト→ダークの順に切り替え、cktheme に保存する（両アプリで同じ設定）。
// 描画前の適用はそれぞれの index.html でする。btn は切り替えのボタン。
const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: '自動', light: 'ライト', dark: 'ダーク' };
const THEME_ICON = {
  auto: icon('<circle cx="12" cy="12" r="8"/><path d="M12 4v16" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'),
  light: icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  dark: icon('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
};
export function initTheme(btn) {
  let cur = 'auto';
  try { const t = JSON.parse(localStorage.getItem('cktheme')); if (THEMES.includes(t)) cur = t; } catch { /* storage unavailable */ }
  const show = () => {
    const root = document.documentElement;
    if (cur === 'auto') delete root.dataset.theme; else root.dataset.theme = cur;
    btn.innerHTML = THEME_ICON[cur];
    btn.setAttribute('aria-label', `表示テーマ: ${THEME_LABEL[cur]}（押すと切り替え）`);
    btn.title = `表示テーマ: ${THEME_LABEL[cur]}`;
  };
  btn.onclick = () => {
    cur = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    try { localStorage.setItem('cktheme', JSON.stringify(cur)); } catch { /* storage unavailable */ }
    show();
  };
  show();
}
