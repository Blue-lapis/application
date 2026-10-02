// 育成日数シミュレーターの画面。入力が変わるたびに計算し直す（計算は数ミリ秒）。
import { requireLogin } from '../../checker/js/auth.js';
import { MONS as BERRY } from '../../checker/js/berry/mons.js';
import { MONS as ING } from '../../checker/js/ingredient/mons.js';
import { MONS as SKILL } from '../../checker/js/skill/mons.js';
import { EXP_TYPE_OF, EXP_TYPES, MAX_LEVEL } from './data.js';
import { plan, thresholds, gsdSchedule } from './calc.js';

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

// ---- ポケモンの一覧（チェッカーの3タイプの最終進化形） ----
const MONLIST = Object.entries({ ...BERRY, ...ING, ...SKILL })
  .map(([key, m]) => ({ key, name: m.name, exp: EXP_TYPE_OF[key] || 600 }))
  .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

function initMon() {
  $('mon').innerHTML = '<option value="">（選ばない）</option>'
    + MONLIST.map((m) => `<option value="${m.key}">${esc(m.name)}${m.exp !== 600 ? `（${m.exp}）` : ''}</option>`).join('');
  $('mon').onchange = () => {
    st.mon = $('mon').value;
    const m = MONLIST.find((x) => x.key === st.mon);
    if (m) st.expType = m.exp;
    update();
  };
}

