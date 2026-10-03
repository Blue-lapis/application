// node tests/check-draft.mjs
// 厳選チェッカーの入力の保存（ckdraft、ver1.10）と初期値（ポケモン未選択・受け取り3時間ごと）を確かめる。
// localStorage と location は簡単な代用品を置く。
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
let search = '';
globalThis.location = { get search() { return search; } };

const {
  state, loadSettings, setMon, setType, setNature, saveDraft, resetSelection, snapshotSelection, restoreSelection, restoreEntry, hasMon,
} = await import('../checker/js/state.js');

const draft = () => JSON.parse(store.get('ckdraft') ?? '{}');
const reset = (data = {}) => {
  store.clear();
  Object.entries(data).forEach(([k, v]) => store.set(k, JSON.stringify(v)));
  search = '';
};
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };

test('空の端末: 未選択・受け取りは3時間ごと', () => {
  reset();
  loadSettings();
  assert.equal(state.mon, null);
  assert.equal(hasMon(), false);
  assert.equal(state.type, 'berry');
  assert.equal(state.tap, '3h');
  assert.equal(state.ingTap, '3h');
  saveDraft();
  assert.equal(store.has('ckdraft'), false);
  assert.equal(store.has('ckmon'), false);
  assert.equal(store.has('ckmons'), false);
});

test('前の版の保存データはそのまま使う', () => {
  reset({ ckmon: 'flygon', ckmons: { ingredient: 'flygon', berry: 'raichu' }, cktap: 'none', ckingtap: 'always', cklv: 70 });
  loadSettings();
  assert.equal(state.mon, 'flygon');
  assert.equal(state.tap, 'none');
  assert.equal(state.ingTap, 'always');
  assert.equal(state.lv, 70);
  setType('berry');
  assert.equal(state.mon, 'raichu');
});

test('統合前の igmon も使う', () => {
  reset({ igmon: 'flygon' });
  loadSettings();
  assert.equal(state.mon, 'flygon');
});

test('?mon= を優先する', () => {
  reset({ ckmon: 'flygon' });
  search = '?mon=mewtwo';
  loadSettings();
  assert.equal(state.mon, 'mewtwo');
});

test('タブ切り替え: そのタイプで選んだことがなければ未選択', () => {
  reset();
  loadSettings();
  setType('skill');
  assert.equal(state.type, 'skill');
  assert.equal(state.mon, null);
  setMon('mewtwo');
  setType('ingredient');
  assert.equal(state.mon, null);
  setType('skill');
  assert.equal(state.mon, 'mewtwo');
});

test('ポケモンごとに保存して戻す（食材配列も）', () => {
  reset();
  loadSettings();
  setMon('flygon');
  state.subs = ['hb', 'spS', null, null, null];
  setNature('さみしがり');
  state.arr = [0, 1, 2];
  saveDraft();
  assert.deepEqual(draft().flygon, { subs: ['hb', 'spS', null, null, null], nat: 'さみしがり', up: state.up, down: state.down, arr: [0, 1, 2] });
  setMon('mewtwo');
  assert.deepEqual(state.subs, [null, null, null, null, null], '保存のないポケモンは空');
  assert.equal(state.nat, null);
  state.subs[0] = 'skM';
  saveDraft();
  assert.equal(Object.hasOwn(draft().mewtwo, 'arr'), false);
  setMon('flygon');
  assert.deepEqual(state.subs, ['hb', 'spS', null, null, null]);
  assert.equal(state.nat, 'さみしがり');
  assert.deepEqual(state.arr, [0, 1, 2]);
  setMon('mewtwo');
  assert.equal(state.subs[0], 'skM');
  // 読み直し（loadSettings）でも戻る。
  loadSettings();
  assert.equal(state.mon, 'mewtwo');
  assert.equal(state.subs[0], 'skM');
});

