// アプリの状態管理と localStorage への永続化。
// 記録と狙い食材は統合前の食材タイプ版（ig 接頭辞）・きのみタイプ版（bf 接頭辞）と同じキーを使い、以前の記録をそのまま読む。
// スキルタイプの記録は sklog に保存する。
// 共通の設定は ck 接頭辞で持ち、まだなければ統合前の設定を引き継ぐ。
import { TYPES, DEFAULT_TYPE, typeOf } from './types.js';
import { natByName } from './picker.js';
import { UNLOCK, LEVEL, LEVELS, SLOTS_AT, ingOpen, byId } from '../../js/constants.js';
import { HEALS, TAPS, HEAL_AMT, HEAL_TIMES, PARAM_LIMITS, FIELD_BONUS } from './berry/constants.js';
import { TAPS as ING_TAPS } from './ingredient/constants.js';

const KEYS = {
  camp: 'ckcamp', g80: 'ckg80', mode: 'ckmode', lv: 'cklv', mon: 'ckmon', mons: 'ckmons', target: 'igtarget',
  heal: 'ckheal', tap: 'cktap', team: 'ckteam', healAmt: 'ckhealamt', healTimes: 'ckhealtimes', ingTap: 'ckingtap',
  fieldBonus: 'ckfieldbonus', fav: 'ckfav',
};
const LOG_KEYS = { ingredient: 'iglog', berry: 'bflog', skill: 'sklog' };
const OLD = {
  camp: ['igcamp', 'bfcamp'], g80: ['igg80', 'bfg80'], mode: ['igmode', 'bfmode'], lv: [], mon: ['igmon', 'bfmon'],
  heal: [], tap: [], team: [], healAmt: [], healTimes: [], ingTap: [], fieldBonus: [], fav: [],
};

const load = (key, def) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : JSON.parse(v);
  } catch {
    return def;
  }
};
const save = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ }
};
const loadSetting = (k, def) => [KEYS[k], ...OLD[k]].reduce((v, key) => (v === undefined ? load(key, undefined) : v), undefined) ?? def;

// arr は食材スロットごとの候補の番号。Lv.1 のスロットは候補が1つなので最初から決まっている。
const emptyArr = (mon) => TYPES.ingredient.MONS[mon].slots.map((opts) => (opts.length === 1 ? 0 : null));

export const state = {
  mon: TYPES[DEFAULT_TYPE].DEFAULT_MON,
  type: DEFAULT_TYPE,
  target: null,
  arr: [],
  subs: UNLOCK.map(() => null),
  // 性格は名前で選び、上昇・下降の補正はそのタイプの分類（natCat）に直して up・down に持つ。
  nat: null,
  up: null,
  down: null,
  // 計算するレベル（50・60・70・80）。サブスキルは常に5枠入力でき、計算にはこのレベルで開いている枠（SLOTS_AT）だけを使う。
  lv: 60,
  camp: true,
  g80: false,
  // ヒーラー・回復量・発動回数・チーム効果は3タイプで共通。受け取りは選択肢が違うので、きのみタイプ（tap）と食材・スキルタイプ（ingTap）で別に持つ。
  heal: 1,
  tap: 'none',
  ingTap: 'always',
  team: true,
  healAmt: HEAL_AMT,
  healTimes: HEAL_TIMES,
  // きのみタイプのエナジーの補正。フィールドボーナス（整数%）と、選んだポケモンのきのみを好きなきのみとして扱うか。
  // 無補正比に影響しないので env には入れない（分布の保存のキーも変わらない）。
  fieldBonus: FIELD_BONUS,
  fav: false,
};

export const monData = () => TYPES[state.type].MONS[state.mon];

// ポケモンを切り替えると食材配列は選び直し、狙い食材はそのポケモンで前回選んだものにする。
// サブスキルと性格は引き継ぐ。
function selectMon(m) {
  state.mon = m;
  state.type = typeOf(m);
  syncNature();
  if (state.type !== 'ingredient') {
    state.arr = [];
    state.target = null;
    return;
  }
  state.arr = emptyArr(m);
  const t = load(KEYS.target, {});
  const ings = TYPES.ingredient.MONS[m].ings;
  state.target = t && typeof t === 'object' && Object.hasOwn(ings, t[m]) ? t[m] : 'A';
}

// 統合前のミュウツー版の記録（m2log）を、スキルタイプのミュウツーの記録として一度だけ引き継ぐ。
// サブスキルの ID と性格の分類（スキル・おてスピ・食材・なし他）はスキルタイプと同じ。元の m2log は残す。
function moveMewtwoLog() {
  if (load('ckm2moved', false) === true) return;
  const old = load('m2log', []);
  if (Array.isArray(old) && old.length) {
    const cur = loadRawLog('skill');
    const seen = new Set(cur.map((x) => String(x && x.t)));
    const moved = old.filter((x) => x && Array.isArray(x.subs) && !seen.has(String(x.t))).map((x) => ({ ...x, mon: 'mewtwo' }));
    save(LOG_KEYS.skill, [...cur, ...moved]);
  }
  save('ckm2moved', true);
}

