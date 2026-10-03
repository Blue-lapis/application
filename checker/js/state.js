// アプリの状態管理と localStorage への永続化。
// 記録と狙い食材は統合前の食材タイプ版（ig 接頭辞）・きのみタイプ版（bf 接頭辞）と同じキーを使い、以前の記録をそのまま読む。
// スキルタイプの記録は sklog に保存する。
// 共通の設定は ck 接頭辞で持ち、まだなければ統合前の設定を引き継ぐ。
import { TYPES, DEFAULT_TYPE, DEFAULT_TAP, typeOf } from './types.js';
import { natByName } from './picker.js';
import { UNLOCK, LEVEL, LEVELS, SLOTS_AT, ingOpen, byId, natsOf } from '../../js/constants.js';
import { HEALS, TAPS, HEAL_AMT, HEAL_TIMES, PARAM_LIMITS as BERRY_LIMITS, FIELD_BONUS } from './berry/constants.js';
import { TAPS as ING_TAPS, targetOpen } from './ingredient/constants.js';
import { RECIPE_BONUSES, RECIPE_BONUS, RECIPE_LEVEL, RECIPE_LEVEL_LIMITS, BYS as ING_BYS } from './ingredient/energy.js';

// 詳細画面の数値の範囲。平均レシピレベルは食材タイプをエナジーで評価するときだけ使う。
export const PARAM_LIMITS = { ...BERRY_LIMITS, recipeLevel: RECIPE_LEVEL_LIMITS };

