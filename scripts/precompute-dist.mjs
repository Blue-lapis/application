// 既定の条件の上位%の分布を事前計算して、checker/dist/ に gzip した JSON で書き出す（ver1.9）。
// リポジトリ直下で `node scripts/precompute-dist.mjs [出力先] [--jobs=並列数]` を実行する（出力先の既定は checker/dist）。
// 対象の条件・ファイルの形・置き場所は checker/js/precomputed.js で決める。出力先は作り直す。
// 条件ごとに新しいエンジンで計算し（Worker と同じ手順）、書き出した中身を読み戻して元の分布とビットまで同じことを確かめる。
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { TYPES } from '../checker/js/types.js';
import { clearCaches } from '../checker/js/engine.js';
import { dataKey } from '../checker/js/distcache.js';
import { preEnvs, distPath, encodeDist, decodeDist } from '../checker/js/precomputed.js';

// 1条件を計算して書き出す。書き出したバイト列から戻した分布が元と違えば例外にする。
function run(out, { type, env }) {
  const t0 = performance.now();
  const dist = TYPES[type].createEngine().dist(env);
  clearCaches();
  const ms = performance.now() - t0;
  const json = JSON.stringify(encodeDist(type, env, dist));
  const gz = gzipSync(json, { level: 9 });
  const back = decodeDist(JSON.parse(gunzipSync(gz).toString()), dataKey(type, env));
  if (!back || back.length !== dist.length || back.some((x, i) => !Object.is(x.r, dist[i].r) || !Object.is(x.p, dist[i].p))) {
    throw new Error(`読み戻した分布が一致しない: ${type} ${JSON.stringify(env)}`);
  }
  const file = join(out, distPath(type, env));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, gz);
  return { ms, raw: json.length, gz: gz.length };
}

if (isMainThread) {
  const args = process.argv.slice(2);
  const out = resolve(args.find((a) => !a.startsWith('--')) || 'checker/dist');
  const jobsArg = args.find((a) => a.startsWith('--jobs='));
  const jobs = preEnvs();
  const n = Math.max(1, Math.min(jobs.length, jobsArg ? Number(jobsArg.slice(7)) : availableParallelism()));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const start = performance.now();
  const sum = { ms: 0, raw: 0, gz: 0, done: 0 };
  let next = 0;
  await Promise.all(Array.from({ length: n }, () => new Promise((ok, fail) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { out } });
    const give = () => {
      if (next < jobs.length) w.postMessage(jobs[next++]);
      else w.terminate().then(ok);
    };
    w.on('message', (r) => {
      sum.ms += r.ms; sum.raw += r.raw; sum.gz += r.gz; sum.done++;
      give();
    });
    w.on('error', fail);
    give();
  })));
  const sec = (performance.now() - start) / 1000;
  const mb = (b) => (b / 1e6).toFixed(1);
  console.log(`${sum.done}件（${n}並列）: ${sec.toFixed(1)}秒（計算の合計 ${(sum.ms / 1000).toFixed(0)}秒）、未圧縮 ${mb(sum.raw)}MB、gzip ${mb(sum.gz)}MB → ${out}`);
} else {
  parentPort.on('message', (job) => parentPort.postMessage(run(workerData.out, job)));
}
