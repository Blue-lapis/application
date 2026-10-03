// 厳選チェッカーの画面の動きを、2つのコード（変更前と変更後）で比べる。CI では実行しない（Playwright が要る）。
// 画面のコードを整理したとき（ver1.11 の ui.js の分割など）に、動きが変わっていないことを確かめる。
//
//   git worktree add /tmp/base main              # 変更前のコードを別の場所に出す
//   node tests/check-ui-browser.mjs /tmp/base    # 変更前（/tmp/base）と今のコード（.）を比べる
//   git worktree remove /tmp/base
//
// 未選択から始めて、タブ・ポケモン・入力・条件・詳細・レベル別・記録・削除と元に戻す・入力を消す・テーマを順に操作し、
// 操作のたびに次のものを記録して、2つのコードで一致することを確かめる。どちらもコンソールにエラーを出さないこと。
// - 操作の直後: お知らせ（元に戻す）の表示と文言
// - 分布の計算が終わってから（「…」「計算中」が消えてから）: body の HTML（お知らせを除く）・入力欄の値・
//   html の data-type・data-theme・タイトル・URL・localStorage
// 記録の時刻（Date.now）は決まった値にする。分布は事前計算のファイルを使わず、Worker で計算する。
// Playwright は NODE_PATH かグローバルのものを使う。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { extname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const load = () => {
  try { return require('playwright'); } catch { /* not local */ }
  return require(join(execSync('npm root -g').toString().trim(), 'playwright'));
};
const { chromium } = load();

const [before, after = '.'] = process.argv.slice(2);
if (!before) {
  console.error('使い方: node tests/check-ui-browser.mjs <変更前のディレクトリ> [変更後のディレクトリ（既定は .）]');
  process.exit(2);
}

const TYPE = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
// root のファイルを返すサーバー。checker/dist/ は返さない（どちらも Worker で計算する）。
function serve(root) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    try {
      if (path.startsWith('/checker/dist/')) throw new Error('no precomputed');
      const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
      if (!file.startsWith(root)) throw new Error('outside');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPE[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((ok) => server.listen(0, () => ok(server)));
}

// 操作の一覧。[名前, 操作]。
const mon = (key) => async (p) => { await p.click('#monBtn'); await p.click(`#monGrid button[data-v="${key}"]`); };
const subs = (ids) => async (p) => {
  await p.click('#slots .subslot');
  for (const id of ids) await p.click(`#subBody [data-v="${id}"]`);
  if (await p.evaluate(() => document.getElementById('subDlg').open)) await p.click('#subClose');
};
const nat = (name) => async (p) => { await p.click('#natBtn'); await p.click(`#natGrid [data-v="${name}"]`); };
const seg = (id, v) => async (p) => p.click(`#${id} button[data-v="${v}"]`);
const fill = (id, v) => async (p) => { await p.fill(`#${id}`, v); await p.dispatchEvent(`#${id}`, 'change'); };
const click = (sel) => async (p) => p.click(sel);
const STEPS = [
  ['開いた直後（未選択）', async () => {}],
  ['タブ: 食材', click('#tabs [data-type="ingredient"]')],
  ['タブ: スキル', click('#tabs [data-type="skill"]')],
  ['タブ: きのみ', click('#tabs [data-type="berry"]')],
  ['ポケモン: トドゼルガ', mon('walrein')],
  ['サブスキル5枠', subs(['berry', 'hb', 'spM', 'skS', 'invL'])],
  ['サブスキル: 外して入れ直す', async (p) => { await p.click('#slots .subslot'); await p.click('#subBody [data-v="hb"]'); await p.click('#subBody [data-v="ingM"]'); }],
  ['性格', nat('さみしがり')],
  ['レベル80', seg('lvSeg', '80')],
  ['受け取り: なし', seg('tapSeg', 'none')],
  ['チケット: なし', seg('campSeg', '0')],
  ['詳細を開く', click('#paramBtn')],
  ['回復量 ＋', click('#healAmtUp')],
  ['発動回数 −', click('#healTimesDown')],
  ['発動回数 4.5', fill('healTimes', '4.5')],
  ['フィールドボーナス 33', fill('fieldBonus', '33')],
  ['フィールドボーナス ＋', click('#bonusUp')],
  ['好きなきのみ', seg('favSeg', '1')],
  ['ヒーラーなし', seg('healSeg', '0')],
  ['詳細を閉じる', click('#paramClose')],
  ['レベル別を開く', click('#lvxHead')],
  ['レベル別: Lv.70', click('.lvx-row[data-v="70"]')],
  ['記録する', click('#save')],
  ['記録を開く', click('#logBtn')],
  ['記録: きのみに絞る', click('#logFilter [data-f="berry"]')],
  ['記録: Lv.60 で評価', click('#logLvSeg [data-v="60"]')],
  ['記録の行で戻す', click('#log li[data-k]')],
  ['タブ: 食材（未選択）', click('#tabs [data-type="ingredient"]')],
  ['ポケモン: フライゴン', mon('flygon')],
  ['狙い食材 B', click('#target .chip[data-v="B"]')],
  ['食材配列 Lv.30', click('#arr .chips[data-i="1"] .chip[data-v="1"]')],
  ['食材配列 Lv.60', click('#arr .chips[data-i="2"] .chip[data-v="0"]')],
  ['レベル60', seg('lvSeg', '60')],
  ['受け取り: 常にタップ', seg('ingTapSeg', 'always')],
  ['サブスキル3枠', subs(['spM', 'ingM', 'skS'])],
  ['性格（食材）', nat('ひかえめ')],
  ['記録する（食材）', click('#save')],
  ['タブ: スキル（未選択）', click('#tabs [data-type="skill"]')],
  ['ポケモン: ミュウツー', mon('mewtwo')],
  ['サブスキル5枠（スキル）', subs(['skM', 'hb', 'spS', 'skS', 'ingS'])],
  ['性格（スキル）', nat('おくびょう')],
  ['記録する（スキル）', click('#save')],
  ['記録を開く（すべて）', async (p) => { await p.click('#logBtn'); await p.click('#logFilter [data-f="all"]'); }],
  ['記録を削除', click('#log .del')],
  ['削除を元に戻す', click('#toastAct')],
  ['記録を閉じる', click('#logClose')],
  ['入力を消す', click('#reset')],
  ['消したのを元に戻す', click('#toastAct')],
  ['ほかのポケモンを選んで戻る', async (p) => { await mon('wigglytuff')(p); await mon('mewtwo')(p); }],
  ['テーマ: ライト', click('#themeBtn')],
  ['テーマ: ダーク', click('#themeBtn')],
];

// 計算が終わったか（main と開いているダイアログに「…」「計算中」がない）。
const settled = () => [document.querySelector('main'), document.getElementById('bar'), ...document.querySelectorAll('dialog[open]')]
  .every((el) => !/…|計算中/.test(el.textContent));
const snapshot = () => {
  const body = document.body.cloneNode(true);
  body.querySelector('#toast')?.remove();
  const values = [...document.querySelectorAll('input')].map((i) => `${i.id}=${i.type === 'checkbox' ? i.checked : i.value}`);
  const ls = Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]));
  const root = document.documentElement;
  return { html: body.innerHTML, values, type: root.dataset.type, theme: root.dataset.theme, title: document.title, url: location.search, ls };
};
const toastState = () => {
  const t = document.getElementById('toast');
  return t.hidden ? null : `${document.getElementById('toastMsg').textContent}／${document.getElementById('toastAct').textContent}`;
};

