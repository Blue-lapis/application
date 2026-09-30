// 事前計算の分布（ver1.9）を確かめる。先に `node scripts/precompute-dist.mjs` で checker/dist/ を作り、
// リポジトリ直下で `node tests/check-precomputed.mjs [checker/dist] [--all]` を実行する。
// - 範囲の条件のファイルがすべてあり、余分なファイルがない。
// - ファイルから戻した分布が、Worker と同じ手順（条件ごとに新しいエンジン）で計算した分布とビットまで一致する
//   （既定は抜き取り。--all で全件）。
// - 版（MODEL_VERSION）・キーが違うファイル、壊れたファイル、404・通信エラー・時間切れでは使わない（null）。
// - 範囲外の条件ではファイルを取りに行かない。画面の既定の条件は範囲に入る。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { TYPES } from '../checker/js/types.js';
import { clearCaches } from '../checker/js/engine.js';
import { MODEL_VERSION, dataKey } from '../checker/js/distcache.js';
import { PRE_LEVELS, preEnvs, isPrecomputed, distPath, encodeDist, decodeDist, fetchDist } from '../checker/js/precomputed.js';
import { state, env as stateEnv } from '../checker/js/state.js';

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith('--')) || 'checker/dist');
const all = args.includes('--all');

let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('NG', msg); } };
const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x.r, b[i].r) && Object.is(x.p, b[i].p));
const label = ({ type, env }) => `${type} ${env.mon} Lv.${env.lv} ${env.camp ? 'チケットあり' : 'なし'}${env.target ? ` ${env.target}` : ''}`;

if (!existsSync(dir)) {
  console.log(`NG ${dir} がない。先に node scripts/precompute-dist.mjs を実行する`);
  process.exit(1);
}

// 1. ファイルがそろっている。
const jobs = preEnvs();
const expected = new Set(jobs.map(({ type, env }) => distPath(type, env)));
const files = [];
const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : files.push(relative(dir, join(d, e.name)).split('\\').join('/'))));
walk(dir);
check(files.length === expected.size, `ファイルの数 ${files.length}（範囲は ${expected.size}件）`);
files.filter((f) => !expected.has(f)).slice(0, 5).forEach((f) => check(false, `範囲外のファイル ${f}`));
[...expected].filter((f) => !files.includes(f)).slice(0, 5).forEach((f) => check(false, `ファイルがない ${f}`));
check(new Set(jobs.map(({ type, env }) => `${type}|${env.lv}`)).size === Object.keys(TYPES).length * PRE_LEVELS.length, '3タイプ × 4レベルがそろっていない');

// 2. 計算した分布と一致する。抜き取りは25件ごとに1件と、タイプ・レベル・チケットの組ごとの最初の1件。
const read = (job) => decodeDist(JSON.parse(gunzipSync(readFileSync(join(dir, distPath(job.type, job.env)))).toString()), dataKey(job.type, job.env));
const seen = new Set();
const sample = jobs.filter((job, i) => {
  const k = `${job.type}|${job.env.lv}|${job.env.camp}`;
  const first = !seen.has(k);
  seen.add(k);
  return all || first || i % 25 === 0;
});
let rows = 0;
const t0 = performance.now();
for (const job of sample) {
  const d = read(job);
  const want = TYPES[job.type].createEngine().dist(job.env);
  clearCaches();
  check(same(d, want), `${label(job)}: 計算した分布と一致しない`);
  rows += want.length;
}
console.log(`照合 ${sample.length}件 / ${jobs.length}件（${rows.toLocaleString()}行、${((performance.now() - t0) / 1000).toFixed(1)}秒）`);

// 3. 使ってはいけないファイル。
const job = jobs.find((j) => j.type === 'skill');
const good = encodeDist(job.type, job.env, TYPES[job.type].createEngine().dist(job.env));
const key = dataKey(job.type, job.env);
check(decodeDist(good, key) !== null, '正しい中身を読めない');
check(decodeDist({ ...good, v: MODEL_VERSION - 1 }, key) === null, '古い MODEL_VERSION のファイルを使った');
check(decodeDist({ ...good, v: MODEL_VERSION + 1 }, key) === null, '新しい MODEL_VERSION のファイルを使った');
// MODEL_VERSION を上げる前に作ったファイル（版もキーも古い）。
const oldKey = key.replace(/^\d+\|/, `${MODEL_VERSION - 1}|`);
check(oldKey !== key && decodeDist({ ...good, v: MODEL_VERSION - 1, key: oldKey }, key) === null, '古い MODEL_VERSION で作ったファイルを使った');
check(decodeDist({ ...good, key: oldKey }, key) === null, '古い MODEL_VERSION のキーのファイルを使った');
check(decodeDist(good, dataKey(job.type, { ...job.env, camp: !job.env.camp })) === null, '別の条件のファイルを使った');
check(decodeDist({ ...good, p: good.p.slice(1) }, key) === null, '行の数が合わないファイルを使った');
check(decodeDist({ ...good, p: good.p.map((x, i) => (i ? x : x * 2)) }, key) === null, '確率の合計が1でないファイルを使った');
check(decodeDist({ ...good, r: good.r.map((x, i) => (i === 1 ? -x : x)) }, key) === null, '順番の崩れたファイルを使った');
check(decodeDist({ ...good, r: good.r.map((x, i) => (i === 1 ? 'x' : x)) }, key) === null, '数でない値のファイルを使った');
check(decodeDist(null, key) === null && decodeDist({}, key) === null, '空のファイルを使った');
check(distPath(job.type, job.env).startsWith(`v${MODEL_VERSION}/`), 'ファイルの場所に MODEL_VERSION がない');

