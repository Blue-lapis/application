// node tests/bench-dist.mjs [repo] [always|3h] [healTimes] [出力JSON] [mon]
// プロセスごとに実行する。IndexedDB・過去の計算結果は使わない。
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const [repo = '.', tap = 'always', times = '3', output, mon = 'mewtwo'] = process.argv.slice(2);
const { createEngine } = await import(pathToFileURL(resolve(repo, 'checker/js/skill/calc.js')));
const env = { N: 5, camp: true, mon, heal: 1, tap, team: true, healAmt: 18, healTimes: Number(times) };
const start = performance.now();
const dist = createEngine().dist(env);
const seconds = (performance.now() - start) / 1000;
if (output) writeFileSync(output, JSON.stringify({ env, dist }));
console.log(JSON.stringify({ env, rows: dist.length, seconds }));
