// 版の番号がそろっていることのテスト。node tests/check-version.mjs
// 版は各アプリの version.js にだけ書き、画面（index.html の data-ver）にはそこから出す。
// README.md の「今の版」と、版の一覧の最後の行が version.js と同じであること。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION as CHECKER } from '../checker/js/version.js';
import { VERSION as EXP } from '../exp/js/version.js';

const readme = readFileSync('README.md', 'utf8');
// README の「### 見出し」の節にある「- v1.2 — …」の行の版。
const listed = (heading) => {
  const sec = readme.split(/^### /m).find((s) => s.startsWith(heading));
  assert.ok(sec, `README に「### ${heading}」がない`);
  return [...sec.matchAll(/^- (v\d+\.\d+) —/gm)].map((m) => m[1]);
};

for (const [name, v, dir] of [['厳選チェッカー', CHECKER, 'checker'], ['育成日数シミュレーター', EXP, 'exp']]) {
  assert.match(v, /^v\d+\.\d+$/, `${dir}/js/version.js の形`);
  assert.ok(readme.includes(`**${name} ${v}**`), `README の「今の版」が ${name} ${v} でない`);
  assert.equal(listed(name).at(-1), v, `README の ${name} の版の一覧の最後が ${v} でない`);
  // 画面には data-ver（フッター）から出し、index.html に版を直接書かない。
  const html = readFileSync(`${dir}/index.html`, 'utf8');
  assert.equal(html.match(/data-ver/g)?.length, 1, `${dir}/index.html の data-ver が1か所でない`);
  assert.ok(!/class="ver"[^<]*v\d+\.\d+/.test(html), `${dir}/index.html に版が直接書いてある`);
  console.log(`ok ${name} ${v}`);
}
console.log('OK');