test('消すと保存も空、元に戻すと戻した内容を保存', () => {
  reset();
  loadSettings();
  setMon('flygon');
  state.subs[0] = 'hb';
  saveDraft();
  const snap = snapshotSelection();
  resetSelection();
  saveDraft();
  assert.equal(Object.hasOwn(draft(), 'flygon'), false);
  restoreSelection(snap);
  saveDraft();
  assert.equal(draft().flygon.subs[0], 'hb');
  // ほかのポケモンに移ったあとの「元に戻す」は何もしない。
  resetSelection();
  saveDraft();
  setMon('mewtwo');
  restoreSelection(snap);
  saveDraft();
  assert.equal(Object.hasOwn(draft(), 'mewtwo'), false);
});

test('記録を選ぶと置き換えて保存', () => {
  reset();
  loadSettings();
  setMon('mewtwo');
  state.subs[0] = 'hb';
  saveDraft();
  restoreEntry({ subs: ['skM', 'skS'], nat: 'やんちゃ' });
  saveDraft();
  assert.deepEqual(draft().mewtwo.subs, ['skM', 'skS', null, null, null]);
  assert.equal(draft().mewtwo.nat, 'やんちゃ');
});

test('壊れたデータはその部分だけ空', () => {
  for (const bad of ['abc', [], null, 1]) {
    reset({ ckmon: 'flygon', ckdraft: bad });
    loadSettings();
    assert.equal(state.mon, 'flygon');
    assert.deepEqual(state.subs, [null, null, null, null, null]);
  }
  store.set('ckdraft', '{not json');
  loadSettings();
  assert.deepEqual(state.subs, [null, null, null, null, null]);

  reset({ ckmon: 'flygon', ckdraft: { flygon: 'x' } });
  loadSettings();
  assert.deepEqual(state.arr, [0, null, null]);

  reset({ ckmon: 'flygon', ckdraft: { flygon: { subs: ['hb', 'nothing', 3, 'spS'], nat: 'ないせいかく', up: 'zzz', down: 'speed', arr: [0, 5, 1.5] } } });
  loadSettings();
  assert.deepEqual(state.subs, ['hb', null, null, 'spS', null]);
  assert.equal(state.nat, null);
  assert.equal(state.up, null);
  assert.equal(state.down, 'speed');
  assert.deepEqual(state.arr, [0, null, null]);

  reset({ ckmon: 'flygon', ckdraft: { flygon: { subs: 'hb', arr: [0, 1] } } });
  loadSettings();
  assert.deepEqual(state.subs, [null, null, null, null, null]);
  assert.deepEqual(state.arr, [0, null, null], '候補の数が合わない食材配列は空');
});

test('ストリンダーは姿に付かない性格を選べない', () => {
  reset();
  loadSettings();
  setMon('toxtricity-amped');
  setNature('おだやか');
  assert.equal(state.nat, null, 'ローなすがたの性格はハイなすがたに付かない');
  assert.equal(state.up, null);
  setNature('なまいき');
  assert.equal(state.nat, 'なまいき');
  setMon('toxtricity-low-key');
  setNature('なまいき');
  assert.equal(state.nat, null);
  setNature('おだやか');
  assert.equal(state.nat, 'おだやか');
  // 記録・保存した入力の、姿に付かない性格は空にする（ほかの入力は戻す）。
  restoreEntry({ subs: ['skM'], nat: 'ようき' });
  assert.equal(state.subs[0], 'skM');
  assert.equal(state.nat, null);
  assert.equal(state.down, null);
  reset({ ckmon: 'toxtricity-amped', ckdraft: { 'toxtricity-amped': { subs: ['hb'], nat: 'しんちょう', up: 'skill', down: 'ing' } } });
  loadSettings();
  assert.equal(state.subs[0], 'hb');
  assert.equal(state.nat, null);
  assert.equal(state.up, null);
  // ほかのポケモンは25種すべて選べる。
  setMon('mewtwo');
  setNature('おだやか');
  assert.equal(state.nat, 'おだやか');
});

console.log(`OK ${n}件`);
