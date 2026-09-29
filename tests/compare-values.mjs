// node tests/compare-values.mjs /path/to/baseline
// 比較先は別の worktree。両方の計算エンジンを読み、毎回同じ条件で比べる。
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TYPES } from '../checker/js/types.js';
if (!process.argv[2]) throw new Error('変更前のリポジトリのパスを指定してください');
const { TYPES: old } = await import(pathToFileURL(resolve(process.argv[2], 'checker/js/types.js')));
const subs = [[], ['hb', 'skM', 'ingM'], ['spM', 'spS', 'berry', 'invL'], ['erb', 'skS', 'ingS', 'invM']];
const nats = [[null, null], ['speed', 'energy'], ['energy', 'skill'], ['skill', 'ing']];
let count = 0, max = 0;
for (const [type, def] of Object.entries(TYPES)) {
  const before = old[type].createEngine(), after = def.createEngine();
  let num = 0;
  for (const mon of Object.keys(def.MONS)) {
    for (let i = 0; i < 4; i++) {
      const env = { N: [3, 4, 5, 5][i], camp: i % 2 === 0, mon, target: 'A', heal: [0, 1, 1, 'g80'][i], tap: i % 2 ? '3h' : type === 'berry' ? 'none' : 'always', team: i !== 0, healAmt: 18, healTimes: i === 2 ? 2.5 : 3 };
      for (const ss of subs) for (const [up, down] of nats) {
        const args = type === 'ingredient' ? [ss, up, down, [0, 0, 0], env] : [ss, up, down, env];
        const rawArgs = (d) => type === 'ingredient'
          ? [d.mults(ss, up, down), [0, 0, 0], env]
          : [d.mults(ss, up, down), env];
        const pairs = [
          ['score', before.score(...args), after.score(...args)],
          ['metric', before.metric(...rawArgs(old[type])), after.metric(...rawArgs(def))],
          ['baseMetric', before.baseMetric(env), after.baseMetric(env)],
        ];
        for (const [key, a, b] of pairs) {
          assert.ok(Number.isFinite(a) && Number.isFinite(b));
          const delta = Math.abs(a - b);
          max = Math.max(max, delta);
          if (type !== 'skill') assert.equal(b, a, `${type}/${mon}/${key}`);
          else assert.ok(delta <= 1e-12 * Math.max(1, Math.abs(a)), `${type}/${mon}/${key}: ${a} != ${b}`);
        }
        num++;
      }
    }
  }
  count += num;
  console.log(`${type}: ${num}件 OK`);
}
console.log(`計${count}件 OK 最大絶対差 ${max}`);
