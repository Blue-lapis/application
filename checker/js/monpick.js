// ポケモンを選ぶダイアログ。厳選チェッカーと育成日数シミュレーター（exp/）で共通に使う。
// ページには monDlg・monQ・monFilter・monGrid・monNone・monClose の要素を置く（checker/index.html と同じ形）。
// groups は { タイプ: { label, short, MONS } }（並びは絞り込みのボタンの順）。計算のコードには依存しない。

// 3タイプの表示名。checker/js/types.js もこれを使う。
export const TYPE_LABELS = {
  berry: { label: 'きのみタイプ', short: 'きのみ' },
  ingredient: { label: '食材タイプ', short: '食材' },
  skill: { label: 'スキルタイプ', short: 'スキル' },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// 名前検索の正規化。全角半角・大文字小文字をそろえ、ひらがなはカタカナにする。
// loose はさらに濁点・半濁点と小さい字の違い、長音記号を無視する。
const SMALL = { ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ッ: 'ツ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ヮ: 'ワ' };
const norm = (s) => s.normalize('NFKC').toLowerCase().replace(/[\s・()（）]/g, '')
  .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const loose = (s) => norm(s).normalize('NFD').replace(/[゙゚]/g, '').normalize('NFC')
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
export const splitName = (name) => name.match(/^([^(]+)(?:\((.+)\))?$/).slice(1);

// ダイアログを用意して、開く関数を返す。imgBase はポケモンの画像のフォルダ（末尾の / まで）。
// current() は今選んでいるポケモンのキー、onPick(key) は選んだとき（ダイアログは閉じてから呼ぶ）。
export function initMonPicker({ groups, imgBase, current, onPick }) {
  const $ = (id) => document.getElementById(id);
  const src = (key) => `${imgBase}${key}.webp`;
  let filter = 'all';

  // タイプの絞り込み（すべて・きのみ・食材・スキル）と名前で探し、タイプごとの見出しの下に並べる。
  // 名前を入れたら一致の度合いの順に並べ、絞り込みのボタンにはそれぞれの件数を出す。
  function render() {
    const q = $('monQ').value.trim();
    const found = Object.fromEntries(Object.entries(groups).map(([t, d]) => {
      let list = Object.entries(d.MONS).map(([k, m], i) => ({ k, m, i, rank: 0 }));
      if (q) {
        list = list.map((x) => ({ ...x, rank: matchRank(q, x.m.name, x.k) })).filter((x) => x.rank !== null)
          .sort((a, b) => a.rank - b.rank || a.i - b.i);
      }
      return [t, list];
    }));
    const count = (t) => (t === 'all' ? Object.values(found).reduce((n, l) => n + l.length, 0) : found[t].length);
    $('monFilter').innerHTML = ['all', ...Object.keys(groups)].map((t) => `<button type="button" data-f="${t}" aria-pressed="${t === filter}">`
      + `${t === 'all' ? 'すべて' : `<i class="d-${t}"></i>${groups[t].short}`}${q ? `<small>${count(t)}</small>` : ''}</button>`).join('');
    const shown = (filter === 'all' ? Object.keys(groups) : [filter]).filter((t) => found[t].length);
    // Enter で選ぶ候補は、表示している中で一番よく一致するもの。
    const best = q ? shown.flatMap((t) => found[t]).reduce((a, x) => (!a || x.rank < a.rank ? x : a), null) : null;
    const cur = current();
    $('monGrid').innerHTML = shown.map((t) => `<h3 class="monsec"><i class="d-${t}"></i>${groups[t].label}<span>${found[t].length}</span></h3>`
      + `<div class="mongrid">${found[t].map(({ k, m }) => {
        const [base, form] = splitName(m.name);
        return `<button type="button" data-v="${k}" aria-pressed="${k === cur}"${best && best.k === k ? ' data-best' : ''}><img src="${src(k)}" alt="" width="56" height="56" loading="lazy">`
          + `<span>${esc(base)}</span>${form ? `<small>${esc(form)}</small>` : ''}</button>`;
      }).join('')}</div>`).join('');
    // 絞り込んだタイプにいなくても、ほかのタイプにいればそう伝える。
    const others = count('all');
    $('monNone').hidden = shown.length > 0;
    $('monNone').textContent = filter !== 'all' && others
      ? `${groups[filter].label}には見つかりませんでした（「すべて」で${others}匹）`
      : '見つかりませんでした';
  }

  const pick = (key) => { $('monDlg').close(); onPick(key); };
  $('monClose').onclick = () => $('monDlg').close();
  $('monDlg').addEventListener('click', (e) => { if (e.target === $('monDlg')) $('monDlg').close(); });
  $('monQ').addEventListener('input', render);
  // Enter で一番よく一致する候補を選ぶ（名前を入れていないときは一番上）。
  $('monQ').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const b = $('monGrid').querySelector('button[data-best]') || $('monGrid').querySelector('button');
    if (b) { e.preventDefault(); pick(b.dataset.v); }
  });
  $('monGrid').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(b.dataset.v); });
  $('monFilter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { filter = b.dataset.f; render(); } });

  // 絞り込み（'all' かタイプ）を決めて開く。focus なら、すぐ名前を入れられるようにする。
  return function open(startFilter = 'all', focus = false) {
    $('monQ').value = '';
    filter = startFilter;
    render();
    $('monDlg').showModal();
    $('monGrid').querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'center' });
    if (focus) $('monQ').focus();
  };
}
