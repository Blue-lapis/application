// DOM 描画とイベント配線。計算はタイプごとの calc.js のエンジンに委譲する。
import { byId, UNLOCK, ingOpen, LEVELS } from '../../js/constants.js';
import { fmtPct, trunc, mmss } from '../../js/format.js';
import { eff } from '../../js/calc.js';
import { TYPES } from './types.js';
import { arrName, SLOT_LV, targetLevel, targetOpen } from './ingredient/constants.js';
import { slotsOf } from './ingredient/calc.js';
import { HEAL_AMT, HEAL_TIMES, TEAM_OTHERS, FIELD_BONUS, PARAM_LIMITS } from './berry/constants.js';
import { boostedEnergy } from './berry/calc.js';
import { energyAt } from './engine.js';
import { ingIcon } from './ingicons.js';
import { SUB_FULL, subShort, GOLD, FAMILIES, NAT_AXES, natAt, natByName, axisLabel } from './picker.js';
import {
  state, monData, loadSettings, setCamp, setLevel, setLvOpen, setMon, setType, setTarget, setNature, resetSelection,
  setHeal, setTap, setIngTap, setTeam, setFav, setParam,
  currentSubs, currentArr, filledSubs, slotCount, isComplete, canRate, targetClosed, env, envFor, targetOf, loadAllLogs, appendLog, removeLogEntry, restoreEntry, isCurrent,
  snapshotSelection, restoreSelection,
} from './state.js';

