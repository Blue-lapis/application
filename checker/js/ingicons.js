// 食材アイコン。img/ing/ の WebP はゲーム内のバッグ画面のスクリーンショットから切り抜き、56×56（表示の最大28pxの2倍）に縮めたもの。
const FILE = {
  'とくせんリンゴ': 'apple', 'げきからハーブ': 'herb', 'マメミート': 'meat', 'モーモーミルク': 'milk',
  'あまいミツ': 'honey', 'ピュアなオイル': 'oil', 'あったかジンジャー': 'ginger', 'あんみんトマト': 'tomato',
  'リラックスカカオ': 'cacao', 'おいしいシッポ': 'tail', 'ワカクサ大豆': 'soybean', 'ワカクサコーン': 'corn',
  'めざましコーヒー': 'coffee', 'ずっしりカボチャ': 'pumpkin', 'つやつやアボカド': 'avocado',
  'ふといながねぎ': 'leek', 'あじわいキノコ': 'mushroom', 'とくせんエッグ': 'egg', 'ほっこりポテト': 'potato',
};
const EXT = 'webp';

// 装飾なので alt は空にする（横に食材名を必ず出す）。
export const ingIcon = (name) => (FILE[name] ? `<img class="ing" src="img/ing/${FILE[name]}.${EXT}" alt="" width="20" height="20">` : '');
