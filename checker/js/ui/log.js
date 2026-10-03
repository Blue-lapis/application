// 記録（ver1.11 で ui.js から分けた）。記録する、記録のダイアログ（3タイプ・すべてのポケモンの一覧）、削除と元に戻す。
import { ingOpen, LEVELS } from '../../../js/constants.js';
import { fmtPct } from '../../../js/format.js';
import { TYPES } from '../types.js';
import { arrName, targetOpen } from '../ingredient/constants.js';
import { splitName } from '../monpick.js';
import { esc, icon } from '../dom.js';
import { subShort } from '../picker.js';
import {
  state, canRate, filledSubs, slotCount, envFor, targetOf, loadAllLogs, appendLog, removeLogEntry, restoreEntry, isCurrent,
  setMon, setTarget, setLevel,
} from '../state.js';
import { $, monSrc, syncUrl, toast, hideToast } from './common.js';
import { requestDist, isComputing } from './dist.js';

// 入力が変わったときの描き直し（ui.js の refresh）。initLog で受け取る。
let refresh = () => {};

// 記録の一覧。3タイプ・すべてのポケモンの記録を、ポケモンごとの見出しの下に並べる（表示中のポケモンが先頭、ほかは新しい記録のある順）。
// 「すべて / きのみ / 食材 / スキル」で切り替える。それぞれの記録は今のレベルで評価し、サブスキル（食材タイプは食材配列も）が
// 足りないときは、評価できる一番高いレベルで評価してそのレベルを添える。条件（チケット・ヒーラーなど）は今の設定を使う。
let logFilter = 'all';
// 一覧で確率を出すのに要る分布。一覧を開いている間に requestDist が1つずつ頼む。
let logNeeds = [];
const TRASH = icon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 18);

// 記録の一覧で要る分布（ui/dist.js の extraJobs）。一覧を開いている間だけ返す。
export const logJobs = () => ($('logDlg').open ? logNeeds : []);

export function initLog({ engines, refresh: redraw }) {
  refresh = redraw;
  // 記録は下の帯の「記録」からする。
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

  const openLog = () => { $('logDlg').showModal(); renderLog(engines); };
  $('logBtn').onclick = openLog;
  // 記録の一覧のレベル。メイン画面のレベル（条件の欄）と同じものを切り替える。
  $('logLvSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setLevel(+b.dataset.v);
    refresh();
  });
  $('logFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    logFilter = b.dataset.f;
    renderLog(engines);
  });
  $('logClose').onclick = () => $('logDlg').close();
  $('logDlg').addEventListener('click', (e) => { if (e.target === $('logDlg')) $('logDlg').close(); });
}

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
  // エナジーで評価するとき（state.ingBy）は狙い食材を使わないので、狙い食材がまだ出ないレベルでも評価する。
  if (x.type === 'ingredient' && state.ingBy !== 'energy' && !targetOpen(TYPES.ingredient.MONS[x.mon], lv, target)) return { lv, r: null, closed: true };
  const e = envFor(x.type, x.mon, lv, target, x.arr), engine = engines[x.type], N = slotCount(lv);
  const subs = x.subs.slice(0, N);
  const r = x.type === 'ingredient' ? engine.score(subs, x.up, x.down, x.arr, e) : engine.score(subs, x.up, x.down, e);
  const ready = engine.ready(e);
  return { lv, e, r, target, ready, ge: ready && r > 0 ? engine.atLeast(r, e) : null };
}

export function renderLog(engines) {
  const all = loadAllLogs();
  // アプリバーの記録ボタンに、記録の数（すべて）を出す。
  $('logCount').hidden = all.length === 0;
  $('logCount').textContent = all.length > 99 ? '99+' : String(all.length);
  $('logBtn').setAttribute('aria-label', `記録を開く（${all.length}件）`);
  // 評価するレベルのボタンは、メイン画面のレベルといつもそろえておく。
  $('logLvSeg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === state.lv)));
  // 閉じている間は一覧を作らない（入力のたびに全部の記録を評価しないため。開くときに openLog が描く）。
  // 今のポケモンのほかの条件・レベルの分布は requestDist が続けて頼むので、呼ぶのはやめない。
  if (!$('logDlg').open) {
    logNeeds = [];
    requestDist();
    return;
  }
  const rows = all.filter((x) => logFilter === 'all' || x.type === logFilter).map((x) => ({ ...x, ...rateLog(engines, x) }));
  logNeeds = rows.filter((x) => x.e && x.r > 0 && !x.ready).map((x) => ({ type: x.type, env: x.e }));
  requestDist();

  // 切り替えのボタン。それぞれの件数を添える。
  const n = (t) => all.filter((x) => t === 'all' || x.type === t).length;
  $('logFilter').innerHTML = ['all', ...Object.keys(TYPES)].map((t) => `<button type="button" data-f="${t}" aria-pressed="${t === logFilter}">`
    + `${t === 'all' ? 'すべて' : `<i class="d-${t}"></i>${TYPES[t].short}`}<small>${n(t)}</small></button>`).join('');


  // ポケモンごとにまとめる。
  const groups = new Map();
  rows.forEach((x) => {
    const k = `${x.type}|${x.mon}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  });
  const order = [...groups.entries()].map(([k, list]) => ({ k, list, cur: k === `${state.type}|${state.mon}`, last: Math.max(...list.map((x) => x.t)) }))
    .sort((a, b) => b.cur - a.cur || b.last - a.last);

  const pend = (x) => (isComputing(x.type, x.e) ? '計算中' : '…');
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
    : `<li class="empty">${all.length ? `${TYPES[logFilter]?.label ?? ''}の記録はまだありません` : 'まだ記録はありません。下の帯の「記録」で残せます'}</li>`;

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
      refresh();
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
  $('logNum').textContent = `${rows.length}件`;
}