const $ = (id) => document.getElementById(id);
const chipHtml = (v, label, pressed, dis, cls) =>
  `<button class="chip ${cls || ''}" data-v="${v}" aria-pressed="${pressed}" ${dis ? 'disabled' : ''}>${label}</button>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// ポケモンの画像。img/mon/ はゲーム内のメニュー画像を切り詰めたもの。
const monSrc = (key) => `img/mon/${key}.webp`;
// 名前検索の正規化。全角半角・大文字小文字をそろえ、ひらがなはカタカナにする。
// loose はさらに濁点・半濁点と小さい字の違い、長音記号を無視する。
const SMALL = { ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ッ: 'ツ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ヮ: 'ワ' };
const norm = (s) => s.normalize('NFKC').toLowerCase().replace(/[\s・()（）]/g, '')
  .replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const loose = (s) => norm(s).normalize('NFD').replace(/[\u3099\u309a]/g, '').normalize('NFC')
  .replace(/[ァィゥェォッャュョヮ]/g, (c) => SMALL[c]).replace(/ー/g, '');
// 文字が順番どおりに含まれているか（「ふしばな」→フシギバナ）。
const inOrder = (q, s) => { let i = 0; for (const c of s) if (c === q[i]) i += 1; return i === q.length; };
// 一致の度合い。小さいほど上に出す。一致しなければ null。
function matchRank(q, name, key) {
  const n = norm(name), lq = loose(q), ln = loose(name);
  if (n.startsWith(norm(q))) return 0;
  if (n.includes(norm(q))) return 1;
  if (ln.includes(lq) || key.includes(norm(q))) return 2;
  if (inOrder(lq, ln)) return 3;
  return null;
}
// 「キュウコン(アローラのすがた)」を名前と姿に分ける。
const splitName = (name) => name.match(/^([^(]+)(?:\((.+)\))?$/).slice(1);
const def = () => TYPES[state.type];
// ダイアログの注記で使う、そのタイプの順位の基準。
const METRIC = { berry: 'きのみエナジー', ingredient: '食材の個数', skill: 'スキルの発動回数' };

// 性能の行。'grp' は見出し行。
const ROWS = {
  ingredient: [
    ['grp', 'おてつだい'], ['rTime', 'おてつだい時間'], ['rCut', '時間の短縮'], ['rHelps', '1日のおてつだい回数'], ['rGenki', 'げんき'],
    ['grp', '食材'], ['rIng', '食材確率'], ['rAmt', '1回あたりの狙い食材'], ['rIngHelps', '1日の食材おてつだい回数'],
    ['rIngList', '1日の食材の個数'], ['rCap', '最大所持数'], ['rFull', '睡眠中に満タンになる確率'],
    ['grp', '狙い食材の内訳'], ['rSelf', '自分の狙い食材'], ['rTeam', `おてボによるほかの${TEAM_OTHERS}匹の増加`],
    ['grp', '無補正個体との比較'], ['rBase', '無補正個体の1日個数'], ['rDRatio', '1日の個数の比（評価の基準）'], ['rGe', '同等以上の個体になる確率'], ['rOdds', '平均何匹に1匹'], ['rPos', '性能値の順位（参考）'],
  ],
  berry: [
    ['grp', 'おてつだい'], ['rTime', 'おてつだい時間'], ['rCut', '時間の短縮'], ['rHelps', '1日のおてつだい回数'], ['rGenki', 'げんき'],
    ['grp', 'きのみ'], ['rEnergy', 'きのみ1個のエナジー'], ['rAmt', '1回あたりのきのみ'], ['rCount', '1日のきのみの個数'],
    ['grp', '所持数'], ['rIng', '食材確率（満タンまで）'], ['rCap', '最大所持数'], ['rFull', '就寝時までに満タンになる確率'],
    ['rIngs', '1日に持ち帰る食材'],
    ['grp', 'エナジーの内訳'], ['rSelf', '自分のきのみエナジー'], ['rTeam', `おてボによるほかの${TEAM_OTHERS}匹の増加`],
    ['grp', '無補正個体との比較'], ['rBase', '無補正個体の1日エナジー'], ['rDRatio', '1日のエナジーの比（評価の基準）'], ['rGe', '同等以上の個体になる確率'], ['rOdds', '平均何匹に1匹'], ['rPos', '性能値の順位（参考）'],
  ],
  skill: [
    ['grp', 'おてつだい'], ['rTime', 'おてつだい時間'], ['rCut', '時間の短縮'], ['rHelps', '1日のおてつだい回数'],
    ['rGenki', 'げんき'], ['rCap', '最大所持数'], ['rIng', '食材おてつだい確率'], ['rRoll', '睡眠中のスキル抽選'],
    ['grp', 'スキル'], ['rRate', 'スキル確率'], ['rEff', '天井込みの実質確率'], ['rAvg', '発動までの平均おてつだい'], ['rAvgT', '発動までの平均時間'],
    ['grp', '発動回数の内訳'], ['rSelf', '自分の発動回数'], ['rTeam', `おてボによるほかの${TEAM_OTHERS}匹の増加`],
    ['grp', '無補正個体との比較'], ['rBase', '無補正個体の1日回数'], ['rDRatio', '1日の回数の比（評価の基準）'], ['rGe', '同等以上の個体になる確率'], ['rOdds', '平均何匹に1匹'], ['rPos', '性能値の順位（参考）'],
  ],
};

// 記録・順位で使う、タイプごとのスコア（無補正比）。
const scoreOf = (engine, x, e) => (state.type === 'ingredient'
  ? engine.score(x.subs, x.up, x.down, x.arr, e)
  : engine.score(x.subs, x.up, x.down, e));

// 数値に小さめの単位を付ける（帯とヒーローの大きな数字用）。
const withUnit = (v, u) => `${v}<span class="u">${u}</span>`;
// 「何匹に1匹」。帯に収まるよう10万以上は万・億単位にする。
const fmtOdds = (n) => {
  if (n < 1e5) return withUnit(Math.round(n).toLocaleString(), '匹');
  if (n < 1e7) return withUnit((n / 1e4).toFixed(1), '万匹');
  if (n < 1e8) return withUnit(Math.round(n / 1e4).toLocaleString(), '万匹');
  return withUnit((n / 1e8).toFixed(1), '億匹');
};

// 選んだポケモンを URL にも残して、ブックマークや共有で開けるようにする。
const syncUrl = () => {
  try { history.replaceState(null, '', `?mon=${encodeURIComponent(state.mon)}`); } catch { /* history unavailable */ }
};

let worker = null;
// Worker で計算している分布 { type, env }。
let inFlight = null;
// 保存してなかったので計算している分布（タイプと条件の組）。読み込み中は「…」、計算中は「計算中」と出す。
const computing = new Set();
const jobKey = (type, e) => `${type}|${JSON.stringify(e)}`;
const pendingText = () => (computing.has(jobKey(state.type, env())) ? '計算中' : '…');

export function initUI(engines) {
  loadSettings();
  startWorker(engines);

  // タブは色の点・短い名前・匹数。色だけに頼らないよう、名前は必ず出す。
  $('tabs').innerHTML = Object.entries(TYPES).map(([t, d]) =>
    `<button role="tab" id="tab-${t}" data-type="${t}" aria-label="${d.label}（${Object.keys(d.MONS).length}匹）"><span><i class="d-${t}"></i>${d.short}</span><small>${Object.keys(d.MONS).length}匹</small></button>`).join('');
  $('tabs').querySelectorAll('[role="tab"]').forEach((b) => {
    b.onclick = () => { hideToast(); setType(b.dataset.type); syncUrl(); refresh(engines); window.scrollTo({ top: 0 }); };
  });
  // 左右キーでタブを移る。
  $('tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tabs = [...$('tabs').querySelectorAll('[role="tab"]')];
    const i = tabs.findIndex((b) => b.dataset.type === state.type);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.click();
    next.focus();
  });
  // カードから開いたときは今のタイプに、虫めがねから開いたときは「すべて」に絞り込んでおく。
  const openMon = (search) => {
    $('monQ').value = '';
    monFilter = search ? 'all' : state.type;
    renderMonDlg();
    $('monDlg').showModal();
    $('monGrid').querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'center' });
    // タブの横の虫めがねから開いたときは、すぐ名前を入れられるようにする（3タイプから探す）。
    if (search) $('monQ').focus();
  };
  $('monBtn').onclick = () => openMon(false);
  $('searchBtn').onclick = () => openMon(true);
  $('monClose').onclick = () => $('monDlg').close();
  $('monDlg').addEventListener('click', (e) => { if (e.target === $('monDlg')) $('monDlg').close(); });
  const pickMon = (key) => {
    hideToast();
    setMon(key);
    syncUrl();
    $('monDlg').close();
    refresh(engines);
  };
  $('monQ').addEventListener('input', renderMonDlg);
  // Enter で一番上の候補を選ぶ。
  // Enter で一番よく一致する候補を選ぶ（名前を入れていないときは一番上）。
  $('monQ').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const b = $('monGrid').querySelector('button[data-best]') || $('monGrid').querySelector('button');
    if (b) { e.preventDefault(); pickMon(b.dataset.v); }
  });
  $('monGrid').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    pickMon(b.dataset.v);
  });
  $('monFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    monFilter = b.dataset.f;
    renderMonDlg();
  });

  initParams(engines);
  $('lvxHead').onclick = () => { setLvOpen(!state.lvOpen); renderLvList(engines); };

  initDialogs(engines);

  // 記録は、下の帯の「記録」と判定のカードの「記録する」のどちらからでもできる。
  const saveEntry = () => {
    if (!canRate()) return;
    // サブスキルは今のレベルの枠より多く入れてあればその分も残し、ほかのレベルでも一覧に出せるようにする。
    // 記録したときのレベル（lv）と、食材タイプは狙い食材（target）も残す（記録の一覧で、ほかのポケモンの記録を評価するのに使う）。
    const entry = { t: Date.now(), mon: state.mon, subs: filledSubs(), nat: state.nat, up: state.up, down: state.down, lv: state.lv };
    appendLog(state.type === 'ingredient' ? { ...entry, arr: [...state.arr], target: state.target } : entry);
    renderLog(engines);
    $('save').textContent = '記録済';
    setTimeout(() => { $('save').textContent = '記録'; }, 1200);
    toast('記録しました', '記録を見る', openLog);
  };
  $('save').onclick = saveEntry;
  $('verdict').addEventListener('click', (e) => {
    if (e.target.closest('#vSave')) saveEntry();
    const lv = e.target.closest('[data-lv]');
    if (lv) { setLevel(+lv.dataset.lv); refresh(engines); }
  });

  // 消した入力は、しばらく「元に戻す」で戻せる。
  $('reset').onclick = () => {
    const snap = snapshotSelection();
    resetSelection();
    refresh(engines);
    window.scrollTo({ top: 0 });
    toast('入力を消しました', '元に戻す', () => { restoreSelection(snap); refresh(engines); });
  };

  const openLog = () => { $('logDlg').showModal(); renderLog(engines); };
  $('logBtn').onclick = openLog;
  // 記録の一覧のレベル。メイン画面のレベル（条件の欄）と同じものを切り替える。
  $('logLvSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setLevel(+b.dataset.v);
    refresh(engines);
  });
  $('logFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    logFilter = b.dataset.f;
    renderLog(engines);
  });
  $('logClose').onclick = () => $('logDlg').close();
  $('logDlg').addEventListener('click', (e) => { if (e.target === $('logDlg')) $('logDlg').close(); });
  $('toastAct').onclick = () => { const f = toastFn; hideToast(); if (f) f(); };

  initTheme();
  watchVerdict();

  refresh(engines);
}

// 見出し・ポケモンの情報・性能の行の枠は、タイプとポケモンが変わったときだけ作り直す。
let shownHeader = null;
function renderHeader() {
  const key = `${state.type}|${state.mon}`;
  if (key === shownHeader) return;
  shownHeader = key;
  const mm = monData(), d = def();
  document.documentElement.dataset.type = state.type;
  document.title = `${mm.name} ${d.label} 厳選チェッカー`;
  $('tabs').querySelectorAll('[role="tab"]').forEach((b) => {
    const on = b.dataset.type === state.type;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  // ポケモンのカード。カード全体が選ぶボタン。姿の名前は2行目に小さく出す。
  const [base, form] = splitName(mm.name);
  const note = state.type === 'berry' ? esc(mm.berry) : state.type === 'skill' ? `天井 ${d.ceilOf(mm)}回目` : '';
  $('monBtn').innerHTML = `<img src="${monSrc(state.mon)}" alt="" width="92" height="92"><span class="mb">`
    + `<small class="mt">${d.label}${note ? ` · ${note}` : ''}</small>`
    + `<b>${esc(base)}${form ? `<small class="form">${esc(form)}</small>` : ''}</b>`
    + '<span class="go">ポケモンを変える<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></span></span>';
  const fact = (label, value) => `<div><small>${label}</small><b>${value}</b></div>`;
  $('facts').innerHTML = fact('おてつだい', `${Math.floor(mm.time / 60)}:${String(mm.time % 60).padStart(2, '0')}`)
    + fact('食材確率', `${+(mm.ingP * 100).toFixed(1)}%`) + fact('最大所持数', mm.cap)
    + (state.type === 'berry' ? fact('きのみ', `×${mm.berries}`) : '')
    + (state.type === 'skill' ? fact('スキル確率', `${+(mm.skillP * 100).toFixed(1)}%`) : '');
  // 食材は名前の途中で折り返さないよう、アイコンの下に名前を置いて横に並べる。
  const ings = [...new Set(mm.slots.flat().map(([i]) => mm.ings[i]))]
    .map((n) => `<li>${ingIcon(n)}<span>${esc(n)}</span></li>`).join('');
  $('monInfo').innerHTML = `<div class="ingrow"><small>食材</small><ul>${ings}</ul></div>`;
  $('arrSec').hidden = state.type !== 'ingredient';
  $('reset').textContent = state.type === 'ingredient' ? '食材配列・サブスキル・性格を消す' : 'サブスキル・性格を消す';
  // くわしい数値は見出しごとに開閉する。最初の見出しだけ開いておく。
  const groups = [];
  ROWS[state.type].forEach(([id, label]) => {
    if (id === 'grp') groups.push({ label, rows: [] });
    else groups[groups.length - 1].rows.push(`<dt>${label}</dt><dd id="${id}">—</dd>`);
  });
  $('rows').innerHTML = groups.map((g, i) => `<details${i === 0 ? ' open' : ''}><summary>${g.label}`
    + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
    + `</summary><dl class="rows">${g.rows.join('')}</dl></details>`).join('');
}

function renderIngs(engines) {
  if (state.type !== 'ingredient') return;
  const mm = monData();
  // 今のレベルでまだ出ない食材は押せなくして、出るレベルを添える。選んである食材はそのまま残す（レベルを戻せば評価できる）。
  $('target').innerHTML = Object.keys(mm.ings).map((k) => {
    const lock = state.target !== k && !targetOpen(mm, state.lv, k);
    return chipHtml(k, `${ingIcon(mm.ings[k])}${k} ${mm.short[k]}${lock ? `<small>Lv.${targetLevel(mm, k)}〜</small>` : ''}`, state.target === k, lock, lock ? 'lock' : '');
  }).join('');
  $('target').querySelectorAll('.chip').forEach((b) => {
    b.onclick = () => { setTarget(b.dataset.v); refresh(engines); };
  });

  // 今のレベルでまだ開いていない枠（Lv.50 の Lv.60 の枠）は薄くする。入れておくと Lv.60 以上で使う。
  const open = ingOpen(state.lv);
  $('arr').innerHTML = mm.slots.map((opts, i) => `<div class="slot${i >= open ? ' off' : ''}"><span>${SLOT_LV[i]}${i >= open ? '<small>未解放</small>' : ''}</span><div class="chips" data-i="${i}">${
    opts.map(([ing, a], k) => chipHtml(k, `${ingIcon(mm.ings[ing])}${mm.short[ing]}×${a}`, state.arr[i] === k, opts.length === 1, ing === state.target ? 'tgt' : '')).join('')
  }</div></div>`).join('');
  $('arr').querySelectorAll('.chips').forEach((g) => g.querySelectorAll('.chip').forEach((b) => {
    b.onclick = () => {
      const i = +g.dataset.i, k = +b.dataset.v;
      state.arr[i] = state.arr[i] === k ? null : k;
      refresh(engines);
    };
  }));
}

const rarityCls = (id) => `r-${byId[id].rarity}`;

// サブスキルは5枠すべてを、レベルの低い枠から順に入れる。手前の枠が空いている枠は選べない。
const reachable = (i) => state.subs.slice(0, i).every(Boolean);
const firstEmpty = () => Math.max(0, state.subs.findIndex((v) => !v));

// サブスキルの枠。タップすると、その枠を選ぶダイアログを開く。
function renderSlots() {
  // 今のレベルではまだ開いていない枠は「未解放」と添える（入れておくと、そのレベルを選んだときに使う）。
  const N = slotCount();
  $('slots').innerHTML = UNLOCK.map((lv, i) => {
    const id = state.subs[i], off = i >= N;
    return `<button class="subslot ${id ? rarityCls(id) : 'empty'}${off ? ' off' : ''}" data-i="${i}" aria-haspopup="dialog" ${reachable(i) ? '' : 'disabled'}><small>Lv.${lv}${off ? '<em>未解放</em>' : ''}</small><span>${id ? SUB_FULL[id] || subShort(id) : '未選択'}</span></button>`;
  }).join('');
  $('slots').querySelectorAll('.subslot').forEach((b) => { b.onclick = () => openSub(+b.dataset.i); });
  $('subCount').textContent = `${filledSubs().length} / ${UNLOCK.length}枠`;
}

// 性格のボタン。名前と、上昇・下降の補正を出す。計算に効かない補正は薄くする。
function renderNat() {
  const n = natByName(state.nat);
  // 性格の名前がない古い記録を戻したときは、補正だけを出す。
  if (!n && state.up && state.down) {
    const { NATL } = def();
    $('natBtn').innerHTML = `<b>—</b><small>▲${NATL[state.up]} ▼${NATL[state.down]}</small>`;
    return;
  }
  if (!n) {
    $('natBtn').innerHTML = '<b class="dim">未選択</b><small>タップして選ぶ</small>';
    return;
  }
  const side = (mark, code) => `<span class="${def().natCat(code) === 'other' ? 'off' : ''}">${mark}${axisLabel(code)}</span>`;
  $('natBtn').innerHTML = `<b>${n[0]}</b><small>${n[1] ? `${side('▲', n[1])} ${side('▼', n[2])}` : '無補正'}</small>`;
}

// ダイアログ。サブスキルは選ぶと次の空き枠へ進み、5枠すべてが埋まったら閉じる。途中でも閉じるボタンで閉じられる。性格は選ぶと閉じる。
let subAt = 0;

function initDialogs(engines) {
  // 性格は背景（ダイアログの外側）をタップしても閉じる。
  $('natDlg').addEventListener('click', (e) => { if (e.target === $('natDlg')) $('natDlg').close(); });
  // サブスキルは続けて入れるので、Esc キーでも閉じない。
  $('subDlg').addEventListener('cancel', (e) => e.preventDefault());
  $('subClose').onclick = () => $('subDlg').close();
  $('natClose').onclick = () => $('natDlg').close();
  $('subClear').onclick = () => { state.subs = UNLOCK.map(() => null); subAt = 0; refresh(engines); };
  $('natClear').onclick = () => { setNature(null); $('natDlg').close(); refresh(engines); };
  $('natBtn').onclick = () => { renderNatDlg(); $('natDlg').showModal(); };

  $('subTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && !b.disabled) { subAt = +b.dataset.i; renderSubDlg(); }
  });
  $('subBody').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = b.dataset.v;
    // どこかの枠で選んでいるものを押すと、その枠から外して、その枠を入れ直す。
    // 途中の枠を外したときは、そこを埋めるまで後ろの枠は選べない。
    const at = state.subs.indexOf(id);
    if (at >= 0) {
      state.subs[at] = null;
      subAt = at;
    } else {
      state.subs[subAt] = id;
      // 次の枠が空いていれば進む。入れ直しのときはその枠に留まる。
      if (subAt + 1 < UNLOCK.length && !state.subs[subAt + 1]) subAt += 1;
      // 選んだ結果すべての枠が埋まったら閉じる。直すときはもう一度開く。
      if (state.subs.every(Boolean)) $('subDlg').close();
    }
    refresh(engines);
  });
  $('natGrid').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setNature(b.dataset.v);
    $('natDlg').close();
    refresh(engines);
  });
}

// ポケモンの一覧。タイプの絞り込み（すべて・きのみ・食材・スキル）と名前で探し、タイプごとの見出しの下に並べる。
// 名前を入れたら一致の度合いの順に並べ、絞り込みのボタンにはそれぞれの件数を出す。
let monFilter = 'all';
function renderMonDlg() {
  const q = $('monQ').value.trim();
  const found = Object.fromEntries(Object.entries(TYPES).map(([t, d]) => {
    let list = Object.entries(d.MONS).map(([k, m], i) => ({ k, m, i, rank: 0 }));
    if (q) {
      list = list.map((x) => ({ ...x, rank: matchRank(q, x.m.name, x.k) })).filter((x) => x.rank !== null)
        .sort((a, b) => a.rank - b.rank || a.i - b.i);
    }
    return [t, list];
  }));
  const count = (t) => (t === 'all' ? Object.values(found).reduce((n, l) => n + l.length, 0) : found[t].length);
  $('monFilter').innerHTML = ['all', ...Object.keys(TYPES)].map((t) => `<button type="button" data-f="${t}" aria-pressed="${t === monFilter}">`
    + `${t === 'all' ? 'すべて' : `<i class="d-${t}"></i>${TYPES[t].short}`}${q ? `<small>${count(t)}</small>` : ''}</button>`).join('');
  const shown = (monFilter === 'all' ? Object.keys(TYPES) : [monFilter]).filter((t) => found[t].length);
  // Enter で選ぶ候補は、表示している中で一番よく一致するもの。
  const best = q ? shown.flatMap((t) => found[t]).reduce((a, x) => (!a || x.rank < a.rank ? x : a), null) : null;
  $('monGrid').innerHTML = shown.map((t) => `<h3 class="monsec"><i class="d-${t}"></i>${TYPES[t].label}<span>${found[t].length}</span></h3>`
    + `<div class="mongrid">${found[t].map(({ k, m }) => {
      const [base, form] = splitName(m.name);
      return `<button data-v="${k}" aria-pressed="${k === state.mon}"${best && best.k === k ? ' data-best' : ''}><img src="${monSrc(k)}" alt="" width="56" height="56" loading="lazy">`
        + `<span>${esc(base)}</span>${form ? `<small>${esc(form)}</small>` : ''}</button>`;
    }).join('')}</div>`).join('');
  // 絞り込んだタイプにいなくても、ほかのタイプにいればそう伝える。
  const others = count('all');
  $('monNone').hidden = shown.length > 0;
  $('monNone').textContent = monFilter !== 'all' && others
    ? `${TYPES[monFilter].label}には見つかりませんでした（「すべて」で${others}匹）`
    : '見つかりませんでした';
}

function openSub(i) {
  subAt = reachable(i) ? i : firstEmpty();
  renderSubDlg();
  $('subDlg').showModal();
}

function renderSubDlg() {
  if (subAt >= UNLOCK.length || !reachable(subAt)) subAt = firstEmpty();
  const lvs = UNLOCK;
  $('subTitle').textContent = `Lv.${lvs[subAt]} のサブスキルを選んでください`;
  $('subTabs').innerHTML = lvs.map((lv, i) => {
    const id = state.subs[i];
    return `<button class="${id ? `r-${byId[id].rarity}` : 'empty'}" data-i="${i}" aria-pressed="${i === subAt}" ${reachable(i) ? '' : 'disabled'}><small>Lv.${lv}</small><span>${id ? subShort(id) : '—'}</span></button>`;
  }).join('');

  // ほかの枠で選んでいるサブスキルには、その枠のレベルを付ける。押すとその枠から外れる。
  const usedAt = Object.fromEntries(state.subs.map((id, i) => [id, lvs[i]]).filter(([id]) => id));
  const chip = (id, label, cls) => {
    const lv = usedAt[id], mine = state.subs[subAt] === id;
    return `<button class="pick ${rarityCls(id)} ${lv && !mine ? 'used' : ''} ${cls || ''}" data-v="${id}" aria-pressed="${mine}" aria-label="${SUB_FULL[id]}${lv ? `（Lv.${lv}で選択中・押すと外す）` : ''}">${label}${lv ? `<i>${lv}</i>` : ''}</button>`;
  };
  $('subBody').innerHTML = `<h3>金色サブスキル</h3><div class="gold">${GOLD.map((id) => chip(id, SUB_FULL[id])).join('')}</div>`
    + `<div class="fams">${FAMILIES.map(([label, sizes]) => `<div class="fam"><span>${label}</span><div>${sizes.map(([id, sz]) => chip(id, sz, 'sz')).join('')}</div></div>`).join('')}</div>`;
  $('subNote').textContent = `途中で閉じても期待値は出ます。同等以上の確率は、性能で選んだレベルの枠（Lv.50・60 は3枠、Lv.70 は4枠、Lv.80 は5枠）がそろうと出ます。${METRIC[state.type]}に影響しないサブスキル（睡眠EXPボーナスなど）は、「なし他」として計算します。`;
}

// 性格の表。計算上は無補正と同じになる性格（効く補正がないもの）は薄くする。
function renderNatDlg() {
  const c = def().natCat;
  const on = (code) => c(code) !== 'other';
  const head = (mark, code, label) => `<span class="h ${on(code) ? 'on' : ''}">${mark}${label}</span>`;
  $('natGrid').innerHTML = `<span class="h corner">▲＼▼</span>${NAT_AXES.map(([code, , short]) => head('▼', code, short)).join('')}`
    + NAT_AXES.map(([up, , short]) => head('▲', up, short) + NAT_AXES.map(([down]) => {
      const name = natAt(up, down);
      const cls = [up === down ? 'neutral' : '', on(up) || on(down) ? '' : 'off'].join(' ');
      return `<button class="${cls}" data-v="${name}" aria-pressed="${state.nat === name}" aria-label="${name}（${up === down ? '無補正' : `▲${axisLabel(up)} ▼${axisLabel(down)}`}）">${name}</button>`;
    }).join('')).join('');
  const labels = NAT_AXES.filter(([code]) => on(code)).map(([, l]) => l);
  $('natNote').textContent = `${METRIC[state.type]}に効くのは ${labels.join(' と ')} の補正だけです。薄い色の性格は「無補正」と同じ結果になります。`;
}

// パラメーター。日中の受け取りといいキャンプチケットはその場で切り替え、
// ヒーラー・げんき・チームへの効果・げんきオールS の回復量と発動回数は詳細のダイアログで変える。
const healText = (e) => (e.heal === 'g80' ? 'げんき常時81%以上'
  : e.heal ? `ヒーラー${e.heal}匹（げんきオールS ${e.healAmt}×${e.healTimes}回/日）` : 'ヒーラーなし');
const teamText = (e) => `おてボのチーム効果を${e.team ? '含める' : '含めない'}`;
const tapText = (e) => (e.tap === '3h' ? '起床中は3時間ごとと就寝時に受け取る'
  : e.tap === 'always' ? '日中は常時タップ（所持数はあふれない）' : '受け取らない（ずっといつのまに育成）');
const genkiText = (g) => `就寝時${g.bed}→起床前${g.end}`;
// きのみのエナジーの補正（きのみタイプだけ）。既定のとき（ボーナス0%・好きでない）は null。
const boostText = () => {
  const t = [state.fieldBonus ? `フィールドボーナス+${state.fieldBonus}%` : '', state.fav ? '好きなきのみ' : ''].filter(Boolean);
  return t.length ? t.join('・') : null;
};

// パラメーターの切り替え。[要素の id, 今の値をボタンの data-v と同じ文字列にする関数, data-v から値を設定する関数]。
const SEGS = [
  ['lvSeg', () => String(state.lv), (v) => setLevel(+v)],
  ['healSeg', () => String(state.heal), (v) => setHeal(v === 'g80' ? v : +v)],
  ['tapSeg', () => state.tap, setTap],
  ['ingTapSeg', () => state.ingTap, setIngTap],
  ['campSeg', () => (state.camp ? '1' : '0'), (v) => setCamp(v === '1')],
  ['teamSeg', () => (state.team ? '1' : '0'), (v) => setTeam(v === '1')],
  ['favSeg', () => (state.fav ? '1' : '0'), (v) => setFav(v === '1')],
];

function initParams(engines) {
  SEGS.forEach(([id, , set]) => $(id).querySelectorAll('button').forEach((b) => {
    b.onclick = () => { set(b.dataset.v); refresh(engines); };
  }));

  $('paramBtn').onclick = () => { renderParamDlg(); $('paramDlg').showModal(); };
  $('paramClose').onclick = () => $('paramDlg').close();
  $('paramDlg').addEventListener('click', (e) => { if (e.target === $('paramDlg')) $('paramDlg').close(); });
  // 範囲外の値は受け付けず、入力欄を今の値に戻す。
  ['healAmt', 'healTimes', 'fieldBonus'].forEach((k) => {
    $(k).addEventListener('change', () => {
      if (!setParam(k, Number($(k).value))) $(k).value = state[k];
      refresh(engines);
    });
  });
  $('paramReset').onclick = () => {
    setParam('healAmt', HEAL_AMT);
    setParam('healTimes', HEAL_TIMES);
    setParam('fieldBonus', FIELD_BONUS);
    setFav(false);
    refresh(engines);
  };
  // 回復量と発動回数の −／＋ は1ずつ動かす（発動回数の小数はそのまま残す）。範囲の端で止める。
  ['healAmt', 'healTimes'].forEach((k) => {
    const [lo, hi] = PARAM_LIMITS[k];
    [['Down', -1], ['Up', 1]].forEach(([id, d]) => {
      $(k + id).onclick = () => {
        setParam(k, Math.min(hi, Math.max(lo, Math.round((state[k] + d) * 100) / 100)));
        refresh(engines);
      };
    });
  });
  // フィールドボーナスは手入力なら整数で1%単位。−／＋ は5の倍数に揃えながら5%ずつ動かす（33 なら＋で35、−で30）。範囲の端で止める。
  const [bMin, bMax] = PARAM_LIMITS.fieldBonus;
  [['bonusDown', -5], ['bonusUp', 5]].forEach(([id, d]) => {
    $(id).onclick = () => {
      const v = d > 0 ? Math.floor(state.fieldBonus / 5) * 5 + 5 : Math.ceil(state.fieldBonus / 5) * 5 - 5;
      setParam('fieldBonus', Math.min(bMax, Math.max(bMin, v)));
      refresh(engines);
    };
  });
}

function renderParams() {
  // 性能の欄と詳細のダイアログの両方で、タイプに合う行だけを出す。
  document.querySelectorAll('[data-for]').forEach((row) => { row.hidden = !row.dataset.for.split(' ').includes(state.type); });
  SEGS.forEach(([id, cur]) => $(id).querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(cur() === b.dataset.v))));
  // 詳細のダイアログにある設定の要約。
  const e = env();
  $('paramSum').textContent = [
    e.heal === 'g80' ? healText(e) : `${healText(e)}・げんき${genkiText(energyAt(e, 100))}`,
    teamText(e),
    state.type === 'berry' ? boostText() : null,
  ].filter(Boolean).join('・');
  if ($('paramDlg').open) renderParamDlg();
}

function renderParamDlg() {
  ['healAmt', 'healTimes', 'fieldBonus'].forEach((k) => {
    if (document.activeElement !== $(k)) $(k).value = state[k];
  });
  ['healAmt', 'healTimes'].forEach((k) => {
    $(k + 'Down').disabled = state[k] <= PARAM_LIMITS[k][0];
    $(k + 'Up').disabled = state[k] >= PARAM_LIMITS[k][1];
  });
  const e = env();
  if (state.type === 'berry') {
    const mm = monData();
    $('favLbl').textContent = `${mm.name}のきのみ（${mm.berry}）を好きなきのみとして扱う`;
    const [bMin, bMax] = PARAM_LIMITS.fieldBonus;
    $('bonusDown').disabled = state.fieldBonus <= bMin;
    $('bonusUp').disabled = state.fieldBonus >= bMax;
  }
  const teamNote = state.type === 'ingredient'
    ? `。おてボのチーム効果は、ほかの${TEAM_OTHERS}匹を同じポケモン（狙い食材が最も多い食材配列・サブスキルなし・無補正性格）として、おてつだいボーナスで増える狙い食材の個数を足します。ヒーラーの設定は3タイプで共通です。`
    : state.type === 'skill'
      ? `。おてボのチーム効果は、ほかの${TEAM_OTHERS}匹を同じポケモン（サブスキルなし・無補正性格・食材配列は出現率で平均）として、おてつだいボーナスで増える発動回数を足します。ヒーラーの設定は3タイプで共通です。`
      : '';
  $('paramNote').textContent = `ヒーラーは起床中に等間隔で発動し、チーム全員のげんきを回復します（上限150）。発動回数が小数のときは、前後の整数回の日が混ざるものとして平均します。料理（10時・14時・20時）でも、そのときのげんきに応じて1〜9回復します。睡眠中は回復せず、10分ごとに1減ります。今の値でのげんき（ヒーラー1匹・起床時100）: ${genkiText(energyAt({ ...e, heal: 1 }, 100))}${teamNote}`;
}

// 計算条件の表示。r は daily の結果（起床時のげんき wakeE）。
const condText = (m, e, r) => {
  const recText = m.rec > 1 ? '・げんき回復量↑1.2倍' : m.rec < 1 ? '・げんき回復量↓0.88倍' : '';
  return `Lv.${state.lv}・睡眠8.5時間・${healText(e)}${e.heal === 'g80' ? '' : `・起床時げんき${r.wakeE}${recText}`}・${tapText(e)}`;
};
const genkiRow = (r, e) => (e.heal === 'g80' ? '常に81%以上' : `${genkiText(r.genki)}<span>起床時${r.wakeE}・${e.heal ? `ヒーラー${e.heal}匹` : 'ヒーラーなし'}</span>`);
const timeRows = (r, m, e) => {
  const Tm = Math.floor(r.Te / 60), Ts = Math.floor(r.Te % 60);
  $('rTime').innerHTML = `${Tm}分${String(Ts).padStart(2, '0')}秒<span>${e.camp ? 'チケット込み・' : ''}げんき補正前</span>`;
  const cut = (1 - m.timeMul) * 100;
  $('rCut').innerHTML = `${cut >= 0 ? '−' : '+'}${trunc(Math.abs(cut))}%<span>性格・サブスキル合計</span>`;
  $('rHelps').innerHTML = `${(r.Ha + r.Hs).toFixed(1)}回<span>日中${r.Ha.toFixed(1)}回・睡眠中${r.Hs.toFixed(1)}回</span>`;
};

// 結果カードの横棒。日中と睡眠中の割合を幅で見せる（値がないときは空）。
const setSplit = (day, night) => {
  const all = day + night;
  $('hSplit').style.width = all > 0 ? `${(day / all) * 100}%` : '0';
};

// きのみタイプのチームへの効果の行。v が null なら隠し、日中・睡眠中の見出しも元に戻す。
// 出すときは、日中・睡眠中が自分の分だけだとわかるように見出しに「自分」を付ける。
function heroTeam(v, label = `おてボによるほかの${TEAM_OTHERS}匹の増加`) {
  $('hTeamL').textContent = label;
  $('hTeamW').hidden = v === null;
  $('hTeam').textContent = v ?? '';
  $('hDayL').textContent = v === null ? '日中' : '自分・日中';
  $('hNightL').textContent = v === null ? '睡眠中' : '自分・睡眠中';
}

// 未選択のサブスキル・性格は「なし他」・無補正として計算する。
// 順位の基準は、自分の狙い食材の個数＋おてボでほかの4匹（同じポケモン）が増やす狙い食材の個数。
function renderIngStats(engine) {
  const e = env(), mm = monData();
  const m = def().mults(currentSubs(), state.up, state.down);
  const tName = mm.ings[state.target];

  const ref = engine.reference(e);
  $('rBase').innerHTML = `${ref.v.toFixed(1)}個<span>${arrName(mm, ref.arr)}・無補正</span>`;

  // 食材配列が決まるまでは、無補正基準の配列で時間・確率などを表示する。
  const arrOk = !currentArr().includes(null);
  const r = engine.daily(m, arrOk ? state.arr : ref.arr, e);
  $('cond').textContent = condText(m, e, r);
  $('hLabel').textContent = `1日の${mm.short[state.target]}`;
  timeRows(r, m, e);
  $('rGenki').innerHTML = genkiRow(r, e);
  $('rIng').innerHTML = `${(r.ingP * 100).toFixed(1)}%<span>基礎${+(mm.ingP * 100).toFixed(2)}% × ${m.ingMul.toFixed(3)}</span>`;
  $('rIngHelps').innerHTML = `${((r.Ha + r.Hs) * r.ingP).toFixed(1)}回<span>所持数あふれを除く</span>`;
  $('rCap').innerHTML = `${r.cap}個<span>基礎${mm.cap}＋進化${mm.evo}回×5＋サブスキル${e.camp ? '・チケット込み' : ''}・きのみ${m.berry}個</span>`;

  if (!arrOk) {
    ['hAll', 'hDay', 'hNight', 'rAmt', 'rIngList', 'rFull', 'rSelf', 'rTeam'].forEach((id) => { $(id).textContent = '—'; });
    setSplit(0, 0);
    $('rDRatio').textContent = '—';
    return;
  }
  const slots = slotsOf(mm, state.arr, ingOpen(state.lv));
  const tAmt = slots.reduce((s, [ing, a]) => s + (ing === state.target ? a : 0), 0) / slots.length;
  const allAmt = slots.reduce((s, [, a]) => s + a, 0) / slots.length;
  const tDay = r.day[tName] || 0, tNight = r.night[tName] || 0, self = tDay + tNight;
  const team = engine.team(m, e);
  const showTeam = e.team && m.hb;

  $('hAll').innerHTML = withUnit(self.toFixed(1), '個');
  $('hDay').textContent = tDay.toFixed(1);
  $('hNight').textContent = tNight.toFixed(1);
  setSplit(tDay, tNight);
  heroTeam(showTeam ? `+${team.toFixed(1)}個` : null);

  $('rAmt').innerHTML = `${tAmt.toFixed(2)}個<span>全食材${allAmt.toFixed(2)}個</span>`;
  const names = [...new Set(slots.map(([k]) => mm.ings[k]))];
  $('rIngList').innerHTML = names.map((n) => {
    const k = Object.keys(mm.ings).find((x) => mm.ings[x] === n);
    return `${ingIcon(n)}${mm.short[k]} ${((r.day[n] || 0) + (r.night[n] || 0)).toFixed(1)}個`;
  }).join('<br>');
  $('rFull').innerHTML = `${(r.full * 100).toFixed(1)}%<span>あふれた食材 平均${r.lost.toFixed(1)}個</span>`;
  $('rSelf').innerHTML = `${self.toFixed(1)}個<span>日中${tDay.toFixed(1)}個・睡眠中${tNight.toFixed(1)}個</span>`;
  $('rTeam').innerHTML = !e.team ? '—<span>含めない設定</span>'
    : !m.hb ? '0個<span>おてつだいボーナスなし</span>'
      : `+${team.toFixed(1)}個<span>1匹あたり+${(team / TEAM_OTHERS).toFixed(1)}個（同じポケモン・${arrName(mm, ref.arr)}・無補正）</span>`;
  $('rDRatio').textContent = canRate() ? `${((self + team) / ref.v).toFixed(2)}倍` : '—';
}

function renderBerryStats(engine) {
  const e = env(), mm = monData();
  const m = def().mults(currentSubs(), state.up, state.down);
  const base = engine.baseMetric(e);
  const r = engine.daily(m, e);
  $('cond').textContent = `${condText(m, e, r)}・食材配列は捕獲時の出現率で平均`;
  $('hLabel').textContent = e.team ? '1日のエナジー（チームへの効果込み）' : '1日のきのみエナジー';

  // フィールドボーナス・好きなきのみは、きのみ1個のエナジーを変えるだけなので、表示の段で同じ比率 k を掛ける。
  // 自分・チームへの効果・無補正の個体に同じ比率が掛かるので、無補正比は変わらない。
  const energy = boostedEnergy(r.energy, state.fieldBonus, state.fav);
  const k = energy / r.energy;
  const count = r.day + r.night;
  const self = count * energy;
  const team = engine.teamGain(m, e) * k;
  const total = self + team;
  const baseE = base * k;
  // 日中・睡眠中は自分のきのみの分。チームへの効果があるときは別の行に出す。
  const showTeam = e.team && m.hb;
  $('hAll').textContent = Math.round(total).toLocaleString();
  $('hDay').textContent = Math.round(r.day * energy).toLocaleString();
  $('hNight').textContent = Math.round(r.night * energy).toLocaleString();
  setSplit(r.day, r.night);
  heroTeam(showTeam ? `+${Math.round(team).toLocaleString()}` : null);

  timeRows(r, m, e);
  $('rEnergy').innerHTML = `${energy}<span>${mm.berry} Lv.${r.LV}${k !== 1 ? `・${r.energy}に${boostText()}を掛けて切り上げ` : ''}</span>`;
  $('rAmt').innerHTML = `${r.berry}個<span>${m.berry ? `基礎${mm.berries}個＋きのみの数S` : 'きのみタイプ'}</span>`;
  $('rCount').innerHTML = `${count.toFixed(1)}個<span>日中${r.day.toFixed(1)}個・睡眠中${r.night.toFixed(1)}個</span>`;
  $('rIng').innerHTML = `${(r.ingP * 100).toFixed(1)}%<span>基礎${+(mm.ingP * 100).toFixed(2)}% × ${m.ingMul.toFixed(3)}</span>`;
  $('rCap').innerHTML = `${r.cap}個<span>基礎${mm.cap}＋進化${mm.evo}回×5＋サブスキル${e.camp ? '・チケット込み' : ''}</span>`;
  const pct = (x) => `${(Math.max(0, x) * 100).toFixed(1)}%`;
  $('rFull').innerHTML = e.tap === 'none' ? '100%<span>受け取らないので常に満タン</span>'
    : `${pct(r.fullBed)}<span>就寝前の受け取りまで・睡眠中は起床時まで${pct(r.full)}</span>`;
  $('rIngs').innerHTML = `${r.ings.toFixed(1)}個<span>満タンになるまで</span>`;
  $('rGenki').innerHTML = genkiRow(r, e);
  $('rSelf').innerHTML = `${Math.round(self).toLocaleString()}<span>日中${Math.round(r.day * energy).toLocaleString()}・睡眠中${Math.round(r.night * energy).toLocaleString()}</span>`;
  $('rTeam').innerHTML = !e.team ? '—<span>含めない設定</span>'
    : !m.hb ? '0<span>おてつだいボーナスなし</span>'
      : `+${Math.round(team).toLocaleString()}<span>1匹あたり+${Math.round(team / TEAM_OTHERS).toLocaleString()}（同じポケモン・無補正）</span>`;
  $('rBase').innerHTML = `${Math.round(baseE).toLocaleString()}<span>無補正${k !== 1 ? '（同じエナジーの補正）' : ''}</span>`;
  $('rDRatio').textContent = isComplete() ? `${(total / baseE).toFixed(2)}倍` : '—';
}

// 順位の基準は、自分の発動回数＋おてボでほかの4匹（同じポケモン）が増やす発動回数。
function renderSkillStats(engine) {
  const e = env(), mm = monData();
  const m = def().mults(currentSubs(), state.up, state.down);
  const base = engine.baseMetric(e);
  const r = engine.daily(m, e);
  $('cond').textContent = `${condText(m, e, r)}・食材配列は捕獲時の出現率で平均`;
  $('hLabel').textContent = '1日の期待発動回数';

  const self = r.day + r.night;
  const team = engine.team(m, e);
  const showTeam = e.team && m.hb;
  const p = eff(r.p, r.ceil);
  const avgHelps = 1 / p;
  $('hAll').innerHTML = withUnit(self.toFixed(2), '回');
  $('hDay').textContent = r.day.toFixed(2);
  $('hNight').textContent = r.night.toFixed(2);
  setSplit(r.day, r.night);
  heroTeam(showTeam ? `+${team.toFixed(2)}回` : null);

  timeRows(r, m, e);
  $('rGenki').innerHTML = genkiRow(r, e);
  $('rCap').innerHTML = `${r.cap}個<span>基礎${mm.cap}＋進化${mm.evo}回×5＋サブスキル${e.camp ? '・チケット込み' : ''}</span>`;
  $('rIng').innerHTML = `${(r.ingP * 100).toFixed(1)}%<span>基礎${+(mm.ingP * 100).toFixed(2)}% × ${m.ingMul.toFixed(3)}・きのみ${m.berry}個</span>`;
  $('rRoll').innerHTML = `${r.rolls.toFixed(1)}回<span>睡眠中${r.Hs.toFixed(1)}回のうち・満タン確率${(r.full * 100).toFixed(1)}%</span>`;
  $('rRate').innerHTML = `${(r.p * 100).toFixed(2)}%<span>基礎${+(mm.skillP * 100).toFixed(2)}% × ${m.skillMul.toFixed(3)}</span>`;
  $('rEff').innerHTML = `${(p * 100).toFixed(2)}%<span>${r.ceil}回目で確定を含む平均</span>`;
  $('rAvg').textContent = `${avgHelps.toFixed(1)}回`;
  $('rAvgT').innerHTML = `${mmss(avgHelps * r.Te * 0.45)}<span>げんき81%以上のとき</span>`;
  $('rSelf').innerHTML = `${self.toFixed(2)}回<span>日中${r.day.toFixed(2)}回・睡眠中${r.night.toFixed(2)}回</span>`;
  $('rTeam').innerHTML = !e.team ? '—<span>含めない設定</span>'
    : !m.hb ? '0回<span>おてつだいボーナスなし</span>'
      : `+${team.toFixed(2)}回<span>1匹あたり+${(team / TEAM_OTHERS).toFixed(2)}回（同じポケモン・無補正）</span>`;
  $('rBase').innerHTML = `${base.toFixed(2)}回<span>無補正</span>`;
  $('rDRatio').textContent = isComplete() ? `${((self + team) / base).toFixed(2)}倍` : '—';
}

// 分布の計算は Worker で1つずつ行う。終わったら次の分布を頼む。
function startWorker(engines) {
  // Keeps the version tag on the worker URL so it loads the same module set as this page.
  worker = new Worker(new URL(`./worker.js${new URL(import.meta.url).search}`, import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.computing) {
      computing.add(jobKey(data.type, data.env));
      renderBar(engines);
      renderLog(engines);
      return;
    }
    computing.delete(jobKey(data.type, data.env));
    engines[data.type].setDist(data.env, data.dist);
    inFlight = null;
    renderBar(engines);
    renderLog(engines);
    requestDist(engines);
  };
}

// 今の条件の分布を頼み、あればチケットのあり・なしを切り替えた条件を先に計算しておく（その場で切り替えられるため）。
// 今の条件の分布がないのに別の条件を計算しているとき（ポケモンや条件を変えた直後）は、その計算をやめて今の条件から始める。
function requestDist(engines) {
  const type = state.type, engine = engines[type];
  const cur = env();
  if (inFlight) {
    if (engine.ready(cur) || jobKey(inFlight.type, inFlight.env) === jobKey(type, cur)) return;
    worker.terminate();
    computing.delete(jobKey(inFlight.type, inFlight.env));
    inFlight = null;
    startWorker(engines);
  }
  // そのあとに、レベル別の一覧で使うほかのレベルの分布（確率を出せるレベルだけ）。
  const others = LEVELS.filter((lv) => lv !== state.lv && canRate(lv)).map((lv) => env(lv));
  const next = [cur, { ...cur, camp: !cur.camp }, ...others].find((e) => !engine.ready(e));
  if (next) {
    inFlight = { type, env: next };
    worker.postMessage({ type, env: next });
    return;
  }
  // 記録の一覧を開いている間は、ほかのポケモン・レベルの記録の分布も1つずつ読み込む（または計算する）。
  if (!$('logDlg').open) return;
  const job = logNeeds.find((x) => !engines[x.type].ready(x.env));
  if (!job) return;
  inFlight = job;
  worker.postMessage(job);
}

// レベル別の一覧。各レベルの無補正比と同等以上の確率を並べ、閉じているときは一番良いレベル（確率が一番低い）を1行で出す。
function renderLvList(engines) {
  const engine = engines[state.type], mm = monData();
  const rows = LEVELS.map((lv) => {
    if (targetClosed(lv)) return { lv, note: `Lv.${targetLevel(mm, state.target)}〜` };
    if (!canRate(lv)) return { lv, note: '未入力' };
    const e = env(lv);
    const r = scoreOf(engine, { subs: currentSubs(lv), up: state.up, down: state.down, arr: state.arr }, e);
    if (!engine.ready(e)) return { lv, r, wait: true };
    return { lv, r, ge: r > 0 ? engine.atLeast(r, e) : null };
  });
  const best = rows.filter((x) => x.ge != null).reduce((a, x) => (!a || x.ge < a.ge ? x : a), null);
  const waiting = rows.some((x) => x.wait);
  $('lvxSum').innerHTML = best
    ? `最高 <b>Lv.${best.lv}</b>・<b>${fmtPct(best.ge)}</b>${waiting ? '…' : ''}`
    : (waiting ? '…' : '—');
  $('lvxHead').setAttribute('aria-expanded', String(state.lvOpen));
  $('lvxBody').hidden = !state.lvOpen;
  if (!state.lvOpen) return;
  $('lvxRows').innerHTML = rows.map((x) => {
    const on = x.lv === state.lv, off = x.r == null;
    const ratio = off ? '—' : `${x.r.toFixed(2)}倍`;
    const ge = off ? `<small>${x.note}</small>` : x.wait ? '…' : x.ge == null ? '—' : `${x === best ? '<em>最高</em>' : ''}${fmtPct(x.ge)}`;
    return `<button type="button" class="lvx-row${off ? ' off' : ''}" data-v="${x.lv}" aria-pressed="${on}"><span class="lvx-lv">Lv.${x.lv}${on ? '<i>表示中</i>' : ''}</span><b>${ratio}</b><b>${ge}</b></button>`;
  }).join('');
  $('lvxRows').querySelectorAll('.lvx-row').forEach((b) => {
    b.onclick = () => { setLevel(+b.dataset.v); refresh(engines); };
  });
}

// 判定のカード。状態は、評価できない（狙い食材がまだ出ない）・未入力・計算中・結果の4つ。
// ゲージは同等以上の確率を 0.1%〜100% の対数の目盛りに置く（小さな確率の差が見えるように）。左ほどめずらしい。
const GAUGE = [[0.01, '1%'], [0.05, '5%'], [0.1, '10%'], [0.25, '25%'], [0.5, '50%']];
const gaugePos = (p) => Math.max(0, Math.min(100, ((Math.log10(Math.max(p, 1e-3)) + 3) / 3) * 100)).toFixed(1);

function renderVerdict(engines) {
  const d = def(), N = slotCount(), mm = monData();
  $('vMeta').textContent = `Lv.${state.lv}・サブスキル${N}枠・${d.short}`;
  if (targetClosed()) {
    const tl = targetLevel(mm, state.target);
    $('vBody').innerHTML = `<p class="v-msg">${esc(mm.short[state.target])}は Lv.${tl} から出る食材です</p>`
      + '<p class="v-sub">レベルを上げるか、ほかの狙い食材を選んでください</p>'
      + (LEVELS.includes(tl) ? `<button type="button" class="v-act" data-lv="${tl}">Lv.${tl} にする</button>` : '');
    return;
  }
  if (!isComplete()) {
    const have = currentSubs().filter(Boolean).length;
    const need = [`サブスキル ${have}/${N}`, `性格 ${state.up && state.down ? '✓' : '—'}`];
    if (state.type === 'ingredient') need.push(`食材配列 ${currentArr().includes(null) ? '—' : '✓'}`);
    $('vBody').innerHTML = `<p class="v-msg">${state.type === 'ingredient' ? '食材配列・' : ''}サブスキルと性格を選ぶと、ここに判定が出ます</p>`
      + `<div class="v-need">${need.map((x) => `<span>${x}</span>`).join('')}</div>`;
    return;
  }
  const e = env(), engine = engines[state.type];
  const r = scoreOf(engine, { subs: currentSubs(), up: state.up, down: state.down, arr: state.arr }, e);
  const ready = engine.ready(e);
  const ge = ready && r > 0 ? engine.atLeast(r, e) : null;
  const pct = !ready ? `<span class="v-wait">${pendingText()}</span>` : ge == null ? '—' : withUnit(fmtPct(ge).slice(0, -1), '%');
  const ticks = GAUGE.map(([p, l]) => `<i class="g-tick" style="left:${gaugePos(p)}%"></i><span class="g-lbl" style="left:${gaugePos(p)}%">${l}</span>`).join('');
  const foot = !ready ? '分布を計算しています…' : ge == null ? '無補正比が0のため確率は出ません' : `平均 <b>${fmtOdds(1 / ge)}</b>に1匹`;
  $('vBody').innerHTML = `<div class="v-main"><div><small>同等以上の確率</small><b class="v-ge">${pct}</b></div>`
    + `<div class="v-r"><small>無補正比</small><b>${withUnit(r.toFixed(2), '倍')}</b></div></div>`
    + `<div class="gauge${ready ? '' : ' wait'}" aria-hidden="true"><i class="g-track"></i>${ticks}${ge == null ? '' : `<i class="g-dot" style="left:${gaugePos(ge)}%"></i>`}</div>`
    + '<div class="g-ends" aria-hidden="true"><span>めずらしい</span><span>よくいる</span></div>'
    + `<div class="v-foot"><span>${foot}</span><button type="button" class="v-save" id="vSave">記録する</button></div>`;
}

// 下に出る短いお知らせ。「元に戻す」などの操作を1つだけ持ち、5秒で消える。
// 記録のダイアログを開いているときはダイアログの中に出す（ダイアログの背面に隠れないように）。
let toastFn = null, toastTimer = 0;
function toast(msg, act, fn) {
  const t = $('toast');
  ($('logDlg').open ? $('logDlg') : document.body).append(t);
  $('toastMsg').textContent = msg;
  $('toastAct').textContent = act;
  toastFn = fn;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() {
  $('toast').hidden = true;
  toastFn = null;
  clearTimeout(toastTimer);
}

// 表示テーマ。自動（端末の設定）→ライト→ダークの順に切り替え、cktheme に保存する。描画前の適用は index.html でする。
const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: '自動', light: 'ライト', dark: 'ダーク' };
const svg = (d) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const THEME_ICON = {
  auto: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4v16" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'),
  light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  dark: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
};
function initTheme() {
  let cur = 'auto';
  try { const t = JSON.parse(localStorage.getItem('cktheme')); if (THEMES.includes(t)) cur = t; } catch { /* storage unavailable */ }
  const show = () => {
    const root = document.documentElement;
    if (cur === 'auto') delete root.dataset.theme; else root.dataset.theme = cur;
    $('themeBtn').innerHTML = THEME_ICON[cur];
    $('themeBtn').setAttribute('aria-label', `表示テーマ: ${THEME_LABEL[cur]}（押すと切り替え）`);
    $('themeBtn').title = `表示テーマ: ${THEME_LABEL[cur]}`;
  };
  $('themeBtn').onclick = () => {
    cur = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    try { localStorage.setItem('cktheme', JSON.stringify(cur)); } catch { /* storage unavailable */ }
    show();
  };
  show();
}

// 判定のカードが画面に見えている間は、下の帯を隠す（同じ数字を2か所に出さない）。
function watchVerdict() {
  if (!('IntersectionObserver' in window)) return;
  new IntersectionObserver(([en]) => { $('bar').classList.toggle('away', en.isIntersecting); }).observe($('verdict'));
}

function renderBar(engines) {
  renderLvList(engines);
  renderVerdict(engines);
  const ok = canRate();
  ['bRatio', 'bRank', 'bOdds'].forEach((id) => $(id).classList.toggle('dim', !ok));
  $('save').disabled = !ok;
  $('bWait').hidden = ok;
  // 結果の行（同等以上の確率・平均何匹に1匹・性能値の順位）。
  const setRows = (ge, odds, pos) => {
    if (!$('rPos')) return;
    $('rGe').innerHTML = ge;
    $('rOdds').innerHTML = odds;
    $('rPos').innerHTML = pos;
  };
  if (!ok) {
    ['bRatio', 'bRank', 'bOdds'].forEach((id) => { $(id).textContent = '—'; });
    setRows('—', '—', '—');
    return;
  }
  const e = env(), engine = engines[state.type];
  const r = scoreOf(engine, { subs: currentSubs(), up: state.up, down: state.down, arr: state.arr }, e);
  $('bRatio').innerHTML = withUnit(r.toFixed(2), '倍');
  if (!engine.ready(e)) {
    $('bRank').textContent = pendingText();
    $('bOdds').textContent = '…';
    setRows(pendingText(), '…', '…');
    requestDist(engines);
    return;
  }
  // 何匹に1匹は、丸める前の確率の逆数。
  const ge = engine.atLeast(r, e);
  $('bRank').innerHTML = r > 0 ? withUnit(fmtPct(ge).slice(0, -1), '%') : '—';
  $('bOdds').innerHTML = r > 0 ? fmtOdds(1 / ge) : '—';
  const rk = engine.rankOf(r, e);
  setRows(
    r > 0 ? `${fmtPct(ge)}<span>この個体の無補正比以上になる推定確率</span>` : '—',
    r > 0 ? `約${Math.round(1 / ge).toLocaleString()}匹<span>同じポケモン・抽選条件での平均</span>` : '—',
    `${rk.pos.toLocaleString()}位<span>無補正比が異なる${rk.total.toLocaleString()}通りの中で。出やすさは考えないので確率とは一致しません</span>`,
  );
}

// 記録の一覧。3タイプ・すべてのポケモンの記録を、ポケモンごとの見出しの下に並べる（表示中のポケモンが先頭、ほかは新しい記録のある順）。
// 「すべて / きのみ / 食材 / スキル」で切り替える。それぞれの記録は今のレベルで評価し、サブスキル（食材タイプは食材配列も）が
// 足りないときは、評価できる一番高いレベルで評価してそのレベルを添える。条件（チケット・ヒーラーなど）は今の設定を使う。
let logFilter = 'all';
// 一覧で確率を出すのに要る分布。一覧を開いている間に requestDist が1つずつ頼む。
let logNeeds = [];
const TRASH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

// 記録 x を評価するレベル。今のレベルを先に、だめなら高いレベルから探す。どのレベルでも枠が足りなければ null。
function evalLevel(x) {
  const ok = (lv) => slotCount(lv) <= x.subs.length && (x.type !== 'ingredient' || x.arr.slice(0, ingOpen(lv)).every(Number.isInteger));
  return [state.lv, ...[...LEVELS].reverse()].find(ok) ?? null;
}

// 記録 x の評価。{ lv, e, r（無補正比。出せないときは null）, ge（確率。分布がまだなら undefined） }。
function rateLog(engines, x) {
  const lv = evalLevel(x);
  if (lv == null) return { lv, r: null };
  const here = x.type === state.type && x.mon === state.mon;
  const target = x.type === 'ingredient' ? (x.target || (here ? state.target : targetOf(x.mon))) : undefined;
  if (x.type === 'ingredient' && !targetOpen(TYPES.ingredient.MONS[x.mon], lv, target)) return { lv, r: null, closed: true };
  const e = envFor(x.type, x.mon, lv, target), engine = engines[x.type], N = slotCount(lv);
  const subs = x.subs.slice(0, N);
  const r = x.type === 'ingredient' ? engine.score(subs, x.up, x.down, x.arr, e) : engine.score(subs, x.up, x.down, e);
  const ready = engine.ready(e);
  return { lv, e, r, target, ready, ge: ready && r > 0 ? engine.atLeast(r, e) : null };
}

function renderLog(engines) {
  const all = loadAllLogs();
  const rows = all.filter((x) => logFilter === 'all' || x.type === logFilter).map((x) => ({ ...x, ...rateLog(engines, x) }));
  logNeeds = rows.filter((x) => x.e && x.r > 0 && !x.ready).map((x) => ({ type: x.type, env: x.e }));
  requestDist(engines);

  // 切り替えのボタン。それぞれの件数を添える。
  const n = (t) => all.filter((x) => t === 'all' || x.type === t).length;
  $('logFilter').innerHTML = ['all', ...Object.keys(TYPES)].map((t) => `<button type="button" data-f="${t}" aria-pressed="${t === logFilter}">`
    + `${t === 'all' ? 'すべて' : `<i class="d-${t}"></i>${TYPES[t].short}`}<small>${n(t)}</small></button>`).join('');

  $('logLvSeg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === state.lv)));

  // ポケモンごとにまとめる。
  const groups = new Map();
  rows.forEach((x) => {
    const k = `${x.type}|${x.mon}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  });
  const order = [...groups.entries()].map(([k, list]) => ({ k, list, cur: k === `${state.type}|${state.mon}`, last: Math.max(...list.map((x) => x.t)) }))
    .sort((a, b) => b.cur - a.cur || b.last - a.last);

  const pend = (x) => (computing.has(jobKey(x.type, x.e)) ? '計算中' : '…');
  const rowHtml = (x) => {
    const mm = TYPES[x.type].MONS[x.mon], { NATL } = TYPES[x.type];
    const N = x.lv ? slotCount(x.lv) : x.subs.length, open = ingOpen(x.lv || state.lv);
    const detail = `${x.type === 'ingredient' ? `${arrName(mm, x.arr.slice(0, open))}　` : ''}${x.subs.slice(0, N).map(subShort).join('／')}　${x.nat ? `${esc(x.nat)} ` : ''}▲${NATL[x.up]} ▼${NATL[x.down]}`;
    const cur = x.type === state.type && x.mon === state.mon && isCurrent(x);
    const lvTag = x.lv && x.lv !== state.lv ? `<span class="lvtag">Lv.${x.lv}で評価</span>` : '';
    const right = x.r == null
      ? `<b>—</b><div class="m">${x.closed ? `Lv.${x.lv}では狙い食材が出ません` : '枠が足りません'}</div>`
      : `<b>${x.r.toFixed(2)}倍</b><div class="m">${!x.ready ? pend(x) : x.ge ? `同等以上${fmtPct(x.ge)}<br>約${Math.round(1 / x.ge).toLocaleString()}匹に1匹` : '—'}</div>`;
    // Entries saved before the memo prompt was removed keep their memo as the heading.
    return `<li class="${cur ? 'cur' : ''}" data-k="${x.type}|${x.t}" tabindex="0" title="タップで入力に戻す" aria-current="${cur}"><div>${cur ? '<span class="now">表示中</span>' : ''}${lvTag}`
      + `${x.memo ? `${esc(x.memo)}<div class="m">${detail}</div>` : detail}</div><div>${right}</div>`
      + `<button class="del" data-k="${x.type}|${x.t}" aria-label="この記録を削除">${TRASH}</button></li>`;
  };
  $('log').innerHTML = order.length
    ? order.map(({ list }) => {
      const x0 = list[0], mm = TYPES[x0.type].MONS[x0.mon];
      const [base, form] = splitName(mm.name);
      const sorted = [...list].sort((a, b) => (b.r ?? -1) - (a.r ?? -1) || b.t - a.t);
      return `<li class="lgrp"><img src="${monSrc(x0.mon)}" alt="" width="36" height="36" loading="lazy"><span><i class="d-${x0.type}"></i>${esc(base)}${form ? `<small>${esc(form)}</small>` : ''}</span><small>${list.length}件</small></li>`
        + sorted.map(rowHtml).join('');
    }).join('')
    : `<li class="empty">${all.length ? `${TYPES[logFilter]?.label ?? ''}の記録はまだありません` : 'まだ記録はありません。判定のカードの「記録する」で残せます'}</li>`;

  // 行をタップすると、その個体を入力に戻して今の入力と見比べられるようにする。ほかのポケモンの記録なら、そのポケモン（とタイプ）に切り替える。
  // 評価したレベルが今と違うときは、そのレベルにする。削除ボタンは除く。
  const byK = Object.fromEntries(rows.map((x) => [`${x.type}|${x.t}`, x]));
  $('log').querySelectorAll('li[data-k]').forEach((li) => {
    const restore = () => {
      const x = byK[li.dataset.k];
      hideToast();
      if (x.type !== state.type || x.mon !== state.mon) { setMon(x.mon); syncUrl(); }
      if (x.type === 'ingredient' && x.target) setTarget(x.target);
      if (x.lv && x.lv !== state.lv) setLevel(x.lv);
      restoreEntry(x);
      $('logDlg').close();
      refresh(engines);
    };
    li.onclick = (ev) => { if (!ev.target.closest('.del')) restore(); };
    li.onkeydown = (ev) => {
      if (ev.target === li && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); restore(); }
    };
  });
  $('log').querySelectorAll('.del').forEach((b) => {
    b.onclick = () => {
      const [type, t] = b.dataset.k.split('|');
      const gone = removeLogEntry(t, type);
      renderLog(engines);
      if (gone) toast('記録を削除しました', '元に戻す', () => { appendLog(gone, type); renderLog(engines); });
    };
  });
  // アプリバーの記録ボタンに、記録の数（すべて）を出す。
  $('logCount').hidden = all.length === 0;
  $('logCount').textContent = all.length > 99 ? '99+' : String(all.length);
  $('logBtn').setAttribute('aria-label', `記録を開く（${all.length}件）`);
  $('logNum').textContent = `${rows.length}件`;
}

