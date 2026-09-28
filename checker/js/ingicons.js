// 食材アイコン。img/ing/ の PNG はゲーム内のバッグ画面のスクリーンショットから切り抜いたもの。
const FILE = {
  'とくせんリンゴ': 'apple', 'げきからハーブ': 'herb', 'マメミート': 'meat', 'モーモーミルク': 'milk',
  'あまいミツ': 'honey', 'ピュアなオイル': 'oil', 'あったかジンジャー': 'ginger', 'あんみんトマト': 'tomato',
  'リラックスカカオ': 'cacao', 'おいしいシッポ': 'tail', 'ワカクサ大豆': 'soybean', 'ワカクサコーン': 'corn',
  'めざましコーヒー': 'coffee', 'ずっしりカボチャ': 'pumpkin', 'つやつやアボカド': 'avocado',
  'ふといながねぎ': 'leek', 'あじわいキノコ': 'mushroom', 'とくせんエッグ': 'egg', 'ほっこりポテト': 'potato',
};
const EXT = 'png';

// 装飾なので alt は空にする（横に食材名を必ず出す）。
export const ingIcon = (name) => (FILE[name] ? `<img class="ing" src="img/ing/${FILE[name]}.${EXT}" alt="" width="20" height="20">` : '');