// ---- 部品 ----
function seg(id, key, parse = (v) => v) {
  $(id).querySelectorAll('button').forEach((b) => {
    b.type = 'button';
    b.onclick = () => { st[key] = parse(b.dataset.v); update(); };
  });
}
const showSeg = (id, v) => $(id).querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));

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
const BOOST_LABEL = { mini: 'ミニアメブースト', full: 'アメブースト' };
const INC_LABEL = { none: 'おこうなし', fullMoon: 'おこう: 満月の日', gsd: 'おこう: GSDの3日間', every2Days: 'おこう: 2日に1回', everyDay: 'おこう: 毎日' };
const plain = (days) => dur(days).replace(/<[^>]+>/g, '');
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
    $('mon').value = st.mon;
  }
  $('toNext').max = span;
  showSeg('typeSeg', st.expType);
  showSeg('natSeg', st.nature);
  showSeg('targetSeg', st.target);
  showSeg('incSeg', st.incense);
  showSeg('boostSeg', st.boost);
  $('boostLimitRow').hidden = st.boost === 'none';
  $('bonusVal').textContent = st.bonus;
  $('bonusDown').disabled = st.bonus <= 0;
  $('bonusUp').disabled = st.bonus >= 5;
  const m = MONLIST.find((x) => x.key === st.mon);
  $('monImg').hidden = !m;
  if (m) $('monImg').src = `../checker/img/mon/${m.key}.webp`;
  $('monName').textContent = m ? m.name : 'ポケモンを選ぶ';
  $('monType').textContent = `経験値 ${st.expType}タイプ`;

  if (!(st.level >= 1 && st.level < MAX_LEVEL && st.target > st.level && st.target <= MAX_LEVEL)) {
    $('needHint').textContent = '';
    $('rtabs').innerHTML = '';
    $('routeBody').innerHTML = '<p class="na">目標のレベルを今のレベルより上（70まで）にしてください。</p>';
    setBar('—', '', null);
    return;
  }

  const startDay = dayOf(st.start || todayStr());
  const p = plan({ ...st, toNext: st.toNext ?? span, startDay });
  // グッドスリープデーの日程は、一番遅いルートが届くまで（最低60日）を出す。
  const reach = p.routes ? Object.values(p.routes).filter(Boolean).map((r) => Math.ceil(r.days)) : [];
  const g = renderGsd(startDay, Math.max(60, ...reach));
  $('sumLine').textContent = `${st.boost !== 'none' ? `${BOOST_LABEL[st.boost]} ・ ` : ''}${INC_LABEL[st.incense]} ・ 島は${st.napMax ? `${st.napMax}日ごと` : '続けて'} ・ ${dateLabel(startDay)}から ・ GSD ${g.count}回（${g.changed ? `${g.changed}回を直した` : '見込み'}）`;
  $('needHint').textContent = `必要 ${fmt(p.need)}`;

  const c = p.candy;
  if (!p.routes) {
    $('rtabs').innerHTML = '';
    $('routeBody').innerHTML = `<p class="candy done">アメ ${fmt(c.used)}個${boostNote(c)}で Lv.${st.target} に届きます（あまるアメ ${fmt(st.candy - c.used)}個）。</p>`;
    setBar(`アメだけで Lv.${st.target} に届く`, '今日', c);
    return;
  }

  const R = p.routes;
  const ok = ROUTES.filter(([k]) => R[k]);
  const best = ok.length ? Math.min(...ok.map(([k]) => R[k].days)) : null;
  $('rtabs').innerHTML = ROUTES.map(([k, name]) => {
    const r = R[k], isBest = r && Math.abs(r.days - best) < 1e-9;
    return `<button type="button" role="tab" data-r="${k}" aria-selected="${k === route}" class="${isBest ? 'best' : ''}">${name}<small>${r ? plain(r.days) : '届かない'}</small></button>`;
  }).join('');

  const r = R[route];
  const candyLine = c.used ? `<p class="candy">先にアメを ${fmt(c.used)}個${boostNote(c)}使って Lv.${c.level} へ。残り ${fmt(p.goal - c.cum)} EXP を稼ぎます。</p>` : '';
  if (!r) {
    $('routeBody').innerHTML = `${candyLine}<p class="na">${route === 'sleep' && !st.score ? '睡眠スコアが0なので、睡眠EXPが入りません。' : '届きません（10年を超えます）。'}</p>`;
  } else {
    const notes = [`${dateLabel(startDay + Math.ceil(r.days))} ごろ`];
    if (st.incense !== 'none' && r.incense) notes.push(`おこう 約${Math.ceil(r.incense)}個`);
    if (r.tickets) notes.push(`チケット${r.tickets}枚`);
    const want = new Set([25, 30, 50, 60]);
    const ms = r.passed.filter((x) => want.has(x.level) && x.level < st.target && x.level > c.level);
    const blocks = r.blocks;
    $('routeBody').innerHTML = candyLine
      + `<p class="rnote">${notes.join(' ・ ')}</p>`
      + (ms.length ? `<p class="ms">${ms.map((x) => `<span>Lv.${x.level} <b>${dateLabel(startDay + Math.ceil(x.days))}</b></span>`).join('')}</p>` : '')
      + planList(blocks, startDay);
  }
  const bestKey = ok.find(([k]) => Math.abs(R[k].days - best) < 1e-9);
  setBar(bestKey ? `Lv.${st.target} に届く日（最短: ${bestKey[1]}）` : '届きません', bestKey ? `${dateLabel(startDay + Math.ceil(best)).replace(/（(.)）/, '<small>（$1）</small>')}<em>${plain(best)}</em>` : '—', c);
}

// アメブーストで使った個数（全部がブーストなら「すべてブースト」）。
const boostNote = (c) => (!c.boosted ? '' : c.boosted === c.used ? `（すべて${BOOST_LABEL[st.boost]}）` : `（うち${BOOST_LABEL[st.boost]} ${fmt(c.boosted)}個）`);