async function run(root) {
  const server = await serve(resolve(root));
  const { PASS_HASH } = await import(join(resolve(root), 'checker/js/auth.js'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((hash) => {
    localStorage.setItem('ckauth', hash);
    let t = 1.75e12;
    Date.now = () => (t += 1000);
  }, PASS_HASH);
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.setDefaultTimeout(10000);
  await page.goto(`http://localhost:${server.address().port}/checker/`);
  await page.waitForSelector('#themeBtn svg');
  const out = [];
  for (const [name, act] of STEPS) {
    await act(page);
    await page.waitForTimeout(300);
    const toast = await page.evaluate(toastState);
    // 「記録済」（1.2秒）が戻るのを待ってから、計算が終わるのを待つ。
    await page.waitForTimeout(1500);
    await page.waitForFunction(settled, null, { timeout: 180000, polling: 200 });
    out.push({ name, toast, ...(await page.evaluate(snapshot)) });
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  await browser.close();
  server.close();
  return { out, errors };
}

// 2つの文字列の最初に違うところの前後を出す。
const around = (a, b) => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `  変更前: …${a.slice(Math.max(0, i - 80), i + 120)}…\n  変更後: …${b.slice(Math.max(0, i - 80), i + 120)}…`;
};

const A = await run(before);
const B = await run(after);
let ng = 0;
for (const [label, r] of [['変更前', A], ['変更後', B]]) {
  if (r.errors.length) { ng++; console.log(`NG ${label}のコンソールのエラー:\n  ${r.errors.join('\n  ')}`); }
}
A.out.forEach((a, i) => {
  const b = B.out[i];
  for (const k of Object.keys(a)) {
    const x = JSON.stringify(a[k]), y = JSON.stringify(b[k]);
    if (x === y) continue;
    ng++;
    console.log(`NG ${i + 1}. ${a.name}: ${k} が違う`);
    console.log(around(x, y));
  }
});
console.log(ng ? `NG ${ng}件` : `OK ${STEPS.length}の操作で一致`);
process.exit(ng ? 1 : 0);