// 同等以上の確率・平均何匹に1匹・性能値の順位の意味と、確率の前提（抽選条件）。
function renderRankNote() {
  const lv60 = ingOpen(state.lv) >= 3 ? '、Lv.60 は3候補を等確率' : '。Lv.60 の枠はまだ開いていないので使わない';
  const arr = state.type === 'ingredient' ? `食材配列は捕獲時の出現率（Lv.30 は A 1/3・B 2/3${lv60}）、` : `食材配列は捕獲時の出現率で平均${ingOpen(state.lv) >= 3 ? '' : '（Lv.60 の枠は使わない）'}、`;
  $('rankNote').textContent = '「同等以上の確率」は、同じポケモン・同じパラメーターで、サブスキルを1枠ずつ色（金14%・青33%・白53%）で抽選して'
    + `その色の未所持のものから均等に選び、性格25種を等確率とした場合（${arr}フレンドメダルによる金枠確定なし）に、`
    + 'この個体の無補正比以上になる推定確率です。「平均何匹に1匹」はその逆数（丸める前の確率から計算）です。'
    + '「性能値の順位」は、無補正比が異なる組み合わせの中での順位で、組み合わせごとの出やすさを考えないため、確率とは一致しません（参考値）。';
}

function refresh(engines) {
  renderHeader();
  renderRankNote();
  renderParams();
  renderIngs(engines);
  renderSlots();
  renderNat();
  if ($('subDlg').open) renderSubDlg();
  if ($('natDlg').open) renderNatDlg();
  heroTeam(null);
  ({ ingredient: renderIngStats, berry: renderBerryStats, skill: renderSkillStats })[state.type](engines[state.type]);
  renderBar(engines);
  renderLog(engines);
}
