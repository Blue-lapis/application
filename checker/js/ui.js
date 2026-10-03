// DOM 描画とイベント配線の入口。計算はタイプごとの calc.js のエンジンに委譲する。
// 画面は役割ごとに ui/ に分けてある（ver1.11）: common（小さな部品・お知らせ）・input（入力）・params（条件）・
// stats（結果）・log（記録）・dist（分布の依頼）。ここには初期化・ヘッダー・判定（レベル別と下の帯）・描き直し（refresh）を置く。
import { LEVELS } from '../../js/constants.js';
import { fmtPct } from '../../js/format.js';
import { TYPES } from './types.js';
import { targetLevel } from './ingredient/constants.js';
import { ingIcon } from './ingicons.js';
import { initMonPicker, splitName } from './monpick.js';
import { esc, CHEV, initTheme } from './dom.js';
import { natByName } from './picker.js';
import {
  state, monData, hasMon, saveDraft, loadSettings, setLevel, setLvOpen, setMon, setType, resetSelection,
  currentSubs, currentArr, slotCount, canRate, targetClosed, env, snapshotSelection, restoreSelection,
} from './state.js';
import { $, monSrc, def, withUnit, syncUrl, toast, hideToast, initToast } from './ui/common.js';
import { initInput, renderInput } from './ui/input.js';
import { initParams, renderParams } from './ui/params.js';
import { rowsHtml, renderStats, renderRankNote } from './ui/stats.js';
import { initLog, renderLog, logJobs } from './ui/log.js';
import { initDist, requestDist, isComputing } from './ui/dist.js';

// 記録・順位で使う、タイプごとのスコア（無補正比）。
const scoreOf = (engine, x, e) => (state.type === 'ingredient'
  ? engine.score(x.subs, x.up, x.down, x.arr, e)
  : engine.score(x.subs, x.up, x.down, e));

// 「何匹に1匹」。帯に収まるよう10万以上は万・億単位にする。
const fmtOdds = (n) => {
  if (n < 1e5) return withUnit(Math.round(n).toLocaleString(), '匹');
  if (n < 1e7) return withUnit((n / 1e4).toFixed(1), '万匹');
  if (n < 1e8) return withUnit(Math.round(n / 1e4).toLocaleString(), '万匹');
  return withUnit((n / 1e8).toFixed(1), '億匹');
};

// 帯の確率がまだ出ないときの表示。計算中なら「計算中」、読み込み中なら「…」。
const pendingText = () => (isComputing(state.type, env()) ? '計算中' : '…');

export function initUI(engines) {
  const redraw = () => refresh(engines);
  loadSettings();
  initDist(engines, { onChange: () => { renderBar(engines); renderLog(engines); }, extraJobs: logJobs });

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
  // カードから開いたときは今のタイプに、虫めがねから開いたときは「すべて」に絞り込んでおく（すぐ名前を入れられるようにする）。
  const openMon = initMonPicker({
    groups: TYPES,
    imgBase: 'img/mon/',
    current: () => state.mon,
    onPick: (key) => { hideToast(); setMon(key); syncUrl(); refresh(engines); },
  });
  $('monBtn').onclick = () => openMon(state.type);
  $('searchBtn').onclick = () => openMon('all', true);

  initParams({ refresh: redraw });
  $('lvxHead').onclick = () => { setLvOpen(!state.lvOpen); if (hasMon()) renderLvList(engines); };

  initInput({ refresh: redraw });
  initLog({ engines, refresh: redraw });

  // 消した入力は、しばらく「元に戻す」で戻せる。
  $('reset').onclick = () => {
    const snap = snapshotSelection();
    resetSelection();
    refresh(engines);
    window.scrollTo({ top: 0 });
    toast('入力を消しました', '元に戻す', () => { restoreSelection(snap); refresh(engines); });
  };

  initToast();

  initTheme($('themeBtn'));

  refresh(engines);
}

// 見出し・ポケモンの情報・性能の行の枠は、タイプとポケモンが変わったときだけ作り直す。
let shownHeader = null;
// 育成日数シミュレーターへのリンク。ポケモン・性格の EXP の補正（上昇・下降・なし）・評価のレベル（70まで）を渡す。
// 性格とレベルはポケモンを変えなくても変わるので、ヘッダーとは別に毎回作る。
function renderToExp() {
  const nat = natByName(state.nat), expNat = !nat || nat[1] === nat[2] ? 'none' : nat[1] === 'ex' ? 'up' : nat[2] === 'ex' ? 'down' : 'none';
  const expTarget = Math.min(state.lv, 70);
  $('toExp').href = `../exp/?${new URLSearchParams({ mon: state.mon, nature: expNat, target: expTarget })}`;
  $('toExpSub').textContent = `Lv.${expTarget} までの日数とアメ${expNat === 'none' ? '' : `（性格 EXP${expNat === 'up' ? '▲' : '▼'}）`}`;
}

