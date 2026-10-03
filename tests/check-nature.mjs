// ストリンダーの姿ごとに付く性格を確かめる。リポジトリ直下で `node tests/check-nature.mjs` を実行する。
// - ハイなすがた13種・ローなすがた12種が、英語名の表（本家のゲームの性格と同じ。にとよんツールの AMPED と同じ並び）と一致し、合わせて25種になる。
// - 上位%の分布が、姿に付く性格だけを等確率で数える（補正の組ごとの確率を、性格の分類だけを返す ratios で取り出して比べる）。
// - スキルタイプの分布で、姿に付かない性格の補正（ローなすがたのスキル確率▼）の個体は出ない。
import assert from 'node:assert/strict';
import { NAT, NAT_AMPED, NAT_LOW_KEY, natsOf } from '../js/constants.js';
import { buildDist } from '../checker/js/engine.js';
import { MONS } from '../checker/js/skill/mons.js';
import { natCat } from '../checker/js/skill/constants.js';
import { createEngine } from '../checker/js/skill/calc.js';

// 英語名と、ポケモンスリープでの補正（sp おてスピ・en げんき回復・ig 食材確率・sk スキル確率・ex EXP）。
const EN = {
  Lonely: ['さみしがり', 'sp', 'en'], Adamant: ['いじっぱり', 'sp', 'ig'], Naughty: ['やんちゃ', 'sp', 'sk'], Brave: ['ゆうかん', 'sp', 'ex'],
  Bold: ['ずぶとい', 'en', 'sp'], Impish: ['わんぱく', 'en', 'ig'], Lax: ['のうてんき', 'en', 'sk'], Relaxed: ['のんき', 'en', 'ex'],
  Modest: ['ひかえめ', 'ig', 'sp'], Mild: ['おっとり', 'ig', 'en'], Rash: ['うっかりや', 'ig', 'sk'], Quiet: ['れいせい', 'ig', 'ex'],
  Calm: ['おだやか', 'sk', 'sp'], Gentle: ['おとなしい', 'sk', 'en'], Careful: ['しんちょう', 'sk', 'ig'], Sassy: ['なまいき', 'sk', 'ex'],
  Timid: ['おくびょう', 'ex', 'sp'], Hasty: ['せっかち', 'ex', 'en'], Jolly: ['ようき', 'ex', 'ig'], Naive: ['むじゃき', 'ex', 'sk'],
  Hardy: ['がんばりや', null, null], Docile: ['すなお', null, null], Bashful: ['てれや', null, null], Quirky: ['きまぐれ', null, null], Serious: ['まじめ', null, null],
};
const AMPED = ['Hardy', 'Docile', 'Quirky', 'Lax', 'Impish', 'Hasty', 'Naive', 'Jolly', 'Brave', 'Naughty', 'Adamant', 'Sassy', 'Rash'];

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };
const sorted = (a) => [...a].sort();

test('姿ごとの性格の表', () => {
  assert.deepEqual(NAT.map(([name, u, d]) => [name, u, d]).sort(), Object.values(EN).sort(), 'NAT が英語名の表と同じ');
  assert.deepEqual(sorted(NAT_AMPED), sorted(AMPED.map((k) => EN[k][0])));
  assert.deepEqual(sorted(NAT_LOW_KEY), sorted(Object.keys(EN).filter((k) => !AMPED.includes(k)).map((k) => EN[k][0])));
  assert.equal(NAT_AMPED.length, 13);
  assert.equal(NAT_LOW_KEY.length, 12);
  assert.equal(natsOf(MONS['toxtricity-amped']).length, 13);
  assert.equal(natsOf(MONS['toxtricity-low-key']).length, 12);
  assert.equal(natsOf(MONS.mewtwo).length, 25);
});

// 補正の組（スキルタイプの分類）ごとの確率を、分布から取り出す。サブスキルの組は合計1なので、組の確率がそのまま残る。
const PAIRS = ['skill', 'speed', 'ing', 'energy', 'other'].flatMap((u) => ['skill', 'speed', 'ing', 'energy', 'other'].map((d) => `${u}|${d}`));
const pairProbs = (mon) => {
  const dist = buildDist(3, natCat, false, (e, u, d) => [[PAIRS.indexOf(`${u}|${d}`) + 1, 1]], mon);
  return Object.fromEntries(dist.map(({ r, p }) => [PAIRS[r - 1], p]));
};
const expected = (keys) => {
  const out = {};
  keys.forEach((k) => { const [, u, d] = EN[k]; const pk = `${natCat(u)}|${natCat(d)}`; out[pk] = (out[pk] || 0) + 1 / keys.length; });
  return out;
};
const close = (a, b, msg) => {
  assert.deepEqual(sorted(Object.keys(a)), sorted(Object.keys(b)), msg);
  Object.keys(b).forEach((k) => assert.ok(Math.abs(a[k] - b[k]) < 1e-12, `${msg} ${k}: ${a[k]} != ${b[k]}`));
};

test('分布は姿に付く性格だけを等確率で数える', () => {
  close(pairProbs(MONS['toxtricity-amped']), expected(AMPED), 'ハイなすがた');
  close(pairProbs(MONS['toxtricity-low-key']), expected(Object.keys(EN).filter((k) => !AMPED.includes(k))), 'ローなすがた');
  close(pairProbs(MONS.mewtwo), expected(Object.keys(EN)), 'ミュウツー');
});

test('ローなすがたの分布に、スキル確率▼の個体は出ない', () => {
  const en = createEngine();
  const env = { lv: 60, N: 3, camp: true, mon: 'toxtricity-low-key', heal: 1, tap: '3h', team: true, healAmt: 18, healTimes: 3 };
  const dist = en.dist(env);
  assert.ok(Math.abs(dist.reduce((a, x) => a + x.p, 0) - 1) < 1e-9);
  // サブスキル3枠すべてが効かない組（なし他）で、スキル確率▼の性格の無補正比は、▼のない性格の値（1・おてスピ・げんき回復の補正）のどれとも違う。
  const low = en.score(['xExp', 'xRes', 'xShard'], 'other', 'skill', env);
  assert.ok(!dist.some((x) => Math.abs(x.r - low) <= low * 1e-9), `スキル確率▼の値 ${low} が分布にある`);
  const calm = en.score(['xExp', 'xRes', 'xShard'], 'skill', 'speed', env);
  assert.ok(dist.some((x) => Math.abs(x.r - calm) <= calm * 1e-7), 'おだやかの値が分布にない');
  // ハイなすがたにはスキル確率▼の性格（やんちゃなど）があるので出る。
  const amped = { ...env, mon: 'toxtricity-amped' };
  const lowA = en.score(['xExp', 'xRes', 'xShard'], 'other', 'skill', amped);
  assert.ok(en.dist(amped).some((x) => Math.abs(x.r - lowA) <= lowA * 1e-7));
});

console.log(`OK ${n}件`);
