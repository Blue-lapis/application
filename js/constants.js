// ゲーム定数とサブスキル・性格の定義。数値の意味と出典は README.md を参照。
export const SLEEP = 8.5;
// サブスキルの枠が開くレベル。枠の数 N ごとに、計算は LEVEL[N] で行う（次の枠が開く直前か、その枠が開いたレベル）。
export const UNLOCK = [10, 25, 50, 70, 80];
export const LEVEL = { 3: 60, 4: 70, 5: 80 };

// げんきはおてつだい中・睡眠中を問わず10分ごとに1減る。起床時は睡眠回復で100（げんき回復ボーナス持ちは105）。
export const ENERGY_TICK = 600;
export const WAKE_ENERGY = 100;
export const WAKE_ENERGY_ERB = 105;
// げんきによるおてつだい時間の倍率（Ver.1.8.1以降）。[下限げんき, 倍率] を上から判定する。
export const ENERGY_BANDS = [[81, 0.45], [61, 0.52], [41, 0.58], [1, 0.66], [0, 1]];
// 所持数が満タンになった後も、おてつだいキューに積まれている残り4回分はスキル抽選が行われる。
export const QUEUE_AFTER_FULL = 4;
// おてつだいのタイミングは日をまたいで持ち越すため、捨て日を回してから DAYS 日分を平均する。
// 天井カウンタの分布も CHAIN_WARMUP 日ぶん慣らしてから数える。
export const WARMUP_DAYS = 6;
export const CHAIN_WARMUP = 3;
export const DAYS = 8;

// 1枠ごとにまず色を抽選し、その色の中で未所持のサブスキルから均等に1つ選ぶ。
export const RARITY_P = { gold: 0.14, blue: 0.33, white: 0.53 };

export const SUBS = [
  { id: 'skM', name: 'スキルM', rarity: 'blue', skill: 0.36 },
  { id: 'skS', name: 'スキルS', rarity: 'white', skill: 0.18 },
  { id: 'spM', name: 'おてスピM', rarity: 'blue', speed: 0.14 },
  { id: 'spS', name: 'おてスピS', rarity: 'white', speed: 0.07 },
  { id: 'hb', name: 'おてボ', rarity: 'gold', speed: 0.05 },
  { id: 'invS', name: '所持数S', rarity: 'white', inv: 6 },
  { id: 'invM', name: '所持数M', rarity: 'blue', inv: 12 },
  { id: 'invL', name: '所持数L', rarity: 'blue', inv: 18 },
  { id: 'berry', name: 'きのみS', rarity: 'gold', berry: 1 },
  { id: 'erb', name: 'げんき回復', rarity: 'gold', erb: true },
  { id: 'ingM', name: '食材M', rarity: 'blue', ing: 0.36 },
  { id: 'ingS', name: '食材S', rarity: 'white', ing: 0.18 },
  // スキル発動回数に影響しないもの
  { id: 'xExp', rarity: 'gold' },
  { id: 'xShard', rarity: 'gold' },
  { id: 'xRes', rarity: 'gold' },
  { id: 'xSlvM', rarity: 'gold' },
  { id: 'xSlvS', rarity: 'blue' },
];


export const byId = Object.fromEntries(SUBS.map((s) => [s.id, s]));

export const NAT = [
  ['さみしがり', 'sp', 'en'], ['いじっぱり', 'sp', 'ig'], ['やんちゃ', 'sp', 'sk'], ['ゆうかん', 'sp', 'ex'],
  ['ずぶとい', 'en', 'sp'], ['わんぱく', 'en', 'ig'], ['のうてんき', 'en', 'sk'], ['のんき', 'en', 'ex'],
  ['ひかえめ', 'ig', 'sp'], ['おっとり', 'ig', 'en'], ['うっかりや', 'ig', 'sk'], ['れいせい', 'ig', 'ex'],
  ['おだやか', 'sk', 'sp'], ['おとなしい', 'sk', 'en'], ['しんちょう', 'sk', 'ig'], ['なまいき', 'sk', 'ex'],
  ['おくびょう', 'ex', 'sp'], ['せっかち', 'ex', 'en'], ['ようき', 'ex', 'ig'], ['むじゃき', 'ex', 'sk'],
  ['がんばりや', null, null], ['すなお', null, null], ['てれや', null, null], ['きまぐれ', null, null], ['まじめ', null, null],
];


export function cat(s) {
  if (s === 'sp' || s === 'speed') return 'speed';
  if (s === 'sk' || s === 'skill') return 'skill';
  if (s === 'ig' || s === 'ing') return 'ing';
  return 'other';
}
