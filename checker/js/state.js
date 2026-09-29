// アプリの状態管理と localStorage への永続化。
// 記録と狙い食材は統合前の食材タイプ版（ig 接頭辞）・きのみタイプ版（bf 接頭辞）と同じキーを使い、以前の記録をそのまま読む。
// スキルタイプの記録は sklog に保存する。
// 共通の設定は ck 接頭辞で持ち、まだなければ統合前の設定を引き継ぐ。
import { TYPES, DEFAULT_TYPE, typeOf } from './types.js';
import { natByName } from './picker.js';
import { UNLOCK, LEVEL, byId } from '../../js/constants.js';
import { HEALS, TAPS, HEAL_AMT, HEAL_TIMES, PARAM_LIMITS } from './berry/constants.js';
import { TAPS as ING_TAPS } from './ingredient/constants.js';

const KEYS = {
  camp: 'ckcamp', g80: 'ckg80', mode: 'ckmode', mon: 'ckmon', mons: 'ckmons', target: 'igtarget',
  heal: 'ckheal', tap: 'cktap', team: 'ckteam', healAmt: 'ckhealamt', healTimes: 'ckhealtimes', ingTap: 'ckingtap',
};
const LOG_KEYS = { ingredient: 'iglog', berry: 'bflog', skill: 'sklog' };
const OLD = {
  camp: ['igcamp', 'bfcamp'], g80: ['igg80', 'bfg80'], mode: ['igmode', 'bfmode'], mon: ['igmon', 'bfmon'],
  heal: [], tap: [], team: [], healAmt: [], healTimes: [], ingTap: [],
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
  N: 3,
  camp: true,
  g80: false,
  // ヒーラー・回復量・発動回数・チーム効果はきのみタイプと食材タイプで共通。受け取りはタイプごとに選択肢が違うので別に持つ。
  heal: 1,
  tap: 'none',
  ingTap: 'always',
  team: true,
  healAmt: HEAL_AMT,
  healTimes: HEAL_TIMES,
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
  const n = loadSetting('mode', 3);
  state.N = Object.hasOwn(LEVEL, n) ? n : 3;
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
export function setG80(v) { state.g80 = v; save(KEYS.g80, v); }
export function setMode(n) { state.N = n; save(KEYS.mode, n); }
export function setHeal(v) { if (HEALS.includes(v)) { state.heal = v; save(KEYS.heal, v); } }
export function setTap(v) { if (TAPS.includes(v)) { state.tap = v; save(KEYS.tap, v); } }
export function setIngTap(v) { if (ING_TAPS.includes(v)) { state.ingTap = v; save(KEYS.ingTap, v); } }
export function setTeam(v) { state.team = v; save(KEYS.team, v); }

// 詳細画面の数値。回復量は整数、発動回数は小数第2位まで。範囲外や桁の多い値は受け付けない（false を返す）。
const PARAM_DIGITS = { healAmt: 0, healTimes: 2 };
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

export const currentSubs = () => state.subs.slice(0, state.N);
export const isComplete = () => currentSubs().every(Boolean) && state.up && state.down && !state.arr.includes(null);
export const env = () => {
  const { N, camp, mon, heal, tap, ingTap, team, healAmt, healTimes } = state;
  if (state.type === 'berry') return { N, camp, mon, heal, tap, team, healAmt, healTimes };
  if (state.type === 'ingredient') return { N, camp, mon, target: state.target, heal, tap: ingTap, team, healAmt, healTimes };
  return { N, camp, g80: state.g80, mon };
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

// 今の入力が記録の個体と同じか。
export const isCurrent = (x) => currentSubs().join() === x.subs.join()
  && (natByName(x.nat) ? x.nat === state.nat : !state.nat && state.up === x.up && state.down === x.down)
  && (state.type !== 'ingredient' || state.arr.join() === x.arr.join());