// 4. 取得（fetch を差し替える）。範囲外は取りに行かない。失敗はどれも null。
let calls = 0;
const withFetch = async (impl, type, env) => {
  globalThis.fetch = async (...a) => { calls++; return impl(...a); };
  return fetchDist(type, env);
};
const body = (bytes, status = 200) => new Response(bytes, { status });
const gz = gzipSync(JSON.stringify(good));
check(same(await withFetch(() => body(gz), job.type, job.env), decodeDist(good, key)), 'gzip のファイルを読めない');
check(same(await withFetch(() => body(JSON.stringify(good)), job.type, job.env), decodeDist(good, key)), '展開済みで届いたファイルを読めない');
check(await withFetch(() => body('not found', 404), job.type, job.env) === null, '404 で null にならない');
check(await withFetch(() => { throw new TypeError('network'); }, job.type, job.env) === null, '通信エラーで null にならない');
check(await withFetch(() => body(gz.subarray(0, gz.length >> 1)), job.type, job.env) === null, '途中で切れた gzip で null にならない');
check(await withFetch(() => body(Uint8Array.from([0x1f, 0x8b, 1, 2, 3])), job.type, job.env) === null, '壊れた gzip で null にならない');
check(await withFetch(() => body('{"v":'), job.type, job.env) === null, '壊れた JSON で null にならない');
check(await withFetch(() => body(gzipSync(JSON.stringify({ ...good, v: MODEL_VERSION - 1 }))), job.type, job.env) === null, '古い版のファイルで null にならない');
const tStart = performance.now();
const hung = await withFetch((_, { signal }) => new Promise((_ok, fail) => signal.addEventListener('abort', () => fail(new Error('abort')))), job.type, job.env);
check(hung === null, '応答がないときに null にならない');
console.log(`時間切れで計算に切り替えるまで ${((performance.now() - tStart) / 1000).toFixed(1)}秒`);

const base = { ...job.env };
const outside = [
  ['healTimes', { ...base, healTimes: 3 }], ['healAmt', { ...base, healAmt: 20 }], ['heal', { ...base, heal: 0 }],
  ['tap', { ...base, tap: '3h' }], ['team', { ...base, team: false }], ['lv', { ...base, lv: 55 }],
  ['N', { ...base, N: 4 }], ['mon', { ...base, mon: 'nothing' }], ['項目の追加', { ...base, extra: 1 }],
];
calls = 0;
for (const [name, e] of outside) {
  check(!isPrecomputed(job.type, e), `${name} を変えた条件が範囲に入る`);
  check(await withFetch(() => body(gz), job.type, e) === null, `${name} を変えた条件で分布を返した`);
}
check(calls === 0, `範囲外の条件でファイルを ${calls}回 取りに行った`);
const ing = jobs.find((j) => j.type === 'ingredient').env;
check(!isPrecomputed('ingredient', { ...ing, target: 'Z' }), '存在しない狙い食材が範囲に入る');
check(!isPrecomputed('ingredient', { ...ing, lv: 50, target: 'C' }), 'Lv.50 で開いていない狙い食材が範囲に入る');

// 5. 画面の既定の条件（各タイプの既定のポケモン・狙い食材 A）が範囲に入る。
for (const type of Object.keys(TYPES)) {
  Object.assign(state, { type, mon: TYPES[type].DEFAULT_MON, target: 'A' });
  check(isPrecomputed(type, stateEnv()), `${type} の画面の既定の条件が範囲に入らない: ${JSON.stringify(stateEnv())}`);
  check(isPrecomputed(type, { ...stateEnv(), camp: !state.camp }), `${type} の既定でチケットを切り替えた条件が範囲に入らない`);
}

console.log(failed ? `NG ${failed}件` : 'OK');
process.exit(failed ? 1 : 0);
