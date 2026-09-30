// 事前計算の分布（ver1.9）をヘッドレス Chromium で確かめる。CI では実行しない（Playwright が要る）。
// 先に `node scripts/precompute-dist.mjs` で checker/dist/ を作り、リポジトリ直下で
// `node tests/check-precomputed-browser.mjs` を実行する。Playwright は NODE_PATH かグローバルのものを使う。
// - ブラウザの計算（Chromium の V8）で作った分布と、ファイルから戻した分布がビットまで一致する（抜き取り）。
// - 画面（スマートフォンの幅）: 既定の条件は「計算中」を出さずに事前計算から表示する。範囲外の条件、
//   404・壊れたファイルのときは今までどおり計算する。どれもコンソールにエラーを出さない（404 の読み込みエラーを除く）。
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

const root = resolve('.');
const TYPE = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.gz': 'application/gzip', '.json': 'application/json' };
// GitHub Pages と同じく、.gz は Content-Encoding を付けずにそのまま返す。
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/__blank.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8">'); return; }
  try {
    const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(root)) throw new Error('outside');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPE[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(0);
const base = `http://localhost:${server.address().port}`;

let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('NG', msg); } };
const browser = await chromium.launch();
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };

// 1. ブラウザで計算した分布との一致。
{
  const page = await browser.newPage();
  await page.goto(`${base}/__blank.html`);
  const res = await page.evaluate(async () => {
    const { TYPES } = await import('/checker/js/types.js');
    const { clearCaches } = await import('/checker/js/engine.js');
    const { preEnvs, fetchDist } = await import('/checker/js/precomputed.js');
    const jobs = preEnvs();
    // タイプ × レベルごとに、チケットあり・なしを1件ずつと、30件ごとに1件。
    const seen = new Set();
    const sample = jobs.filter((j, i) => {
      const k = `${j.type}|${j.env.lv}|${j.env.camp}`;
      const first = !seen.has(k);
      seen.add(k);
      return first || i % 30 === 0;
    });
    const bad = [];
    let rows = 0;
    for (const { type, env } of sample) {
      const got = await fetchDist(type, env);
      const want = TYPES[type].createEngine().dist(env);
      clearCaches();
      rows += want.length;
      let maxRel = 0;
      const ok = got && got.length === want.length && want.every((x, i) => {
        maxRel = Math.max(maxRel, Math.abs(x.p - got[i].p) / x.p || 0, Math.abs(x.r - got[i].r) / x.r || 0);
        return Object.is(x.r, got[i].r) && Object.is(x.p, got[i].p);
      });
      if (!ok) bad.push({ type, env, rows: [got?.length, want.length], maxRel });
    }
    return { n: sample.length, rows, bad };
  });
  console.log(`ブラウザの計算と照合 ${res.n}件（${res.rows.toLocaleString()}行）`);
  res.bad.forEach((b) => check(false, `ブラウザの計算と一致しない ${JSON.stringify(b)}`));
  await page.close();
}

