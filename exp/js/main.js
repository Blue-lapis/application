// 育成日数シミュレーターの画面。入力が変わるたびに計算し直す（計算は数ミリ秒）。
import { requireLogin } from '../../checker/js/auth.js';
import { MONS as BERRY } from '../../checker/js/berry/mons.js';
import { MONS as ING } from '../../checker/js/ingredient/mons.js';
import { MONS as SKILL } from '../../checker/js/skill/mons.js';
import { EXP_TYPE_OF, EXP_TYPES, MAX_LEVEL } from './data.js';
import { plan, thresholds, upcomingMoon } from './calc.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('ja-JP');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---- 状態と保存 ----
const KEY = 'expsim';
const DEFAULTS = { mon: '', expType: 600, nature: 'none', level: 10, toNext: null, target: 50, candy: 0, shardCap: null, score: 100, bonus: 0, incense: 'none', tickets: 0, start: '' };
let st = { ...DEFAULTS };
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* storage unavailable */ }
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
function show(writeInputs) {
  const th = thresholds(st.expType);
  const span = th[st.level + 1] - th[st.level];
  if (writeInputs) {
    for (const k of ['level', 'target', 'candy', 'score', 'tickets']) $(k).value = st[k];
    $('toNext').value = st.toNext ?? span;
    $('shardCap').value = st.shardCap ?? '';
    $('start').value = st.start || todayStr();
    $('incense').value = st.incense;
    $('mon').value = st.mon;
  }
  $('toNext').max = span;
  showSeg('typeSeg', st.expType);
  showSeg('natSeg', st.nature);
  showSeg('bonusSeg', st.bonus);
  showSeg('targetSeg', st.target);
  $('monImg').hidden = !st.mon;
  if (st.mon) $('monImg').src = `../checker/img/mon/${st.mon}.webp`;

  if (!(st.level >= 1 && st.level < MAX_LEVEL && st.target > st.level && st.target <= MAX_LEVEL)) {
    $('needHint').textContent = '';
    $('candyOut').innerHTML = '<p class="na">目標のレベルを今のレベルより上（70まで）にしてください。</p>';
    $('routes').innerHTML = '';
    $('resHint').textContent = '';
    $('moonNote').textContent = '';
    return;
  }

  const startDay = dayOf(st.start || todayStr());
  const p = plan({ ...st, toNext: st.toNext ?? span, startDay });
  $('needHint').innerHTML = `必要EXP <b>${fmt(p.need)}</b>`;

  const c = p.candy;
  if (!p.routes) {
    $('candyOut').innerHTML = `<div class="candy done">アメだけで Lv.${st.target} に届きます。<br>アメ <b>${fmt(c.used)}</b>個・ゆめのかけら <b>${fmt(c.shards)}</b>（あまるアメ ${fmt(st.candy - c.used)}個）</div>`;
    $('routes').innerHTML = '';
    $('resHint').textContent = '';
    $('moonNote').textContent = '';
    return;
  }
  $('candyOut').innerHTML = c.used
    ? `<div class="candy">先にアメを <b>${fmt(c.used)}</b>個使って Lv.${c.level} へ（ゆめのかけら <b>${fmt(c.shards)}</b>）。<br>残り <b>${fmt(p.goal - c.cum)}</b> EXP を下のどれかで稼ぎます。</div>`
    : '';

  const R = p.routes;
  const days = Object.values(R).filter(Boolean).map((r) => r.days);
  const best = days.length ? Math.min(...days) : null;
  $('resHint').innerHTML = best != null ? `最短 <b>${dur(best).replace(/<[^>]+>/g, '')}</b>` : '';
  const milestones = (r) => {
    const want = new Set([25, 30, 50, 60, st.target]);
    const rows = r.passed.filter((x) => want.has(x.level) && x.level !== c.level);
    return rows.length ? `<dl class="rows">${rows.map((x) => `<dt>Lv.${x.level}</dt><dd>${dur(x.days).replace(/<[^>]+>/g, '')}（${dateLabel(startDay + Math.ceil(x.days))}）</dd>`).join('')}</dl>` : '';
  };
  const card = (title, r, body) => {
    if (!r) return `<div class="route"><div class="route-head"><h3>${title}</h3></div><p class="na">届きません（10年または島の上限1年を超えます）。</p></div>`;
    const isBest = Math.abs(r.days - best) < 1e-9;
    return `<div class="route${isBest ? ' best' : ''}"><div class="route-head"><h3>${title}</h3>${isBest ? '<span class="tag">最短</span>' : ''}</div>`
      + `<p class="days">${dur(r.days)}</p><p class="when">${dateLabel(startDay + Math.ceil(r.days))} ごろ</p>${body(r)}</div>`;
  };

  const incenseNote = (r) => (st.incense !== 'none' && r.incense ? `<p class="when">せいちょうのおこう 約${Math.ceil(r.incense)}個</p>` : '');
  $('routes').innerHTML = [
    card('睡眠のみ', R.sleep, (r) => incenseNote(r) + milestones(r)),
    card('おひるね島のみ', R.nap, (r) => `<p class="when">${r.half ? '7日未満で引き取る（EXPは半分）' : r.days === 7 ? '7日満喫してから引き取る' : '届いたら引き取る'}${r.tickets ? `・チケット${r.tickets}枚` : ''}</p>`),
    card('併用（週ごとに速いほう）', R.mix, (r) => incenseNote(r) + milestones(r) + planList(r, startDay)),
  ].join('');

  const moons = upcomingMoon(startDay, 31).filter((m) => m.kind === 'full').map((m) => dateLabel(m.day));
  $('moonNote').textContent = moons.length ? `満月（睡眠EXP 3倍）の見込み: ${moons.join('、')}。その前後の日がグッドスリープデー（2倍）。` : '';
}