const KEYS = {
  camp: 'ckcamp', g80: 'ckg80', mode: 'ckmode', lv: 'cklv', mon: 'ckmon', mons: 'ckmons', target: 'igtarget',
  heal: 'ckheal', tap: 'cktap', team: 'ckteam', healAmt: 'ckhealamt', healTimes: 'ckhealtimes', ingTap: 'ckingtap',
  fieldBonus: 'ckfieldbonus', fav: 'ckfav', lvOpen: 'cklvopen', ingBy: 'ckingby', recipeBonus: 'ckrecipebonus', recipeLevel: 'ckrecipelv',
};
// 入力中のサブスキル・性格・食材配列（ポケモンごと）。{ ポケモン: { subs, nat, up, down, arr? } }
const DRAFT_KEY = 'ckdraft';
const LOG_KEYS = { ingredient: 'iglog', berry: 'bflog', skill: 'sklog' };
const OLD = {
  camp: ['igcamp', 'bfcamp'], g80: ['igg80', 'bfg80'], mode: ['igmode', 'bfmode'], lv: [], mon: ['igmon', 'bfmon'],
  heal: [], tap: [], team: [], healAmt: [], healTimes: [], ingTap: [], fieldBonus: [], fav: [], lvOpen: [], ingBy: [], recipeBonus: [], recipeLevel: [],
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

// mon が null のときはポケモン未選択（初めて開いたときや、選んだことのないタイプのタブ）。
export const state = {
  mon: null,
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
  tap: DEFAULT_TAP,
  ingTap: DEFAULT_TAP,
  team: true,
  healAmt: HEAL_AMT,
  healTimes: HEAL_TIMES,
  // きのみタイプのエナジーの補正。フィールドボーナス（整数%）と、選んだポケモンのきのみを好きなきのみとして扱うか。
  // 無補正比に影響しないので env には入れない（分布の保存のキーも変わらない）。
  fieldBonus: FIELD_BONUS,
  fav: false,
  // レベル別の一覧（性能の欄）を開いているか。
  lvOpen: false,
  // 食材タイプの評価のしかた。'count' は狙い食材の個数、'energy' はすべての食材ときのみのエナジー（ver1.12）。
  ingBy: 'count',
  // エナジーで評価するときの料理の倍率。レシピボーナス（%）と平均レシピレベル。
  recipeBonus: RECIPE_BONUS,
  recipeLevel: RECIPE_LEVEL,
};

export const hasMon = () => state.mon !== null;
export const monData = () => TYPES[state.type].MONS[state.mon];

const loadDrafts = () => {
  const d = load(DRAFT_KEY, {});
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
};

// ポケモンを切り替えると、そのポケモンで前回入力していたサブスキル・性格・食材配列（ckdraft）を戻す。なければ空にする。
// 狙い食材はそのポケモンで前回選んだものにする。
function selectMon(m) {
  state.mon = m;
  state.type = typeOf(m);
  state.target = state.type === 'ingredient' ? targetOf(m) : null;
  const d = loadDrafts()[m];
  applyInput(d && typeof d === 'object' && !Array.isArray(d) ? d : {});
  lastDraft = draftText();
}

// 未選択にする（そのタイプで選んだことのないタブ）。入力も空にする。
function clearMon(type) {
  state.mon = null;
  state.type = type;
  state.arr = [];
  state.target = null;
  state.subs = UNLOCK.map(() => null);
  setNature(null);
}

// 保存してある入力の文字列（前回書いたもの）。同じなら書かない。
let lastDraft = null;
const isEmptyInput = () => !state.subs.some(Boolean) && !state.nat && !state.up && !state.down
  && (state.type !== 'ingredient' || state.arr.join() === emptyArr(state.mon).join());
const draftText = () => (isEmptyInput() ? '' : JSON.stringify({
  subs: state.subs, nat: state.nat, up: state.up, down: state.down, ...(state.type === 'ingredient' ? { arr: state.arr } : {}),
}));
// 今の入力を、今のポケモンの分として保存する。描き直し（ui.js の refresh）のたびに呼ぶ。空の入力は項目を消す。
export function saveDraft() {
  if (!hasMon()) return;
  const text = draftText();
  if (text === lastDraft) return;
  const all = loadDrafts();
  if (text) all[state.mon] = JSON.parse(text);
  else delete all[state.mon];
  save(DRAFT_KEY, all);
  lastDraft = text;
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
  const tap = loadSetting('tap', DEFAULT_TAP);
  state.tap = TAPS.includes(tap) ? tap : DEFAULT_TAP;
  const ingTap = loadSetting('ingTap', DEFAULT_TAP);
  state.ingTap = ING_TAPS.includes(ingTap) ? ingTap : DEFAULT_TAP;
  state.team = loadSetting('team', true) !== false;
  state.healAmt = paramOr('healAmt', loadSetting('healAmt', HEAL_AMT), HEAL_AMT);
  state.healTimes = paramOr('healTimes', loadSetting('healTimes', HEAL_TIMES), HEAL_TIMES);
  state.fieldBonus = paramOr('fieldBonus', loadSetting('fieldBonus', FIELD_BONUS), FIELD_BONUS);
  state.fav = loadSetting('fav', false) === true;
  state.lvOpen = loadSetting('lvOpen', false) === true;
  const ingBy = loadSetting('ingBy', 'count');
  state.ingBy = ING_BYS.includes(ingBy) ? ingBy : 'count';
  const rb = loadSetting('recipeBonus', RECIPE_BONUS);
  state.recipeBonus = RECIPE_BONUSES.some(([v]) => v === rb) ? rb : RECIPE_BONUS;
  state.recipeLevel = paramOr('recipeLevel', loadSetting('recipeLevel', RECIPE_LEVEL), RECIPE_LEVEL);
  // レベルの設定がまだなければ、以前の対象レベルの切り替え（枠の数）から引き継ぐ（Lv.50まで→60・Lv.70まで→70・Lv.80まで→80）。
  const n = loadSetting('mode', 3);
  const lv = loadSetting('lv', LEVEL[n] ?? 60);
  state.lv = LEVELS.includes(lv) ? lv : 60;
  // URL の ?mon= を優先し、なければ前回選んだポケモンにする。どちらもなければ未選択。
  let q = null;
  try { q = new URLSearchParams(location.search).get('mon'); } catch { /* no location */ }
  const m = typeOf(q) ? q : loadSetting('mon', null);
  if (!typeOf(m)) {
    clearMon(DEFAULT_TYPE);
    return;
  }
  selectMon(m);
  rememberMon();
}

function rememberMon() {
  if (!hasMon()) return;
  const saved = load(KEYS.mons, {});
  save(KEYS.mons, { ...(saved && typeof saved === 'object' ? saved : {}), [state.type]: state.mon });
}

// タイプごとに最後に選んだポケモン。統合前の版で選んでいたポケモンも引き継ぐ。
function lastMonOf(type) {
  const saved = load(KEYS.mons, {});
  const old = { ingredient: 'igmon', berry: 'bfmon' }[type];
  const m = (saved && typeof saved === 'object' && saved[type]) || (old ? load(old, null) : null);
  return typeOf(m) === type ? m : null;
}

export function setCamp(v) { state.camp = v; save(KEYS.camp, v); }
// レベル別の一覧を開いているか。
export function setLvOpen(on) { state.lvOpen = on; save(KEYS.lvOpen, on); }
export function setLevel(lv) { if (LEVELS.includes(lv)) { state.lv = lv; save(KEYS.lv, lv); } }
export function setHeal(v) { if (HEALS.includes(v)) { state.heal = v; save(KEYS.heal, v); } }
export function setTap(v) { if (TAPS.includes(v)) { state.tap = v; save(KEYS.tap, v); } }
export function setIngTap(v) { if (ING_TAPS.includes(v)) { state.ingTap = v; save(KEYS.ingTap, v); } }
export function setTeam(v) { state.team = v; save(KEYS.team, v); }
export function setFav(v) { state.fav = v; save(KEYS.fav, v); }
export function setRecipeBonus(v) { if (RECIPE_BONUSES.some(([b]) => b === v)) { state.recipeBonus = v; save(KEYS.recipeBonus, v); } }
export function setIngBy(v) { if (ING_BYS.includes(v)) { state.ingBy = v; save(KEYS.ingBy, v); } }
// 食材タイプをエナジーで評価しているか。
export const ingByEnergy = () => state.type === 'ingredient' && state.ingBy === 'energy';

// 詳細画面の数値。回復量とフィールドボーナスは整数、発動回数は小数第2位まで。範囲外や桁の多い値は受け付けない（false を返す）。
const PARAM_DIGITS = { healAmt: 0, healTimes: 2, fieldBonus: 0, recipeLevel: 0 };
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
// そのタイプで前に選んだポケモンがなければ未選択にする。
export function setType(type) {
  if (type === state.type) return;
  const m = lastMonOf(type);
  if (m) setMon(m);
  else clearMon(type);
}
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
// 今のポケモンに付く性格か（ストリンダーは姿ごとに付く性格が決まっている）。ポケモン未選択なら25種すべて。
export const natAllowed = (name) => !!natByName(name) && (!hasMon() || natsOf(monData()).some(([n]) => n === name));
// 付かない性格（保存した入力・記録を、ほかの姿のものとして戻したときなど）は未選択にする。
export function setNature(name) {
  state.nat = natAllowed(name) ? name : null;
  syncNature();
}

// 「消す」の前の入力。「元に戻す」で restoreSelection に渡す。同じポケモンのときだけ戻す。
export const snapshotSelection = () => ({ mon: state.mon, subs: [...state.subs], nat: state.nat, up: state.up, down: state.down, arr: [...state.arr] });
// ほかのポケモンに切り替えたあとは戻さない（そのポケモンの保存した入力を上書きしないため）。
export function restoreSelection(x) {
  if (x.mon !== state.mon) return;
  state.subs = [...x.subs];
  if (natByName(x.nat)) {
    setNature(x.nat);
  } else {
    state.nat = null;
    state.up = x.up;
    state.down = x.down;
  }
  if (state.type === 'ingredient') state.arr = [...x.arr];
}

export function resetSelection() {
  if (state.type === 'ingredient') state.arr = emptyArr(state.mon);
  state.subs = UNLOCK.map(() => null);
  setNature(null);
}

// レベル lv（省略時は今のレベル）で開いているサブスキルの枠の数と、そのサブスキル（未入力は null）。期待値はこの枠で計算する。
export const slotCount = (lv = state.lv) => SLOTS_AT[lv];
export const currentSubs = (lv = state.lv) => state.subs.slice(0, slotCount(lv));
// レベル lv で開いている食材の枠（Lv.50 は2枠）。
export const currentArr = (lv = state.lv) => state.arr.slice(0, ingOpen(lv));
// 確率を出せるか。レベル lv で開いているサブスキルの枠・性格・食材の枠がすべて入っていること。
export const isComplete = (lv = state.lv) => hasMon() && currentSubs(lv).every(Boolean) && state.up && state.down && !currentArr(lv).includes(null);
// 食材タイプで、狙い食材がレベル lv で開いている食材の枠に出ない（Lv.50 で Lv.60 の枠だけに出る食材）。
// 無補正の個体も0個なので、無補正比・確率・順位は出さず、記録もしない。エナジーで評価するときは狙い食材を使わないので、閉じていても評価する。
export const targetClosed = (lv = state.lv) => hasMon() && state.type === 'ingredient' && !ingByEnergy() && !!state.target && !targetOpen(monData(), lv, state.target);
// 無補正比・確率・順位を出せるか。入力がそろっていて、狙い食材がレベル lv で出ること。
export const canRate = (lv = state.lv) => isComplete(lv) && !targetClosed(lv);
// 入力してあるサブスキル（低いレベルから続けて入っている分）。記録にはこれを保存する。
export const filledSubs = () => {
  const i = state.subs.findIndex((v) => !v);
  return state.subs.slice(0, i < 0 ? state.subs.length : i);
};
// タイプ type・ポケモン mon・レベル lv の計算条件。共通の設定（チケット・ヒーラー・受け取りなど）は今のものを使う。
// 食材タイプは狙い食材 target も条件に入る。エナジーで評価するときは target の代わりに by: 'energy' と、
// 食材配列 arr（開いている枠の候補の番号をつないだ文字列。例 '012'。そろっていなければ null）を入れる。
// エナジーの確率・順位は、同じ食材配列の個体だけを母集団にして数えるため。
// （狙い食材の個数で評価する条件は以前と同じ形なので、保存した分布・事前計算の分布をそのまま使う）。
const arrKey = (arr, lv) => {
  const a = (arr || []).slice(0, ingOpen(lv));
  return a.length === ingOpen(lv) && a.every(Number.isInteger) ? a.join('') : null;
};
export const envFor = (type, mon, lv, target, arr) => {
  const { camp, heal, tap, ingTap, team, healAmt, healTimes, recipeBonus, recipeLevel } = state;
  const N = slotCount(lv);
  if (type === 'berry') return { lv, N, camp, mon, heal, tap, team, healAmt, healTimes };
  if (type === 'ingredient' && state.ingBy === 'energy') return { lv, N, camp, mon, by: 'energy', arr: arrKey(arr, lv), heal, tap: ingTap, team, healAmt, healTimes, recipeBonus, recipeLevel };
  if (type === 'ingredient') return { lv, N, camp, mon, target, heal, tap: ingTap, team, healAmt, healTimes };
  return { lv, N, camp, mon, heal, tap: ingTap, team, healAmt, healTimes };
};
export const env = (lv = state.lv) => envFor(state.type, state.mon, lv, state.target, state.arr);
// 分布を求められる条件か（エナジーで評価するときは食材配列がそろっていること）。
export const distReady = (e) => !(e.by === 'energy' && !e.arr);
// 食材タイプのポケモンで前に選んだ狙い食材（なければ A）。
export const targetOf = (mon) => {
  const t = load(KEYS.target, {});
  const ings = TYPES.ingredient.MONS[mon].ings;
  return t && typeof t === 'object' && Object.hasOwn(ings, t[mon]) ? t[mon] : 'A';
};

// 記録はタイプごとのキーに保存する（食材・きのみは統合前と同じキー）。食材タイプの記録は食材配列のあるものだけ使う。
const loadRawLog = (type) => {
  const v = load(LOG_KEYS[type], []);
  return Array.isArray(v) ? v : [];
};
// 性格の名前がある記録は、上昇・下降の補正をそのタイプの分類で決め直す（分類が増えたときも古い記録を正しく計算するため）。
const withNature = (x, type) => {
  const n = natByName(x.nat);
  if (!n) return x;
  const c = TYPES[type].natCat;
  return { ...x, up: c(n[1]), down: c(n[2]) };
};
// 3タイプ・すべてのポケモンの記録。type を付けて返す。今は選べないポケモンの記録は除く。
export const loadAllLogs = () => Object.keys(LOG_KEYS).flatMap((type) => loadRawLog(type)
  .filter((x) => x && typeof x.mon === 'string' && Object.hasOwn(TYPES[type].MONS, x.mon) && Array.isArray(x.subs)
    && (type !== 'ingredient' || Array.isArray(x.arr)))
  .map((x) => ({ ...withNature(x, type), type })));
// 性格の名前がある記録は、上昇・下降の補正を今のタイプの分類で決め直す（分類が増えたときも古い記録を正しく計算するため）。
export const loadLog = () => loadAllLogs().filter((x) => x.type === state.type && x.mon === state.mon);
// type を省くと今のタイプの記録に足す。
export function appendLog(entry, type = state.type) { save(LOG_KEYS[type], [...loadRawLog(type), entry]); }
// 消した記録を返す（「元に戻す」で appendLog に渡す）。
export function removeLogEntry(t, type = state.type) {
  const all = loadRawLog(type);
  const gone = all.find((x) => String(x && x.t) === String(t)) || null;
  if (gone) save(LOG_KEYS[type], all.filter((x) => x !== gone));
  return gone;
}

// 記録の個体を入力欄に戻す。サブスキルは記録の枠の数だけ入れ、後ろの枠は空にする。
// 性格の名前がない古い記録は、上昇・下降の補正（分類）だけを戻す。
// 記録の食材配列は今までどおり枠ごとに見る（長さが違っても、合う枠は戻す）。
export function restoreEntry(x) { applyInput(x, false); }

// 記録・保存した入力 x を今のポケモンの入力にする。今のゲームデータにないサブスキル・性格と、そのポケモンに付かない性格はその部分だけ空にする。
// 食材配列は、候補の数（スロットの数）が合わなければ空、合えば範囲外の枠だけ空にする。
// 性格の名前がないときは、上昇・下降の分類がそのタイプにあるものだけ使う。
function applyInput(x, strictArr = true) {
  const subs = Array.isArray(x.subs) ? x.subs : [];
  state.subs = UNLOCK.map((_, i) => (typeof subs[i] === 'string' && Object.hasOwn(byId, subs[i]) ? subs[i] : null));
  if (natByName(x.nat)) {
    setNature(x.nat);
  } else {
    const cat = (c) => (typeof c === 'string' && Object.hasOwn(TYPES[state.type].NATL, c) ? c : null);
    state.nat = null;
    state.up = cat(x.up);
    state.down = cat(x.down);
  }
  if (state.type !== 'ingredient') {
    state.arr = [];
    return;
  }
  const slots = TYPES.ingredient.MONS[state.mon].slots, empty = emptyArr(state.mon);
  state.arr = Array.isArray(x.arr) && (!strictArr || x.arr.length === slots.length)
    ? slots.map((opts, i) => (Number.isInteger(x.arr[i]) && x.arr[i] >= 0 && x.arr[i] < opts.length ? x.arr[i] : empty[i]))
    : empty;
}

// 今の入力が記録の個体と、今のレベルで開いている枠について同じか。
export const isCurrent = (x) => currentSubs().join() === x.subs.slice(0, slotCount()).join()
  && (natByName(x.nat) ? x.nat === state.nat : !state.nat && state.up === x.up && state.down === x.down)
  && (state.type !== 'ingredient' || currentArr().join() === x.arr.slice(0, ingOpen(state.lv)).join());
