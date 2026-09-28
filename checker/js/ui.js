// DOM 描画とイベント配線。計算はタイプごとの calc.js のエンジンに委譲する。
import { byId, UNLOCK, LEVEL } from '../../js/constants.js';
import { fmtPct, trunc, mmss } from '../../js/format.js';
import { eff } from '../../js/calc.js';
import { TYPES } from './types.js';
import { arrName, SLOT_LV } from './ingredient/constants.js';
import { slotsOf } from './ingredient/calc.js';
import { SUB_FULL, subShort, GOLD, FAMILIES, NAT_AXES, natAt, natByName, axisLabel } from './picker.js';
import {
  state, monData, loadSettings, setCamp, setG80, setMode, setMon, setType, setTarget, setNature, resetSelection,
  currentSubs, isComplete, env, loadLog, appendLog, removeLogEntry, restoreEntry, isCurrent,
} from './state.js';

const $ = (id) => document.getElementById(id);
const chipHtml = (v, label, pressed, dis, cls) =>
  `<button class="chip ${cls || ''}" data-v="${v}" aria-pressed="${pressed}" ${dis ? 'disabled' : ''}>${label}</button>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ALL_FLAGS = Object.keys(LEVEL).map(Number).flatMap((N) => [true, false].flatMap((camp) => [false, true].map((g80) => ({ N, camp, g80 }))));
const def = () => TYPES[state.type];
// 対象レベルの切り替えの名前。最後の枠が開くレベルまで（3枠なら「Lv.50まで」）。
const modeLabel = (N) => `Lv.${UNLOCK[N - 1]}まで`;
// ダイアログの注記で使う、そのタイプの順位の基準。
const METRIC = { berry: 'きのみエナジー', ingredient: '食材の個数', skill: 'スキルの発動回数' };

// 性能の行。'grp' は見出し行。
const ROWS = {
  ingredient: [
    ['grp', 'おてつだい'], ['rTime', 'おてつだい時間'], ['rCut', '時間の短縮'], ['rHelps', '1日のおてつだい回数'],
    ['grp', '食材'], ['rIng', '食材確率'], ['rAmt', '1回あたりの狙い食材'], ['rIngHelps', '1日の食材おてつだい回数'],
    ['rAllDay', '1日の全食材の個数'], ['rCap', '最大所持数'], ['rFull', '睡眠中に満タンになる確率'],
    ['grp', '無補正個体との比較'], ['rBase', '無補正個体の1日個数'], ['rDRatio', '1日の個数の比（順位の基準）'], ['rPos', '全パターン中の順位'],
  ],
  berry: [
    ['grp', 'おてつだい'], ['rTime', 'おてつだい時間'], ['rCut', '時間の短縮'], ['rHelps', '1日のおてつだい回数'],
    ['grp', 'きのみ'], ['rEnergy', 'きのみ1個のエナジー'], ['rAmt', '1回あたりのきのみ'], ['rCount', '1日のきのみの個数'],
    ['grp', '所持数'], ['rIng', '食材確率（満タンまで）'], ['rCap', '最大所持数'], ['rFull', '就寝時までに満タンになる確率'],
    ['rIngs', '1日に持ち帰る食材'],
    ['grp', '無補正個体との比較'], ['rBase', '無補正個体の1日エナジー'], ['rDRatio', '1日のエナジーの比（順位の基準）'], ['rPos', '全パターン中の順位'],
  ],
  skill: [
    ['grp', 'おてつだい'], ['rTime', 'おてつだい時間'], ['rCut', '時間の短縮'], ['rHelps', '1日のおてつだい回数'],
    ['rCap', '最大所持数'], ['rIng', '食材おてつだい確率'], ['rRoll', '睡眠中のスキル抽選'],
    ['grp', 'スキル'], ['rRate', 'スキル確率'], ['rEff', '天井込みの実質確率'], ['rAvg', '発動までの平均おてつだい'], ['rAvgT', '発動までの平均時間'],
    ['grp', '無補正個体との比較'], ['rBase', '無補正個体の1日回数'], ['rDRatio', '1日の回数の比（順位の基準）'], ['rPos', '全パターン中の順位'],
  ],
};

// 記録・順位で使う、タイプごとのスコア（無補正比）。
const scoreOf = (engine, x, e) => (state.type === 'ingredient'
  ? engine.score(x.subs, x.up, x.down, x.arr, e)
  : engine.score(x.subs, x.up, x.down, e));

// 全パターン中の順位。分布は無補正比の値ごとに1行なので、自分より高い値の数 + 1 が順位になる。
// 無補正比が同じ個体は同じ順位。分布ができてから呼ぶ。
function rankOf(engine, r, e) {
  const d = engine.dist(e);
  return { pos: 1 + d.filter((x) => x.r > r * (1 + 1e-7)).length, total: d.length };
}
// 数値に小さめの単位を付ける（帯とヒーローの大きな数字用）。
const withUnit = (v, u) => `${v}<span class="u">${u}</span>`;
// 「何匹に1匹」。帯に収まるよう10万以上は万・億単位にする。
const fmtOdds = (n) => {
  if (n < 1e5) return withUnit(Math.round(n).toLocaleString(), '匹');
  if (n < 1e7) return withUnit((n / 1e4).toFixed(1), '万匹');
  if (n < 1e8) return withUnit(Math.round(n / 1e4).toLocaleString(), '万匹');
  return withUnit((n / 1e8).toFixed(1), '億匹');
};
const fmtPos = ({ pos, total }) => `${pos.toLocaleString()}位 / ${total.toLocaleString()}`;

let worker = null;
let inFlight = null;
// 保存してなかったので計算している分布（タイプと条件の組）。読み込み中は「…」、計算中は「計算中」と出す。
const computing = new Set();
const jobKey = (type, e) => `${type}|${JSON.stringify(e)}`;
const pendingText = () => (computing.has(jobKey(state.type, env())) ? '計算中' : '…');

export function initUI(engines) {
  loadSettings();
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

  // 選んだポケモンを URL にも残して、ブックマークや共有で開けるようにする。
  const syncUrl = () => {
    try { history.replaceState(null, '', `?mon=${encodeURIComponent(state.mon)}`); } catch { /* history unavailable */ }
  };
  $('tabs').innerHTML = Object.entries(TYPES).map(([t, d]) =>
    `<button role="tab" id="tab-${t}" data-type="${t}">${d.label}<small>${Object.keys(d.MONS).length}匹</small></button>`).join('');
  $('tabs').querySelectorAll('[role="tab"]').forEach((b) => {
    b.onclick = () => { setType(b.dataset.type); syncUrl(); refresh(engines); window.scrollTo({ top: 0 }); };
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
  $('mon').onchange = (e) => { setMon(e.target.value); syncUrl(); refresh(engines); };

  $('camp').checked = state.camp;
  $('g80').checked = state.g80;
  $('camp').addEventListener('change', () => { setCamp($('camp').checked); refresh(engines); });
  $('g80').addEventListener('change', () => { setG80($('g80').checked); refresh(engines); });

  document.querySelectorAll('.mode button').forEach((b) => {
    b.onclick = () => { setMode(+b.dataset.n); refresh(engines); };
  });

  initDialogs(engines);

  $('save').onclick = () => {
    if (!isComplete()) return;
    const entry = { t: Date.now(), mon: state.mon, subs: currentSubs(), nat: state.nat, up: state.up, down: state.down };
    appendLog(state.type === 'ingredient' ? { ...entry, arr: [...state.arr] } : entry);
    renderLog(engines);
    $('save').textContent = '記録済';
    setTimeout(() => { $('save').textContent = '記録'; }, 1200);
  };

  $('reset').onclick = () => {
    resetSelection();
    refresh(engines);
    window.scrollTo({ top: 0 });
  };

  refresh(engines);
}

let shownType = null;

function renderHeader() {
  const mm = monData(), d = def();
  document.documentElement.dataset.type = state.type;
  document.title = `${mm.name} ${d.label} 厳選チェッカー`;
  $('tabs').querySelectorAll('[role="tab"]').forEach((b) => {
    const on = b.dataset.type === state.type;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  // ポケモンの一覧は今のタイプのものだけにする。
  if (shownType !== state.type) {
    shownType = state.type;
    $('mon').innerHTML = Object.entries(d.MONS).map(([k, m]) => `<option value="${k}">${esc(m.name)}</option>`).join('');
  }
  $('mon').value = state.mon;

  // 「キュウコン(アローラのすがた)」のような姿の名前は2行目に小さく出す。
  const [, base, form] = mm.name.match(/^([^(]+)(?:\((.+)\))?$/);
  $('monName').innerHTML = esc(base) + (form ? `<span class="form">${esc(form)}</span>` : '');
  $('typeName').textContent = `${d.label} 厳選チェッカー`;
  const fact = (label, value) => `<div><small>${label}</small><b>${value}</b></div>`;
  $('facts').innerHTML = fact('おてつだい', `${Math.floor(mm.time / 60)}:${String(mm.time % 60).padStart(2, '0')}`)
    + fact('食材確率', `${+(mm.ingP * 100).toFixed(1)}%`) + fact('最大所持数', mm.cap)
    + (state.type === 'berry' ? fact('きのみ', `×${mm.berries}`) : '')
    + (state.type === 'skill' ? fact('スキル確率', `${+(mm.skillP * 100).toFixed(1)}%`) : '');
  const ings = [...new Set(mm.slots.flat().map(([i]) => mm.ings[i]))].join('／');
  $('monInfo').textContent = state.type === 'berry' ? `${mm.berry}・食材 ${ings}`
    : state.type === 'skill' ? `スキル発動の天井 ${d.ceilOf(mm)}回・食材 ${ings}` : `食材 ${ings}`;
  $('arrSec').hidden = state.type !== 'ingredient';
  $('reset').textContent = state.type === 'ingredient' ? '食材配列・サブスキル・性格を消す' : 'サブスキル・性格を消す';
  $('rows').innerHTML = ROWS[state.type].map(([id, label]) => (id === 'grp'
    ? `<dt class="grp">${label}</dt><dd class="grp" style="display:none"></dd>`
    : `<dt>${label}</dt><dd id="${id}">—</dd>`)).join('');
}

function renderMode() {
  document.querySelectorAll('.mode button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.n === state.N)));
}

function renderIngs(engines) {
  if (state.type !== 'ingredient') return;
  const mm = monData();
  $('target').innerHTML = Object.keys(mm.ings).map((k) => chipHtml(k, `${k} ${mm.short[k]}`, state.target === k)).join('');
  $('target').querySelectorAll('.chip').forEach((b) => {
    b.onclick = () => { setTarget(b.dataset.v); refresh(engines); };
  });

  $('arr').innerHTML = mm.slots.map((opts, i) => `<div class="slot"><span>${SLOT_LV[i]}</span><div class="chips" data-i="${i}">${
    opts.map(([ing, a], k) => chipHtml(k, `${mm.short[ing]}×${a}`, state.arr[i] === k, opts.length === 1, ing === state.target ? 'tgt' : '')).join('')
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

// サブスキルはレベルの低い枠から順に入れる。手前の枠が空いている枠は選べない。
const reachable = (i) => currentSubs().slice(0, i).every(Boolean);
const firstEmpty = () => Math.max(0, currentSubs().findIndex((v) => !v));

// サブスキルの枠。タップすると、その枠を選ぶダイアログを開く。
function renderSlots() {
  $('slots').innerHTML = UNLOCK.slice(0, state.N).map((lv, i) => {
    const id = state.subs[i];
    return `<button class="subslot ${id ? rarityCls(id) : 'empty'}" data-i="${i}" aria-haspopup="dialog" ${reachable(i) ? '' : 'disabled'}><small>Lv.${lv}</small><span>${id ? SUB_FULL[id] || subShort(id) : '未選択'}</span></button>`;
  }).join('');
  $('slots').querySelectorAll('.subslot').forEach((b) => { b.onclick = () => openSub(+b.dataset.i); });
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

// ダイアログ。サブスキルは選ぶと次の空き枠へ進み、「閉じる」を押すまで開いたままにする。性格は選ぶと閉じる。
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
    const at = currentSubs().indexOf(id);
    if (at >= 0) {
      state.subs[at] = null;
      subAt = at;
    } else {
      state.subs[subAt] = id;
      // 次の枠が空いていれば進む。入れ直しのときはその枠に留まる。
      if (subAt + 1 < state.N && !state.subs[subAt + 1]) subAt += 1;
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

function openSub(i) {
  subAt = reachable(i) ? i : firstEmpty();
  renderSubDlg();
  $('subDlg').showModal();
}

function renderSubDlg() {
  if (subAt >= state.N || !reachable(subAt)) subAt = firstEmpty();
  const lvs = UNLOCK.slice(0, state.N);
  $('subTitle').textContent = `Lv.${lvs[subAt]} のサブスキルを選んでください`;
  $('subTabs').innerHTML = lvs.map((lv, i) => {
    const id = state.subs[i];
    return `<button class="${id ? `r-${byId[id].rarity}` : 'empty'}" data-i="${i}" aria-pressed="${i === subAt}" ${reachable(i) ? '' : 'disabled'}><small>Lv.${lv}</small><span>${id ? subShort(id) : '—'}</span></button>`;
  }).join('');

  // ほかの枠で選んでいるサブスキルには、その枠のレベルを付ける。押すとその枠から外れる。
  const usedAt = Object.fromEntries(currentSubs().map((id, i) => [id, lvs[i]]).filter(([id]) => id));
  const chip = (id, label, cls) => {
    const lv = usedAt[id], mine = state.subs[subAt] === id;
    return `<button class="pick ${rarityCls(id)} ${lv && !mine ? 'used' : ''} ${cls || ''}" data-v="${id}" aria-pressed="${mine}" aria-label="${SUB_FULL[id]}${lv ? `（Lv.${lv}で選択中・押すと外す）` : ''}">${label}${lv ? `<i>${lv}</i>` : ''}</button>`;
  };
  $('subBody').innerHTML = `<h3>金色サブスキル</h3><div class="gold">${GOLD.map((id) => chip(id, SUB_FULL[id])).join('')}</div>`
    + `<div class="fams">${FAMILIES.map(([label, sizes]) => `<div class="fam"><span>${label}</span><div>${sizes.map(([id, sz]) => chip(id, sz, 'sz')).join('')}</div></div>`).join('')}</div>`;
  $('subNote').textContent = `${METRIC[state.type]}に影響しないサブスキル（睡眠EXPボーナスなど）は、「なし他」として計算します。`;
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

const condText = (m, e) => `Lv.${LEVEL[state.N]}・睡眠8.5時間・${e.g80 ? 'げんき常時81%以上' : `起床時げんき${m.wake}から10分ごとに1減少（回復スキルなし）`}`;
const timeRows = (r, m, e) => {
  const Tm = Math.floor(r.Te / 60), Ts = Math.floor(r.Te % 60);
  $('rTime').innerHTML = `${Tm}分${String(Ts).padStart(2, '0')}秒<span>${e.camp ? 'チケット込み・' : ''}げんき補正前</span>`;
  const cut = (1 - m.timeMul) * 100;
  $('rCut').innerHTML = `${cut >= 0 ? '−' : '+'}${trunc(Math.abs(cut))}%<span>性格・サブスキル合計</span>`;
  $('rHelps').innerHTML = `${(r.Ha + r.Hs).toFixed(1)}回<span>日中${r.Ha.toFixed(1)}回・睡眠中${r.Hs.toFixed(1)}回</span>`;
};

const ARR_STATS = ['hAll', 'hDay', 'hNight', 'rAmt', 'rAllDay', 'rFull'];

// 結果カードの横棒。日中と睡眠中の割合を幅で見せる（値がないときは空）。
const setSplit = (day, night) => {
  const all = day + night;
  $('hSplit').style.width = all > 0 ? `${(day / all) * 100}%` : '0';
};

// 未選択のサブスキル・性格は「なし他」・無補正として計算する。
function renderIngStats(engine) {
  const e = env(), mm = monData();
  const m = def().mults(currentSubs(), state.up, state.down);
  $('cond').textContent = `${condText(m, e)}・日中は常時タップで計算`;
  $('hLabel').textContent = `1日の${mm.short[state.target]}`;

  const ref = engine.reference(e);
  $('rBase').innerHTML = `${ref.v.toFixed(1)}個<span>${arrName(mm, ref.arr)}・無補正</span>`;

  // 食材配列が決まるまでは、無補正基準の配列で時間・確率などを表示する。
  const arrOk = !state.arr.includes(null);
  const r = engine.daily(m, arrOk ? state.arr : ref.arr, e);
  timeRows(r, m, e);
  $('rIng').innerHTML = `${(r.ingP * 100).toFixed(1)}%<span>基礎${+(mm.ingP * 100).toFixed(2)}% × ${m.ingMul.toFixed(3)}</span>`;
  $('rIngHelps').innerHTML = `${((r.Ha + r.Hs) * r.ingP).toFixed(1)}回<span>所持数あふれを除く</span>`;
  $('rCap').innerHTML = `${r.cap}個<span>${e.camp ? 'チケット込み・' : ''}きのみ${m.berry}個</span>`;

  if (!arrOk) {
    ARR_STATS.forEach((id) => { $(id).textContent = '—'; });
    setSplit(0, 0);
    $('rDRatio').textContent = '—';
    return;
  }
  const slots = slotsOf(mm, state.arr);
  const total = r.day + r.night;
  const tAmt = slots.reduce((s, [ing, a]) => s + (ing === state.target ? a : 0), 0) / slots.length;
  const allAmt = slots.reduce((s, [, a]) => s + a, 0) / slots.length;
  $('hAll').innerHTML = withUnit(total.toFixed(1), '個');
  $('hDay').textContent = r.day.toFixed(1);
  $('hNight').textContent = r.night.toFixed(1);
  setSplit(r.day, r.night);
  $('rAmt').innerHTML = `${tAmt.toFixed(2)}個<span>全食材${allAmt.toFixed(2)}個</span>`;
  $('rAllDay').innerHTML = `${(r.dayAll + r.nightAll).toFixed(1)}個<span>日中${r.dayAll.toFixed(1)}個・睡眠中${r.nightAll.toFixed(1)}個</span>`;
  $('rFull').innerHTML = `${(r.full * 100).toFixed(1)}%<span>あふれた食材 平均${r.lost.toFixed(1)}個</span>`;
  $('rDRatio').textContent = isComplete() ? `${(total / ref.v).toFixed(2)}倍` : '—';
}

function renderBerryStats(engine) {
  const e = env(), mm = monData();
  const m = def().mults(currentSubs(), state.up, state.down);
  $('cond').textContent = `${condText(m, e)}・起床時に回収して日中はタップしない（いつのまに育成）・食材配列は全パターンの平均で計算`;
  $('hLabel').textContent = '1日のきのみエナジー';

  const base = engine.baseMetric(e);
  const r = engine.daily(m, e);
  const count = r.day + r.night;
  const total = count * r.energy;
  $('hAll').textContent = Math.round(total).toLocaleString();
  $('hDay').textContent = Math.round(r.day * r.energy).toLocaleString();
  $('hNight').textContent = Math.round(r.night * r.energy).toLocaleString();
  setSplit(r.day, r.night);

  timeRows(r, m, e);
  $('rEnergy').innerHTML = `${r.energy}<span>${mm.berry} Lv.${r.LV}</span>`;
  $('rAmt').innerHTML = `${r.berry}個<span>${m.berry ? `基礎${mm.berries}個＋きのみの数S` : 'きのみタイプ'}</span>`;
  $('rCount').innerHTML = `${count.toFixed(1)}個<span>日中${r.day.toFixed(1)}個・睡眠中${r.night.toFixed(1)}個</span>`;
  $('rIng').innerHTML = `${(r.ingP * 100).toFixed(1)}%<span>基礎${+(mm.ingP * 100).toFixed(2)}% × ${m.ingMul.toFixed(3)}</span>`;
  $('rCap').innerHTML = `${r.cap}個<span>${e.camp ? 'チケット込み' : '基礎＋サブスキル'}</span>`;
  $('rFull').innerHTML = `${(r.fullBed * 100).toFixed(1)}%<span>起床時まで${(r.full * 100).toFixed(1)}%</span>`;
  $('rIngs').innerHTML = `${r.ings.toFixed(1)}個<span>満タンになるまで</span>`;
  $('rBase').innerHTML = `${Math.round(base).toLocaleString()}<span>無補正</span>`;
  $('rDRatio').textContent = isComplete() ? `${(total / base).toFixed(2)}倍` : '—';
}

function renderSkillStats(engine) {
  const e = env(), mm = monData();
  const m = def().mults(currentSubs(), state.up, state.down);
  $('cond').textContent = `${condText(m, e)}・日中は常時タップ・食材配列は全パターンの平均で計算`;
  $('hLabel').textContent = '1日の期待発動回数';

  const base = engine.baseMetric(e);
  const r = engine.daily(m, e);
  const total = r.day + r.night;
  const p = eff(r.p, r.ceil);
  const avgHelps = 1 / p;
  $('hAll').innerHTML = withUnit(total.toFixed(2), '回');
  $('hDay').textContent = r.day.toFixed(2);
  $('hNight').textContent = r.night.toFixed(2);
  setSplit(r.day, r.night);

  timeRows(r, m, e);
  $('rCap').innerHTML = `${r.cap}個<span>${e.camp ? 'チケット込み（×1.2切り上げ）' : '基礎＋サブスキル'}</span>`;
  $('rIng').innerHTML = `${(r.ingP * 100).toFixed(1)}%<span>基礎${+(mm.ingP * 100).toFixed(2)}% × ${m.ingMul.toFixed(3)}・きのみ${m.berry}個</span>`;
  $('rRoll').innerHTML = `${r.rolls.toFixed(1)}回<span>睡眠中${r.Hs.toFixed(1)}回のうち・満タン確率${(r.full * 100).toFixed(1)}%</span>`;
  $('rRate').innerHTML = `${(r.p * 100).toFixed(2)}%<span>基礎${+(mm.skillP * 100).toFixed(2)}% × ${m.skillMul.toFixed(3)}</span>`;
  $('rEff').innerHTML = `${(p * 100).toFixed(2)}%<span>${r.ceil}回目で確定を含む平均</span>`;
  $('rAvg').textContent = `${avgHelps.toFixed(1)}回`;
  $('rAvgT').innerHTML = `${mmss(avgHelps * r.Te * 0.45)}<span>げんき81%以上のとき</span>`;
  $('rBase').innerHTML = `${base.toFixed(2)}回<span>無補正</span>`;
  $('rDRatio').textContent = isComplete() ? `${(total / base).toFixed(2)}倍` : '—';
}

// One job at a time so a switch to a new condition waits behind at most one background job.
function requestDist(engines) {
  if (inFlight) return;
  const type = state.type, engine = engines[type];
  const cur = env();
  const next = [cur, ...ALL_FLAGS.map((f) => ({ ...cur, ...f }))].find((e) => !engine.ready(e));
  if (!next) return;
  inFlight = next;
  worker.postMessage({ type, env: next });
}

function renderBar(engines) {
  const ok = isComplete();
  ['bRatio', 'bRank', 'bOdds'].forEach((id) => $(id).classList.toggle('dim', !ok));
  $('save').disabled = !ok;
  const setPos = (bar, row) => { $('bPos').textContent = bar; if ($('rPos')) $('rPos').innerHTML = row; };
  if (!ok) {
    ['bRatio', 'bRank', 'bOdds'].forEach((id) => { $(id).textContent = '—'; });
    setPos('', '—');
    return;
  }
  const e = env(), engine = engines[state.type];
  const r = scoreOf(engine, { subs: currentSubs(), up: state.up, down: state.down, arr: state.arr }, e);
  $('bRatio').innerHTML = withUnit(r.toFixed(2), '倍');
  if (!engine.ready(e)) {
    $('bRank').textContent = pendingText();
    $('bOdds').textContent = '…';
    setPos('', pendingText());
    requestDist(engines);
    return;
  }
  const ge = engine.atLeast(r, e);
  $('bRank').innerHTML = r > 0 ? withUnit(fmtPct(ge).slice(0, -1), '%') : '—';
  $('bOdds').innerHTML = r > 0 ? fmtOdds(1 / ge) : '—';
  const rk = rankOf(engine, r, e);
  setPos(fmtPos(rk), `${rk.pos.toLocaleString()}位<span>${rk.total.toLocaleString()}パターン中（無補正比が同じものは同順位）</span>`);
}

function renderLog(engines) {
  const e = env(), mm = monData(), engine = engines[state.type], { NATL } = def();
  const rd = engine.ready(e);
  requestDist(engines);
  const L = loadLog()
    .filter((x) => x.subs.length === state.N)
    .map((x) => ({ ...x, r: scoreOf(engine, x, e) }))
    .sort((a, b) => b.r - a.r);

  $('log').innerHTML = L.length
    ? L.map((x) => {
      const detail = `${state.type === 'ingredient' ? `${arrName(mm, x.arr)}　` : ''}${x.subs.map(subShort).join('／')}　${x.nat ? `${esc(x.nat)} ` : ''}▲${NATL[x.up]} ▼${NATL[x.down]}`;
      // Entries saved before the memo prompt was removed keep their memo as the heading.
      const cur = isCurrent(x);
      return `<li class="${cur ? 'cur' : ''}" data-t="${x.t}" tabindex="0" title="タップで入力に戻す" aria-current="${cur}"><div>${cur ? '<span class="now">表示中</span>' : ''}${x.memo ? `${esc(x.memo)}<div class="m">${detail}</div>` : detail}</div><div><b>${x.r.toFixed(2)}倍</b><div class="m">${rd ? (x.r > 0 ? `上位${fmtPct(engine.atLeast(x.r, e))}<br>${fmtPos(rankOf(engine, x.r, e))}` : '—') : pendingText()}</div></div><button class="del" data-t="${x.t}">削除</button></li>`;
    }).join('')
    : `<li class="empty">${modeLabel(state.N)}の記録はまだありません</li>`;

  // 行をタップすると、その個体を入力に戻して今の入力と見比べられるようにする。削除ボタンは除く。
  const byT = Object.fromEntries(L.map((x) => [String(x.t), x]));
  $('log').querySelectorAll('li[data-t]').forEach((li) => {
    const restore = () => { restoreEntry(byT[li.dataset.t]); refresh(engines); };
    li.onclick = (ev) => { if (!ev.target.closest('.del')) restore(); };
    li.onkeydown = (ev) => {
      if (ev.target === li && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); restore(); }
    };
  });
  $('log').querySelectorAll('.del').forEach((b) => {
    b.onclick = () => { removeLogEntry(b.dataset.t); renderLog(engines); };
  });
}

function refresh(engines) {
  renderHeader();
  renderMode();
  renderIngs(engines);
  renderSlots();
  renderNat();
  if ($('subDlg').open) renderSubDlg();
  if ($('natDlg').open) renderNatDlg();
  ({ ingredient: renderIngStats, berry: renderBerryStats, skill: renderSkillStats })[state.type](engines[state.type]);
  renderBar(engines);
  renderLog(engines);
}
