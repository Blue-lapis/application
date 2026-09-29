// node tests/compare-dist.mjs before.json after.json
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map(p => JSON.parse(readFileSync(p, 'utf8')));
assert.deepEqual(b.env, a.env);
assert.equal(b.dist.length, a.dist.length, '分布の行数');
let pa = 0, pb = 0, maxR = 0, maxP = 0, maxCumulative = 0;
for (let i = 0; i < a.dist.length; i++) {
  const x = a.dist[i], y = b.dist[i];
  assert.ok(Number.isFinite(y.r) && Number.isFinite(y.p));
  maxR = Math.max(maxR, Math.abs(x.r - y.r));
  maxP = Math.max(maxP, Math.abs(x.p - y.p));
  pa += x.p; pb += y.p;
  maxCumulative = Math.max(maxCumulative, Math.abs(pa - pb));
  assert.ok(Math.abs(x.r - y.r) <= 1e-12 * Math.max(1, Math.abs(x.r)), `無補正比 行${i}`);
  assert.ok(Math.abs(x.p - y.p) <= 1e-12, `確率 行${i}`);
  assert.ok(Math.abs(pa - pb) <= 1e-12, `同等以上の確率 行${i}`);
}
console.log(JSON.stringify({ rows: a.dist.length, maxR, maxP, maxCumulative, result: 'OK' }));