// 2. 画面。Worker のメッセージを記録して、計算したか・事前計算から読んだかを見る。
async function open(name, { settings = {}, route, mon = 'flygon' } = {}) {
  const ctx = await browser.newContext(PHONE);
  const errors = [], gz = [];
  await ctx.addInitScript((settings) => {
    // ログインを済ませ、設定を入れておく。
    localStorage.setItem('ckauth', 'pbkdf2$600000$DioWOlYDbOlRsjyqxcl/IQ==$Lv6pjODmyB1uNO/YxKOxXSzgRRIWE/mPQU/QdgWgWtw=');
    for (const [k, v] of Object.entries(settings)) localStorage.setItem(k, JSON.stringify(v));
    window.__log = [];
    const W = window.Worker;
    window.Worker = class extends W {
      postMessage(m) {
        window.__log.push({ t: performance.now(), post: true, camp: m.env.camp });
        super.postMessage(m);
      }
      set onmessage(f) {
        super.onmessage = (ev) => {
          window.__log.push({ t: performance.now(), computing: !!ev.data.computing, dist: !!ev.data.dist, camp: ev.data.env.camp });
          f(ev);
        };
      }
    };
  }, settings);
  // 外部（Google Fonts）は、環境によって届かないので空で返す。
  await ctx.route((url) => url.hostname !== 'localhost', (r) => r.fulfill({ status: 200, body: '' }));
  if (route) await ctx.route('**/*.json.gz*', route);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.url().includes('.json.gz')) gz.push(r.status()); });
  const t0 = Date.now();
  await page.goto(`${base}/checker/?mon=${mon}`);
  // 今の条件とチケットを切り替えた条件の2つがそろうまで待つ。
  await page.waitForFunction(() => window.__log.filter((x) => x.dist).length >= 2, null, { timeout: 60000 });
  const log = await page.evaluate(() => window.__log);
  // Worker に頼んでから、その条件の分布が届くまで（今の条件とチケットを切り替えた条件）。
  const waits = log.filter((x) => x.post).map((p) => Math.round(log.find((x) => x.dist && x.camp === p.camp && x.t >= p.t).t - p.t));
  const r = { name, computing: log.filter((x) => x.computing).length, waits, gz, errors };
  console.log(`${name}: 計算 ${r.computing}回、頼んでから届くまで ${waits.join('ms・')}ms（読み込みから ${Date.now() - t0}ms）、.json.gz ${JSON.stringify(gz)}、エラー ${errors.length}件`);
  await ctx.close();
  return r;
}

const def = await open('既定の条件');
check(def.computing === 0, '既定の条件で計算した');
check(def.gz.length === 2 && def.gz.every((s) => s === 200), `既定の条件で事前計算を2つ読んでいない ${JSON.stringify(def.gz)}`);
check(!def.errors.length, `既定の条件でエラー ${def.errors.join(' / ')}`);

const out = await open('範囲外（発動回数3）', { settings: { ckhealtimes: 3 } });
check(out.computing === 2, `範囲外の条件で計算していない（${out.computing}回）`);
check(out.gz.length === 0, `範囲外の条件でファイルを取りに行った ${JSON.stringify(out.gz)}`);
check(!out.errors.length, `範囲外の条件でエラー ${out.errors.join(' / ')}`);

const missing = await open('ファイルがない（404）', { route: (r) => r.fulfill({ status: 404, body: 'not found' }) });
check(missing.computing === 2, `404 で計算していない（${missing.computing}回）`);
check(missing.errors.every((e) => e.includes('404')), `404 で読み込み以外のエラー ${missing.errors.join(' / ')}`);

const broken = await open('壊れたファイル', { route: (r) => r.fulfill({ status: 200, contentType: 'application/gzip', body: Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3]) }) });
check(broken.computing === 2, `壊れたファイルで計算していない（${broken.computing}回）`);
check(!broken.errors.length, `壊れたファイルでエラー ${broken.errors.join(' / ')}`);

const offline = await open('通信エラー', { route: (r) => r.abort('failed') });
check(offline.computing === 2, `通信エラーで計算していない（${offline.computing}回）`);
check(offline.errors.every((e) => e.includes('ERR_FAILED')), `通信エラーで読み込み以外のエラー ${offline.errors.join(' / ')}`);

// 重い条件（ミュウツー Lv.80・5枠）での待ち時間の比べ。
const heavy = await open('ミュウツー Lv.80（事前計算）', { mon: 'mewtwo', settings: { cklv: 80 } });
check(heavy.computing === 0 && !heavy.errors.length, 'ミュウツー Lv.80 で事前計算を使っていない');
const heavyCalc = await open('ミュウツー Lv.80（範囲外で計算）', { mon: 'mewtwo', settings: { cklv: 80, ckhealtimes: 3 } });
check(heavyCalc.computing === 2 && !heavyCalc.errors.length, 'ミュウツー Lv.80 の範囲外で計算していない');

await browser.close();
server.close();
console.log(failed ? `NG ${failed}件` : 'OK');
process.exit(failed ? 1 : 0);