function renderHeader() {
  const key = `${state.type}|${state.mon}`;
  if (key === shownHeader) return;
  shownHeader = key;
  const mm = monData(), d = def();
  document.title = `${mm.name} ${d.label} 厳選チェッカー`;
  renderTabs();
  showMonParts(true);
  // ポケモンのカード。カード全体が選ぶボタン。姿の名前は2行目に小さく出す。
  const [base, form] = splitName(mm.name);
  const note = state.type === 'berry' ? esc(mm.berry) : state.type === 'skill' ? `天井 ${d.ceilOf(mm)}回目` : '';
  $('monBtn').innerHTML = `<img src="${monSrc(state.mon)}" alt="" width="92" height="92"><span class="mb">`
    + `<small class="mt">${d.label}${note ? ` · ${note}` : ''}</small>`
    + `<b>${esc(base)}${form ? `<small class="form">${esc(form)}</small>` : ''}</b>`
    + `<span class="go">ポケモンを変える${CHEV}</span></span>`;
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
  // くわしい数値の枠（ui/stats.js）。
  $('rows').innerHTML = rowsHtml(state.type);
}

function renderTabs() {
  document.documentElement.dataset.type = state.type;
  $('tabs').querySelectorAll('[role="tab"]').forEach((b) => {
    const on = b.dataset.type === state.type;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
}
// ポケモンがないと意味のない部分（ポケモンの情報・育成日数へのリンク・入力・性能・レベル別の一覧・くわしい数値）。
// 食材配列の欄はタイプでも出し分けるので、出すときは renderHeader が決める。
const MON_PARTS = ['facts', 'monInfo', 'toExpCard', 'subSec', 'natSec', 'outSec', 'lvx', 'detailSec'];
function showMonParts(on) {
  MON_PARTS.forEach((id) => { $(id).hidden = !on; });
  if (!on) $('arrSec').hidden = true;
}
// ポケモン未選択の画面（育成シミュレーターの未選択と同じ形）。条件と記録は使えるが、判定・記録する・分布の計算はしない。
function renderEmpty(engines) {
  shownHeader = null;
  document.title = '厳選チェッカー';
  renderTabs();
  showMonParts(false);
  $('facts').innerHTML = '';
  $('monInfo').innerHTML = '';
  $('monBtn').innerHTML = `<span class="ph" aria-hidden="true">?</span><span class="mb"><small class="mt">${def().label}</small><b>ポケモンを選ぶ</b><span class="go">選ぶと判定できます${CHEV}</span></span>`;
  renderParams();
  ['bRatio', 'bRank', 'bOdds'].forEach((id) => { $(id).classList.add('dim'); $(id).textContent = '—'; });
  $('save').disabled = true;
  $('bWait').textContent = 'ポケモンを選ぶと判定できます';
  renderLog(engines);
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
// 帯の上の1行。何の確率かと、確率を出すのに足りない入力。
function barCaption() {
  const N = slotCount();
  // 狙い食材がまだ開いていない枠にしか出ないときは、入力をそろえても確率は出ないので先に伝える。
  if (targetClosed()) {
    const mm = monData();
    return `Lv.${state.lv}では${mm.short[state.target]}は出ません（Lv.${targetLevel(mm, state.target)}の枠で開きます）`;
  }
  const missing = [
    currentSubs().every(Boolean) ? '' : `サブスキル${N}枠`,
    state.up && state.down ? '' : '性格',
    currentArr().includes(null) ? '食材配列' : '',
  ].filter(Boolean);
  return missing.length ? `Lv.${state.lv}の確率は、${missing.join('・')}がそろうと出ます` : `Lv.${state.lv}・サブスキル${N}枠での確率`;
}

function renderBar(engines) {
  // 未選択の間に Worker から届いた分布では描き直さない（帯は renderEmpty が出す）。
  if (!hasMon()) return;
  renderLvList(engines);
  const ok = canRate();
  ['bRatio', 'bRank', 'bOdds'].forEach((id) => $(id).classList.toggle('dim', !ok));
  $('save').disabled = !ok;
  $('bWait').textContent = barCaption();
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
    requestDist();
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

// 入力の保存（saveDraft）はここで行う。入力を変える処理はすべて最後にここを通る。
function refresh(engines) {
  saveDraft();
  if (!hasMon()) {
    renderEmpty(engines);
    return;
  }
  renderHeader();
  renderToExp();
  renderRankNote();
  renderParams();
  renderInput();
  renderStats(engines[state.type]);
  renderBar(engines);
  renderLog(engines);
}
