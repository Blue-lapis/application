// 入力（ver1.11 で ui.js から分けた）。狙い食材・食材配列、サブスキルの枠とダイアログ、性格のボタンと表。
import { byId, UNLOCK, ingOpen, NAT, natsOf } from '../../../js/constants.js';
import { SLOT_LV, targetLevel, targetOpen } from '../ingredient/constants.js';
import { ingIcon } from '../ingicons.js';
import { SUB_FULL, subShort, GOLD, FAMILIES, NAT_AXES, natAt, natByName, axisLabel } from '../picker.js';
import { state, hasMon, monData, setTarget, setNature, natAllowed, slotCount, filledSubs } from '../state.js';
import { $, def } from './common.js';

// 入力が変わったときの描き直し（ui.js の refresh）。initInput で受け取る。
let refresh = () => {};

const chipHtml = (v, label, pressed, dis, cls) =>
  `<button class="chip ${cls || ''}" data-v="${v}" aria-pressed="${pressed}" ${dis ? 'disabled' : ''}>${label}</button>`;
// ダイアログの注記で使う、そのタイプの順位の基準。
const METRIC = { berry: 'きのみエナジー', ingredient: '食材の個数', skill: 'スキルの発動回数' };

function renderIngs() {
  if (state.type !== 'ingredient') return;
  const mm = monData();
  // 今のレベルでまだ出ない食材は押せなくして、出るレベルを添える。選んである食材はそのまま残す（レベルを戻せば評価できる）。
  $('target').innerHTML = Object.keys(mm.ings).map((k) => {
    const lock = state.target !== k && !targetOpen(mm, state.lv, k);
    return chipHtml(k, `${ingIcon(mm.ings[k])}${k} ${mm.short[k]}${lock ? `<small>Lv.${targetLevel(mm, k)}〜</small>` : ''}`, state.target === k, lock, lock ? 'lock' : '');
  }).join('');
  $('target').querySelectorAll('.chip').forEach((b) => {
    b.onclick = () => { setTarget(b.dataset.v); refresh(); };
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
      refresh();
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

export function initInput({ refresh: redraw }) {
  refresh = redraw;
  // 性格は背景（ダイアログの外側）をタップしても閉じる。
  $('natDlg').addEventListener('click', (e) => { if (e.target === $('natDlg')) $('natDlg').close(); });
  // サブスキルは続けて入れるので、Esc キーでも閉じない。
  $('subDlg').addEventListener('cancel', (e) => e.preventDefault());
  $('subClose').onclick = () => $('subDlg').close();
  $('natClose').onclick = () => $('natDlg').close();
  $('subClear').onclick = () => { state.subs = UNLOCK.map(() => null); subAt = 0; refresh(); };
  $('natClear').onclick = () => { setNature(null); $('natDlg').close(); refresh(); };
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
    refresh();
  });
  $('natGrid').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setNature(b.dataset.v);
    $('natDlg').close();
    refresh();
  });
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
      const name = natAt(up, down), ok = natAllowed(name);
      const cls = [up === down ? 'neutral' : '', on(up) || on(down) ? '' : 'off', ok ? '' : 'na'].join(' ');
      return `<button class="${cls}" data-v="${name}" aria-pressed="${state.nat === name}" ${ok ? '' : 'disabled'} aria-label="${name}（${up === down ? '無補正' : `▲${axisLabel(up)} ▼${axisLabel(down)}`}${ok ? '' : '・この姿には付かない'}）">${name}</button>`;
    }).join('')).join('');
  const labels = NAT_AXES.filter(([code]) => on(code)).map(([, l]) => l);
  // ストリンダーは姿ごとに付く性格が決まっているので、付かない性格は押せなくする。
  const nats = hasMon() ? natsOf(monData()) : NAT;
  const only = nats.length < NAT.length ? `${monData().name}に付く性格は${nats.length}種で、ほかの性格は選べません。` : '';
  $('natNote').textContent = `${only}${METRIC[state.type]}に効くのは ${labels.join(' と ')} の補正だけです。薄い色の性格は「無補正」と同じ結果になります。`;
}

// 入力の欄と、開いているダイアログを描き直す。
export function renderInput() {
  renderIngs();
  renderSlots();
  renderNat();
  if ($('subDlg').open) renderSubDlg();
  if ($('natDlg').open) renderNatDlg();
}
