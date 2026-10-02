// 育成日数シミュレーターの画面。入力が変わるたびに計算し直す（計算は数ミリ秒）。
import { requireLogin } from '../../checker/js/auth.js';
import { MONS as BERRY } from '../../checker/js/berry/mons.js';
import { MONS as ING } from '../../checker/js/ingredient/mons.js';
import { MONS as SKILL } from '../../checker/js/skill/mons.js';
import { initMonPicker, splitName, TYPE_LABELS } from '../../checker/js/monpick.js';
import { EXP_TYPE_OF, EXP_TYPES, MAX_LEVEL, candyExp } from './data.js';
import { plan, thresholds, gsdSchedule, sleepDay, useCandy } from './calc.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('ja-JP');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---- 状態と保存 ----
const KEY = 'expsim';
const DEFAULTS = { mon: '', expType: 600, nature: 'none', level: 10, toNext: null, target: 50, candy: 0, shardCap: null, score: 100, bonus: 0, incense: 'none', tickets: 0, start: '', gsd: {}, napMax: 14, boost: 'none', boostLimit: null };
let st = { ...DEFAULTS, gsd: {} };
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* storage unavailable */ }
if (!st.gsd || typeof st.gsd !== 'object' || Array.isArray(st.gsd)) st.gsd = {};
// 始める日は開くたびに今日にする（前の日付が残らないように）。
st.start = '';
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* storage unavailable */ } };

