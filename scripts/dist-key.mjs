// 事前計算した分布（checker/dist/）を使い回してよいかを決めるキー。公開（.github/workflows/pages.yml）で使う。
// scripts/precompute-dist.mjs から import をたどって集めたファイルの中身と、Node の版から作る。
// どれかが変われば（計算方法・ポケモンのデータ・既定の条件・ファイルの形など）キーが変わり、分布を計算し直す。
// 画面だけのファイル（ui.js・ui/・dom.js など）は分布の計算から読まれないので、変えてもキーは変わらない。
//   node scripts/dist-key.mjs          # キーを出す
//   node scripts/dist-key.mjs --list   # キーに入れたファイルの一覧も出す
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(root, 'scripts/precompute-dist.mjs');

// 相対パスの静的な import（from '…' と import '…'）をたどる。node: などの組み込みモジュールは入れない。
const files = new Set();
const walk = (file) => {
  if (files.has(file)) return;
  files.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) walk(resolve(dirname(file), m[1]));
};
walk(ENTRY);

const list = [...files].map((f) => relative(root, f).split('\\').join('/')).sort();
const hash = createHash('sha256').update(`node ${process.version}\n`);
for (const f of list) hash.update(`${f}\n`).update(readFileSync(join(root, f))).update('\n');

if (process.argv.includes('--list')) console.error(`node ${process.version}\n${list.join('\n')}`);
console.log(hash.digest('hex').slice(0, 32));