export function loadSettings() {
  moveMewtwoLog();
  state.camp = loadSetting('camp', true) === true;
  state.g80 = loadSetting('g80', false) === true;
  // ヒーラーの設定がまだなければ、「げんき常時81%以上」がオンだった人は「常に81%以上」から始める。
  const heal = loadSetting('heal', state.g80 ? 'g80' : 1);
  state.heal = HEALS.includes(heal) ? heal : 1;
  const tap = loadSetting('tap', 'none');
  state.tap = TAPS.includes(tap) ? tap : 'none';
  const ingTap = loadSetting('ingTap', 'always');
  state.ingTap = ING_TAPS.includes(ingTap) ? ingTap : 'always';
  state.team = loadSetting('team', true) !== false;
  state.healAmt = paramOr('healAmt', loadSetting('healAmt', HEAL_AMT), HEAL_AMT);
  state.healTimes = paramOr('healTimes', loadSetting('healTimes', HEAL_TIMES), HEAL_TIMES);
  state.fieldBonus = paramOr('fieldBonus', loadSetting('fieldBonus', FIELD_BONUS), FIELD_BONUS);
  state.fav = loadSetting('fav', false) === true;
  // レベルの設定がまだなければ、以前の対象レベルの切り替え（枠の数）から引き継ぐ（Lv.50まで→60・Lv.70まで→70・Lv.80まで→80）。
  const n = loadSetting('mode', 3);
  const lv = loadSetting('lv', LEVEL[n] ?? 60);
  state.lv = LEVELS.includes(lv) ? lv : 60;
  // URL の ?mon= を優先し、なければ前回選んだポケモンにする。
  let q = null;
  try { q = new URLSearchParams(location.search).get('mon'); } catch { /* no location */ }
  const m = typeOf(q) ? q : loadSetting('mon', TYPES[DEFAULT_TYPE].DEFAULT_MON);
  selectMon(typeOf(m) ? m : TYPES[DEFAULT_TYPE].DEFAULT_MON);
  rememberMon();
}

function rememberMon() {
  const saved = load(KEYS.mons, {});
  save(KEYS.mons, { ...(saved && typeof saved === 'object' ? saved : {}), [state.type]: state.mon });
}

// タイプごとに最後に選んだポケモン。統合前の版で選んでいたポケモンも引き継ぐ。
function lastMonOf(type) {
  const saved = load(KEYS.mons, {});
  const old = { ingredient: 'igmon', berry: 'bfmon' }[type];
  const m = (saved && typeof saved === 'object' && saved[type]) || (old ? load(old, null) : null);
  return typeOf(m) === type ? m : TYPES[type].DEFAULT_MON;
}

export function setCamp(v) { state.camp = v; save(KEYS.camp, v); }
export function setLevel(lv) { if (LEVELS.includes(lv)) { state.lv = lv; save(KEYS.lv, lv); } }
export function setHeal(v) { if (HEALS.includes(v)) { state.heal = v; save(KEYS.heal, v); } }
export function setTap(v) { if (TAPS.includes(v)) { state.tap = v; save(KEYS.tap, v); } }
export function setIngTap(v) { if (ING_TAPS.includes(v)) { state.ingTap = v; save(KEYS.ingTap, v); } }
export function setTeam(v) { state.team = v; save(KEYS.team, v); }
export function setFav(v) { state.fav = v; save(KEYS.fav, v); }

// 詳細画面の数値。回復量とフィールドボーナスは整数、発動回数は小数第2位まで。範囲外や桁の多い値は受け付けない（false を返す）。
const PARAM_DIGITS = { healAmt: 0, healTimes: 2, fieldBonus: 0 };
const paramOk = (k, v) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < PARAM_LIMITS[k][0] || v > PARAM_LIMITS[k][1]) return false;
  const s = 10 ** PARAM_DIGITS[k];
  return Math.abs(Math.round(v * s) - v * s) < 1e-6;
};
// 2.55 のような値を浮動小数点の誤差なしに持つ。
const tidy = (k, v) => Math.round(v * 10 ** PARAM_DIGITS[k]) / 10 ** PARAM_DIGITS[k];
const paramOr = (k, v, def) => (paramOk(k, v) ? tidy(k, v) : def);
export function setParam(k, v) {
  if (!paramOk(k, v)) return false;
  state[k] = tidy(k, v);
  save(KEYS[k], state[k]);
  return true;
}