// ---- 日付 ----
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayOf = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const WD = '日月火水木金土';
const dateLabel = (day) => { const d = new Date(day * 864e5); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WD[d.getUTCDay()]}）`; };
const dur = (days) => {
  if (Number.isInteger(days)) return `${days}<span class="u">日</span>`;
  const m = Math.ceil(days * 1440), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return h ? `${d}<span class="u">日</span>${h}<span class="u">時間</span>` : `${d}<span class="u">日</span>`;
};

// ---- ポケモン（チェッカーの3タイプの最終進化形）。選ぶダイアログはチェッカーと共通 ----
const GROUPS = { berry: { ...TYPE_LABELS.berry, MONS: BERRY }, ingredient: { ...TYPE_LABELS.ingredient, MONS: ING }, skill: { ...TYPE_LABELS.skill, MONS: SKILL } };
const ALL_MONS = { ...BERRY, ...ING, ...SKILL };
const expOf = (key) => EXP_TYPE_OF[key] || 600;
const chev = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

function initMon() {
  const open = initMonPicker({
    groups: GROUPS,
    imgBase: '../checker/img/mon/',
    current: () => st.mon,
    onPick: (key) => { st.mon = key; st.expType = expOf(key); update(); },
  });
  $('monBtn').onclick = () => open('all', false);
  $('monClear').onclick = () => { $('monDlg').close(); st.mon = ''; update(); };
}

// ポケモンのカード（チェッカーと同じ形）。選んでいないときは経験値タイプだけ出す。
// タイプの色（きのみ=青・食材=緑・スキル=紫）をアクセントにする（チェッカーと同じ <html data-type>）。選んでいなければ食材の緑。
const groupOf = (key) => Object.keys(GROUPS).find((t) => Object.hasOwn(GROUPS[t].MONS, key)) || null;
function renderMon() {
  const m = ALL_MONS[st.mon];
  document.documentElement.dataset.type = (m && groupOf(st.mon)) || 'ingredient';
  $('typeRow').hidden = !!m;
  if (!m) {
    $('monBtn').innerHTML = `<span class="ph" aria-hidden="true">?</span><span class="mb"><small class="mt">経験値 ${st.expType}タイプ</small><b>ポケモンを選ぶ</b><span class="go">選ぶと経験値タイプが決まります${chev}</span></span>`;
    return;
  }
  const [base, form] = splitName(m.name);
  $('monBtn').innerHTML = `<img src="../checker/img/mon/${st.mon}.webp" alt="" width="92" height="92"><span class="mb">`
    + `<small class="mt">経験値 ${st.expType}タイプ</small>`
    + `<b>${esc(base)}${form ? `<small class="form">${esc(form)}</small>` : ''}</b>`
    + `<span class="go">ポケモンを変える${chev}</span></span>`;
}

// ---- 部品 ----
function seg(id, key, parse = (v) => v) {
  $(id).querySelectorAll('button').forEach((b) => {
    b.type = 'button';
    b.onclick = () => { st[key] = parse(b.dataset.v); update(); };
  });
}
const showSeg = (id, v) => $(id).querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));

// 数の入力。範囲外や小数のときは状態を変えない（入力中の値はそのまま残す）。empty を渡すと空欄をその値にする。
function num(id, key, { min = 0, max = Infinity, empty = undefined } = {}) {
  $(id).addEventListener('input', () => {
    const raw = $(id).value.trim();
    if (raw === '' && empty !== undefined) { st[key] = empty; update(false); return; }
    const v = Number(raw);
    if (!Number.isFinite(v) || v < min || v > max || !Number.isInteger(v)) return;
    st[key] = v;
    update(false);
  });
}

// ---- 表示 ----
const ROUTES = [['mix', '組み合わせ'], ['nap', '島のみ'], ['sleep', '睡眠のみ']];
const plain = (days) => dur(days).replace(/<[^>]+>/g, '');
const dateBig = (day) => dateLabel(day).replace(/（(.)）/, '<small>（$1）</small>');
let route = 'mix', planOpen = false; // 見ているタブと、予定をすべて出すか（保存しない）

function show(writeInputs) {
  const th = thresholds(st.expType);
  const span = th[st.level + 1] - th[st.level];
  if (writeInputs) {
    for (const k of ['level', 'target', 'candy', 'score', 'tickets']) $(k).value = st[k];
    $('toNext').value = st.toNext ?? span;
    $('shardCap').value = st.shardCap ?? '';
    $('napMax').value = st.napMax ?? '';
    $('boostLimit').value = st.boostLimit ?? '';
    $('start').value = st.start || todayStr();
  }
  $('toNext').max = span;
  renderMon();
  showSeg('typeSeg', st.expType);
  showSeg('natSeg', st.nature);
  showSeg('targetSeg', st.target);
  showSeg('incSeg', st.incense);
  showSeg('boostSeg', st.boost);
  $('boostLimitRow').hidden = st.boost === 'none';
  $('bonusVal').textContent = st.bonus;
  $('bonusDown').disabled = st.bonus <= 0;
  $('bonusUp').disabled = st.bonus >= 5;
  const startDay = dayOf(st.start || todayStr());
  // 見出しの横は、おひるね島の「1日150 EXP」と同じ形で、1個・1晩あたりのEXP。
  // アメは今のレベルでの1個（ブーストなら2倍）、睡眠はふつうの日の1晩（おこう・GSD なし）。
  $('candyHint').textContent = `1個 ${fmt(candyExp(st.level, st.nature) * (st.boost === 'none' ? 1 : 2))} EXP`;
  $('sleepHint').textContent = `1晩 ${fmt(sleepDay(-1e6, { score: st.score, bonus: st.bonus, incense: 'none', nature: st.nature, kindOf: () => 'normal' }).exp)} EXP`;

  if (!(st.level >= 1 && st.level < MAX_LEVEL && st.target > st.level && st.target <= MAX_LEVEL)) {
    $('lvFacts').hidden = true;
    $('rtabs').innerHTML = '';
    $('routeBody').innerHTML = '<p class="na">目標のレベルを今のレベルより上（70まで）にしてください。</p>';
    $('schedLine').textContent = `${dateLabel(startDay)}から`;
    setOut('目標のレベルを確かめてください', '—', '', null);
    return;
  }

  const p = plan({ ...st, toNext: st.toNext ?? span, startDay });
  // グッドスリープデーの日程は、一番遅いルートが届くまで（最低60日）を出す。
  const reach = p.routes ? Object.values(p.routes).filter(Boolean).map((r) => Math.ceil(r.days)) : [];
  const g = renderGsd(startDay, Math.max(60, ...reach));
  $('schedLine').textContent = `${dateLabel(startDay)}から・GSD ${g.count}回（${g.changed ? `${g.changed}回を直した` : '見込み'}）`;
  renderFacts(th, th[st.level] + span - (st.toNext ?? span), p.need);

  const c = p.candy;
  if (!p.routes) {
    $('planSec').hidden = true;
    setOut(`Lv.${st.target} に届く日`, '今日', `アメだけで届きます（あまるアメ ${fmt(st.candy - c.used)}個）`, c);
    return;
  }
  $('planSec').hidden = false;

  const R = p.routes;
  const ok = ROUTES.filter(([k]) => R[k]);
  const best = ok.length ? Math.min(...ok.map(([k]) => R[k].days)) : null;
  $('rtabs').innerHTML = ROUTES.map(([k, name]) => {
    const r = R[k], isBest = r && Math.abs(r.days - best) < 1e-9;
    return `<button type="button" role="tab" data-r="${k}" aria-selected="${k === route}" class="${isBest ? 'best' : ''}">${name}<small>${r ? plain(r.days) : '届かない'}</small></button>`;
  }).join('');

  const r = R[route];
  if (!r) {
    $('routeBody').innerHTML = `<p class="na">${route === 'sleep' && !st.score ? '睡眠スコアが0なので、睡眠EXPが入りません。' : '届きません（10年を超えます）。'}</p>`;
  } else {
    const notes = [`${dateLabel(startDay + Math.ceil(r.days))} ごろ`];
    if (st.incense !== 'none' && r.incense) notes.push(`おこう 約${Math.ceil(r.incense)}個`);
    if (r.tickets) notes.push(`チケット${r.tickets}枚`);
    const want = new Set([25, 30, 50, 60]);
    const ms = r.passed.filter((x) => want.has(x.level) && x.level < st.target && x.level > c.level);
    $('routeBody').innerHTML = `<p class="rnote">${notes.join(' ・ ')}</p>`
      + (ms.length ? `<p class="ms">${ms.map((x) => `<span>Lv.${x.level} <b>${dateLabel(startDay + Math.ceil(x.days))}</b></span>`).join('')}</p>` : '')
      + planList(r.blocks, startDay);
  }
  const bestKey = ok.find(([k]) => Math.abs(R[k].days - best) < 1e-9);
  if (bestKey) setOut(`Lv.${st.target} に届く日（最短は${bestKey[1]}）`, dateBig(startDay + Math.ceil(best)), `始める日から ${plain(best)}`, c);
  else setOut(`Lv.${st.target} に届く日`, '—', '届きません', c);
}

// 目標までのEXPと、アメだけで上げるときのアメ・ゆめのかけら（参考）。性格の補正は効かせ、手持ちの数・かけらの上限・アメブーストは見ない。
function renderFacts(th, cum, need) {
  const c = useCandy({ cum, th, target: st.target, nature: st.nature, candy: Infinity });
  const cell = (label, value) => `<div><small>${label}</small><b>${value}</b></div>`;
  $('lvFacts').innerHTML = cell('必要EXP', fmt(need))
    + cell('必要アメ数', `${fmt(c.used)}<span class="u">個</span>`)
    + cell('ゆめのかけら', fmt(c.shards));
  $('lvFacts').hidden = false;
}

// 結果のカードと下の帯。アメを使うときは、使う数・ゆめのかけらと、アメで届くレベルを出す。
function setOut(cap, date, sub, c) {
  $('oCap').textContent = cap;
  $('oDate').innerHTML = date;
  $('oSub').textContent = sub;
  $('oCandy').innerHTML = c && c.used
    ? `<div><small>使うアメ</small><b>${fmt(c.used)}<span class="u">個</span></b>${c.boosted ? `<small>${c.boosted === c.used ? 'すべてブースト' : `うちブースト ${fmt(c.boosted)}`}</small>` : ''}</div>`
      + `<div><small>ゆめのかけら</small><b>${fmt(c.shards)}</b></div><div><small>アメで</small><b>Lv.${c.level}</b></div>`
    : '';
  $('oCandy').hidden = !(c && c.used);
  $('bCap').textContent = cap;
  $('bDate').innerHTML = date;
  $('bCandy').textContent = c ? fmt(c.used) : '0';
  $('bShards').textContent = c ? fmt(c.shards) : '0';
}

// グッドスリープデーの日程の一覧。見込みから前後に MAX_SHIFT 日までずらすか、なしにできる。
const MAX_SHIFT = 3;
function renderGsd(startDay, days) {
  const list = gsdSchedule(startDay, startDay + days, st.gsd);
  const changed = list.filter((g) => g.off || g.shift).length;
  $('gsdSum').textContent = `${list.filter((g) => !g.off).length}回・${changed ? `${changed}回を直した` : 'すべて見込み'}`;
  const range = (f) => `${dateLabel(f - 1)}〜${dateLabel(f + 1)}`;
  $('gsdList').innerHTML = list.map((g) => {
    const cls = g.off ? 'off' : g.shift ? 'chg' : '';
    const label = g.off
      ? `<b>${range(g.est)}</b><small>なし（見込みの満月の日 ${dateLabel(g.est)}）</small>`
      : `<b>${range(g.full)}</b><small>満月の日 ${dateLabel(g.full)}${g.shift ? `（見込みから${g.shift > 0 ? '＋' : '−'}${Math.abs(g.shift)}日）` : ''}</small>`;
    const btns = g.off
      ? `<button type="button" data-est="${g.est}" data-a="on">戻す</button>`
      : `<button type="button" data-est="${g.est}" data-a="-1" aria-label="1日前にずらす"${g.shift <= -MAX_SHIFT ? ' disabled' : ''}>−1日</button>`
        + `<button type="button" data-est="${g.est}" data-a="1" aria-label="1日後にずらす"${g.shift >= MAX_SHIFT ? ' disabled' : ''}>＋1日</button>`
        + `<button type="button" data-est="${g.est}" data-a="off">なし</button>`;
    return `<li class="${cls}"><span class="gd">${label}</span><span class="gsd-act">${btns}</span></li>`;
  }).join('');
  return { count: list.filter((g) => !g.off).length, changed };
}
function initGsd() {
  $('gsdList').onclick = (e) => {
    const b = e.target.closest('button[data-est]');
    if (!b) return;
    const est = b.dataset.est, a = b.dataset.a;
    if (a === 'off') st.gsd[est] = 'off';
    else if (a === 'on') delete st.gsd[est];
    else {
      const v = (typeof st.gsd[est] === 'number' ? st.gsd[est] : 0) + Number(a);
      if (v === 0) delete st.gsd[est]; else st.gsd[est] = v;
    }
    update();
  };
  $('gsdReset').onclick = () => { st.gsd = {}; update(); };
}

// 予定の一覧（日付・何をするか・稼ぐEXP）。島は1回の預けごとに「1回目」「2回目」と出す。
// 長いときは最初の PLAN_SHOW 個だけ出し、「ほか○つを見る」で残りを出す。
const PLAN_SHOW = 4;
function planList(blocks, startDay) {
  let nth = 0;
  const rows = blocks.map((b) => {
    const d = dateLabel(startDay + b.from).replace(/（(.)）/, '<small>$1</small>'), len = plain(b.days);
    if (b.mode === 'sleep') {
      return `<li class="k-sleep"><span class="pd">${d}</span><span class="pm"><b>チームで寝る</b><small>その夜から ${b.days === 1 ? '1晩' : `${len}`}</small></span><span class="x">${fmt(b.exp)}</span></li>`;
    }
    const tags = [];
    if (b.ticketDays) tags.push(`<em class="t-tk">チケット${plain(b.ticketDays)}</em>`);
    if (b.eve) tags.push('<em>夕方に引き取って寝る</em>');
    if (b.half) tags.push(`<em class="t-half">7日未満で半分（${fmt(b.raw)}→）</em>`);
    return `<li class="k-nap"><span class="pd">${d}</span><span class="pm"><b>島に預ける <i>${++nth}回目</i></b><small>${len}${tags.join('')}</small></span><span class="x">${fmt(b.exp)}</span></li>`;
  });
  const hidden = rows.length - PLAN_SHOW;
  const shown = planOpen || hidden <= 0 ? rows : rows.slice(0, PLAN_SHOW);
  const more = hidden > 0 ? `<button type="button" class="planmore" id="planMore">${planOpen ? '最初の4つだけにする' : `ほか${hidden}つを見る`}</button>` : '';
  return `<ol class="plan-list" aria-label="予定（右は稼ぐEXP）">${shown.join('')}</ol>${more}`;
}

function update(writeInputs = true) {
  save();
  show(writeInputs);
}

// ---- 表示テーマ（チェッカーと同じ設定 cktheme） ----
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
  const showTheme = () => {
    const root = document.documentElement;
    if (cur === 'auto') delete root.dataset.theme; else root.dataset.theme = cur;
    $('themeBtn').innerHTML = THEME_ICON[cur];
    $('themeBtn').setAttribute('aria-label', `表示テーマ: ${THEME_LABEL[cur]}（押すと切り替え）`);
  };
  $('themeBtn').onclick = () => {
    cur = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    try { localStorage.setItem('cktheme', JSON.stringify(cur)); } catch { /* storage unavailable */ }
    showTheme();
  };
  showTheme();
}

requireLogin().then(() => {
  initTheme();
  initMon();
  initGsd();
  seg('typeSeg', 'expType', Number);
  seg('natSeg', 'nature');
  seg('incSeg', 'incense');
  seg('boostSeg', 'boost');
  seg('targetSeg', 'target', Number);
  $('bonusDown').onclick = () => { st.bonus = Math.max(0, st.bonus - 1); update(); };
  $('bonusUp').onclick = () => { st.bonus = Math.min(5, st.bonus + 1); update(); };
  // 今のレベルを変えたら「次のレベルまで」はそのレベルの必要量（貯まっていない）に戻す。
  $('level').addEventListener('input', () => { const v = Number($('level').value); if (Number.isInteger(v) && v >= 1 && v < MAX_LEVEL) { st.level = v; st.toNext = null; update(false); $('toNext').value = thresholds(st.expType)[v + 1] - thresholds(st.expType)[v]; } });
  num('toNext', 'toNext', { min: 1, empty: null });
  num('target', 'target', { min: 2, max: MAX_LEVEL });
  num('candy', 'candy', { max: 9999 });
  num('shardCap', 'shardCap', { empty: null });
  num('boostLimit', 'boostLimit', { max: 99999, empty: null });
  num('napMax', 'napMax', { min: 7, max: 365, empty: null });
  num('score', 'score', { max: 100 });
  num('tickets', 'tickets', { max: 99 });
  $('start').onchange = () => { st.start = $('start').value; update(); };
  $('rtabs').onclick = (e) => { const b = e.target.closest('button[data-r]'); if (b) { route = b.dataset.r; planOpen = false; show(false); } };
  $('routeBody').onclick = (e) => { if (e.target.closest('#planMore')) { planOpen = !planOpen; show(false); } };
  const dlg = $('schedDlg');
  $('schedTop').onclick = $('schedBtn').onclick = () => dlg.showModal();
  $('schedClose').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // 外側を押したら閉じる
  // 下の帯は、結果のカードが画面の外にあるときだけ出す（チェッカーと同じ）。
  new IntersectionObserver(([e]) => $('bar').classList.toggle('away', e.isIntersecting)).observe($('outSec'));
  if (!EXP_TYPES[st.expType]) st.expType = 600;
  if (!['none', 'mini', 'full'].includes(st.boost)) st.boost = 'none';
  if (st.mon && !ALL_MONS[st.mon]) st.mon = '';
  update();
});