function setBar(cap, date, c) {
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
      ? `${range(g.est)}<small>なし（見込みの満月の日 ${dateLabel(g.est)}）</small>`
      : `${range(g.full)}<small>満月の日 ${dateLabel(g.full)}${g.shift ? `（見込みから${g.shift > 0 ? '＋' : '−'}${Math.abs(g.shift)}日）` : ''}</small>`;
    const btns = g.off
      ? `<button type="button" data-est="${g.est}" data-a="on">戻す</button>`
      : `<button type="button" data-est="${g.est}" data-a="-1" aria-label="1日前にずらす"${g.shift <= -MAX_SHIFT ? ' disabled' : ''}>−1日</button>`
        + `<button type="button" data-est="${g.est}" data-a="1" aria-label="1日後にずらす"${g.shift >= MAX_SHIFT ? ' disabled' : ''}>＋1日</button>`
        + `<button type="button" data-est="${g.est}" data-a="off">なし</button>`;
    return `<li class="${cls}"><span>${label}</span><div class="gsd-act">${btns}</div></li>`;
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

// 予定の一覧。島は1回の預けごとに「1回目」「2回目」と出す。長いときは最初の3つだけ出し、「ほか○つを見る」で残りを出す。
const PLAN_SHOW = 3;
function planList(blocks, startDay) {
  let nth = 0;
  const rows = blocks.map((b) => {
    const from = dateLabel(startDay + b.from).replace(/（.）/, ''), len = plain(b.days);
    if (b.mode === 'sleep') return `<li><span class="m m-sleep">チームで寝る</span><span>${from}の夜から ${len}</span><span class="x">${fmt(b.exp)}</span></li>`;
    const tags = [];
    if (b.ticketDays) tags.push(`チケット${plain(b.ticketDays)}`);
    if (b.eve) tags.push(`${len}目の夕方に引き取り、その夜から寝る`);
    if (b.half) tags.push(`7日未満で引き取る（貯まる ${fmt(b.raw)} → 半分）`);
    return `<li><span class="m m-nap">島 ${++nth}回目</span><span>${from}から ${len}${tags.length ? `<br><small>${tags.join('・')}</small>` : ''}</span><span class="x">${fmt(b.exp)}</span></li>`;
  });
  const hidden = rows.length - PLAN_SHOW;
  const shown = planOpen || hidden <= 0 ? rows : rows.slice(0, PLAN_SHOW);
  const more = hidden > 0 ? `<li class="more"><button type="button" id="planMore">${planOpen ? '最初の3つだけにする' : `ほか${hidden}つを見る ›`}</button></li>` : '';
  return `<ol class="plan-list" aria-label="予定（右は稼ぐEXP）">${shown.join('')}${more}</ol>`;
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
  $('bonusDown').onclick = () => { st.bonus = Math.max(0, st.bonus - 1); update(); };
  $('bonusUp').onclick = () => { st.bonus = Math.min(5, st.bonus + 1); update(); };
  $('targetSeg').querySelectorAll('button').forEach((b) => { b.type = 'button'; b.onclick = () => { st.target = Number(b.dataset.v); update(); }; });
  // 今のレベルを変えたら「次のレベルまで」はそのレベルの必要量（貯まっていない）に戻す。
  $('level').addEventListener('input', () => { const v = Number($('level').value); if (Number.isInteger(v) && v >= 1 && v < MAX_LEVEL) { st.level = v; st.toNext = null; update(false); $('toNext').value = thresholds(st.expType)[v + 1] - thresholds(st.expType)[v]; } });
  num('toNext', 'toNext', { min: 1, empty: null });
  num('target', 'target', { min: 2, max: MAX_LEVEL });
  num('candy', 'candy', { max: 9999 });
  num('shardCap', 'shardCap', { empty: null });
  num('napMax', 'napMax', { min: 7, max: 365, empty: null });
  num('boostLimit', 'boostLimit', { max: 99999, empty: null });
  num('score', 'score', { max: 100 });
  num('tickets', 'tickets', { max: 99 });
  $('start').onchange = () => { st.start = $('start').value; update(); };
  $('rtabs').onclick = (e) => { const b = e.target.closest('button[data-r]'); if (b) { route = b.dataset.r; planOpen = false; show(false); } };
  $('routeBody').onclick = (e) => { if (e.target.closest('#planMore')) { planOpen = !planOpen; show(false); } };
  const dlg = $('moreDlg');
  $('moreTop').onclick = $('moreBtn').onclick = () => dlg.showModal();
  $('moreClose').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // 外側を押したら閉じる
  if (!EXP_TYPES[st.expType]) st.expType = 600;
  if (!['none', 'mini', 'full'].includes(st.boost)) st.boost = 'none';
  update();
});