export function setMon(m) {
  selectMon(m);
  save(KEYS.mon, m);
  rememberMon();
}
export function setType(type) { if (type !== state.type) setMon(lastMonOf(type)); }
export function setTarget(ing) {
  state.target = ing;
  const t = load(KEYS.target, {});
  save(KEYS.target, { ...(t && typeof t === 'object' ? t : {}), [state.mon]: ing });
}

// タイプによって効く補正が違う（スキル補正は、きのみ・食材タイプでは「なし他」）ので、タイプが変わるたびに分類し直す。
function syncNature() {
  const n = natByName(state.nat);
  const c = TYPES[state.type].natCat;
  state.up = n ? c(n[1]) : null;
  state.down = n ? c(n[2]) : null;
}
export function setNature(name) {
  state.nat = natByName(name) ? name : null;
  syncNature();
}

export function resetSelection() {
  if (state.type === 'ingredient') state.arr = emptyArr(state.mon);
  state.subs = UNLOCK.map(() => null);
  setNature(null);
}

// 今のレベルで開いているサブスキルの枠の数と、そのサブスキル（未入力は null）。期待値はこの枠で計算する。
export const slotCount = () => SLOTS_AT[state.lv];
export const currentSubs = () => state.subs.slice(0, slotCount());
// 今のレベルで開いている食材の枠（Lv.50 は2枠）。
export const currentArr = () => state.arr.slice(0, ingOpen(state.lv));
// 確率を出せるか。今のレベルで開いているサブスキルの枠・性格・食材の枠がすべて入っていること。
export const isComplete = () => currentSubs().every(Boolean) && state.up && state.down && !currentArr().includes(null);
// 入力してあるサブスキル（低いレベルから続けて入っている分）。記録にはこれを保存する。
export const filledSubs = () => {
  const i = state.subs.findIndex((v) => !v);
  return state.subs.slice(0, i < 0 ? state.subs.length : i);
};
export const env = () => {
  const { lv, camp, mon, heal, tap, ingTap, team, healAmt, healTimes } = state;
  const N = slotCount();
  if (state.type === 'berry') return { lv, N, camp, mon, heal, tap, team, healAmt, healTimes };
  if (state.type === 'ingredient') return { lv, N, camp, mon, target: state.target, heal, tap: ingTap, team, healAmt, healTimes };
  return { lv, N, camp, mon, heal, tap: ingTap, team, healAmt, healTimes };
};

// 記録はタイプごとのキーに保存する（食材・きのみは統合前と同じキー）。食材タイプの記録は食材配列のあるものだけ使う。
const loadRawLog = (type) => {
  const v = load(LOG_KEYS[type], []);
  return Array.isArray(v) ? v : [];
};
// 性格の名前がある記録は、上昇・下降の補正を今のタイプの分類で決め直す（分類が増えたときも古い記録を正しく計算するため）。
export const loadLog = () => loadRawLog(state.type).filter((x) => x && x.mon === state.mon && Array.isArray(x.subs)
  && (state.type !== 'ingredient' || Array.isArray(x.arr)))
  .map((x) => {
    const n = natByName(x.nat);
    if (!n) return x;
    const c = TYPES[state.type].natCat;
    return { ...x, up: c(n[1]), down: c(n[2]) };
  });
export function appendLog(entry) { save(LOG_KEYS[state.type], [...loadRawLog(state.type), entry]); }
export function removeLogEntry(t) {
  save(LOG_KEYS[state.type], loadRawLog(state.type).filter((x) => String(x && x.t) !== String(t)));
}

// 記録の個体を入力欄に戻す。サブスキルは記録の枠の数だけ入れ、後ろの枠は空にする。
// 性格の名前がない古い記録は、上昇・下降の補正（分類）だけを戻す。
export function restoreEntry(x) {
  state.subs = UNLOCK.map((_, i) => (byId[x.subs[i]] ? x.subs[i] : null));
  if (natByName(x.nat)) {
    setNature(x.nat);
  } else {
    state.nat = null;
    state.up = x.up;
    state.down = x.down;
  }
  if (state.type === 'ingredient') {
    const slots = TYPES.ingredient.MONS[state.mon].slots;
    state.arr = slots.map((opts, i) => (Number.isInteger(x.arr[i]) && x.arr[i] >= 0 && x.arr[i] < opts.length ? x.arr[i] : emptyArr(state.mon)[i]));
  }
}

// 今の入力が記録の個体と、今のレベルで開いている枠について同じか。
export const isCurrent = (x) => currentSubs().join() === x.subs.slice(0, slotCount()).join()
  && (natByName(x.nat) ? x.nat === state.nat : !state.nat && state.up === x.up && state.down === x.down)
  && (state.type !== 'ingredient' || currentArr().join() === x.arr.slice(0, ingOpen(state.lv)).join());