function planList(r, startDay) {
  const items = r.blocks.map((b) => {
    const from = dateLabel(startDay + b.from), mode = b.mode === 'nap' ? '島' : '睡眠';
    const len = dur(b.days).replace(/<[^>]+>/g, '');
    const extra = b.mode === 'nap' ? `${b.ticket ? '・チケット' : ''}${b.half ? '・半分で引き取る' : ''}` : '';
    return `<li><span class="m-${b.mode}">${mode}</span> ${from}から${len}${b.exp ? `（${fmt(b.exp)} EXP）` : ''}${extra}</li>`;
  });
  return `<details class="plan"><summary>週ごとの予定（${r.blocks.length}週）</summary><ol>${items.join('')}</ol></details>`;
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
  seg('typeSeg', 'expType', Number);
  seg('natSeg', 'nature');
  seg('bonusSeg', 'bonus', Number);
  $('targetSeg').querySelectorAll('button').forEach((b) => { b.type = 'button'; b.onclick = () => { st.target = Number(b.dataset.v); update(); }; });
  // 今のレベルを変えたら「次のレベルまで」はそのレベルの必要量（貯まっていない）に戻す。
  $('level').addEventListener('input', () => { const v = Number($('level').value); if (Number.isInteger(v) && v >= 1 && v < MAX_LEVEL) { st.level = v; st.toNext = null; update(false); $('toNext').value = thresholds(st.expType)[v + 1] - thresholds(st.expType)[v]; } });
  num('toNext', 'toNext', { min: 1, empty: null });
  num('target', 'target', { min: 2, max: MAX_LEVEL });
  num('candy', 'candy', { max: 9999 });
  num('shardCap', 'shardCap', { empty: null });
  num('score', 'score', { max: 100 });
  num('tickets', 'tickets', { max: 99 });
  $('incense').onchange = () => { st.incense = $('incense').value; update(); };
  $('start').onchange = () => { st.start = $('start').value; update(); };
  if (!EXP_TYPES[st.expType]) st.expType = 600;
  update();
});
