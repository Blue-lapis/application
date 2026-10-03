// にとよんツールとの比較。手順は docs/checker/design-v1.5.md。
// node tests/compare-nitoyon.mjs gen <type> cases.json ours.json   条件と、このアプリの値を書き出す
// node tests/compare-nitoyon.mjs cmp <type> ours.json nitoyon.json  tests/nitoyon/runner.ts の結果と比べる
// type は berry / ingredient / skill。ポケモンの基礎値は両方のツールのデータをそのまま使う。
// スキルは、このアプリだけが満タン後のキュー4回を抽選するので、所持数が満タンになる条件では値が多くなる（docs/checker/design-v1.5.md の6章）。
import { readFileSync, writeFileSync } from 'node:fs';
import { TYPES } from '../checker/js/types.js';
import { SLOTS_AT, slotWeights } from '../js/constants.js';

const NAME = {
  'mr-mime': 'Mr. Mime', farfetchd: "Farfetch'd",
  'gourgeist-small': 'Gourgeist (Small)', 'gourgeist-medium': 'Gourgeist (Medium)',
  'gourgeist-large': 'Gourgeist (Large)', 'gourgeist-jumbo': 'Gourgeist (Jumbo)',
  'toxtricity-amped': 'Toxtricity (Amped)', 'toxtricity-low-key': 'Toxtricity (Low Key)',
  'pikachu-holiday': 'Pikachu (Holiday)', 'eevee-halloween': 'Eevee (Halloween)', 'spheal-holiday': 'Spheal (Holiday)',
  'ninetales-alola': 'Ninetales (Alola)', 'pikachu-halloween': 'Pikachu (Halloween)', 'eevee-holiday': 'Eevee (Holiday)',
  'pikachu-captain': 'Pikachu (Captain)',
};
const nameOf = (k) => NAME[k] || k[0].toUpperCase() + k.slice(1);
const SUBNAME = {
  skM: 'Skill Trigger M', skS: 'Skill Trigger S', spM: 'Helping Speed M', spS: 'Helping Speed S', hb: 'Helping Bonus',
  invS: 'Inventory Up S', invM: 'Inventory Up M', invL: 'Inventory Up L', berry: 'Berry Finding S',
  erb: 'Energy Recovery Bonus', ingM: 'Ingredient Finder M', ingS: 'Ingredient Finder S',
};
// [にとよんツールの性格, 上昇, 下降]
const NATS = [['Bashful', null, null], ['Lonely', 'speed', 'energy'], ['Modest', 'ing', 'speed'], ['Calm', 'skill', 'speed'],
  ['Bold', 'energy', 'speed'], ['Careful', 'skill', 'ing'], ['Adamant', 'speed', 'ing']];
// ストリンダーは姿ごとに付く性格が決まっていて、にとよんツールは合わない性格を置き換える（このアプリでは選べない）。その条件は比べない。
const AMPED = ['Hardy', 'Docile', 'Quirky', 'Lax', 'Impish', 'Hasty', 'Naive', 'Jolly', 'Brave', 'Naughty', 'Adamant', 'Sassy', 'Rash'];
const skip = (key, nat) => (key === 'toxtricity-amped' && !AMPED.includes(nat)) || (key === 'toxtricity-low-key' && AMPED.includes(nat));
const SUBSETS = {
  berry: [[], ['berry'], ['spM', 'spS'], ['invL', 'ingM', 'berry'], ['erb', 'invM', 'spS'], ['hb', 'berry', 'spM', 'ingS', 'invS']],
  ingredient: [[], ['ingM'], ['spM', 'spS'], ['invL', 'berry', 'ingS'], ['erb', 'invM', 'spS'], ['hb', 'ingM', 'spM', 'ingS', 'invS']],
  skill: [[], ['skM'], ['spM', 'spS'], ['invL', 'berry', 'skS'], ['erb', 'ingM', 'spS'], ['hb', 'skM', 'spM', 'skS', 'invS']],
};
const [mode, type, f1, f2] = process.argv.slice(2);
const def = TYPES[type];
if (!def || !['gen', 'cmp'].includes(mode)) throw new Error('使い方は先頭のコメントを参照');
const dayTap = type === 'berry' ? 'none' : 'always';
const ENVS = [
  { heal: 0, tap: dayTap, camp: false },
  { heal: 1, tap: dayTap, camp: true },
  { heal: 1, tap: '3h', camp: true },
  { heal: 'g80', tap: '3h', camp: false },
  { heal: 1, tap: '3h', camp: false },
];
const tapOf = (t) => (t === 'always' ? 1 : t === 'none' ? 0 : 180);
const allArrs = (mon) => mon.slots.reduce(
  (acc, opts) => acc.flatMap(({ arr, p }) => opts.map((_, k) => ({ arr: [...arr, k], p: p * slotWeights(opts.length)[k] }))),
  [{ arr: [], p: 1 }],
);
const letters = (arr) => arr.map((k) => 'ABC'[k]).join('');

if (mode === 'gen') {
  const eng = def.createEngine();
  const cases = [], rows = [];
  for (const [key, mon] of Object.entries(def.MONS)) {
    for (const lv of [50, 60, 80]) for (const e0 of ENVS) for (const ss0 of SUBSETS[type]) for (const [nat, up, down] of NATS) {
      if (skip(key, nat)) continue;
      const N = SLOTS_AT[lv];
      const ss = ss0.slice(0, N);
      const env = { lv, N, camp: e0.camp, mon: key, target: 'A', heal: e0.heal, tap: e0.tap, team: false, healAmt: 18, healTimes: 3 };
      const m = def.mults(ss, up, down);
      const base = {
        name: nameOf(key), level: lv, subs: ss.map((s) => SUBNAME[s]), nature: nat,
        e4eEnergy: 18, e4eCount: e0.heal === 1 ? 3 : 0, full: e0.heal === 'g80', tap: tapOf(e0.tap), camp: e0.camp, helpBonusCount: 0,
      };
      const arrs = allArrs(mon);
      const push = (extra) => arrs.map((a) => cases.push({ ...base, ing: letters(a.arr), ...extra }) - 1);
      const row = { key, lv, env: e0, ss, nat, arrs, idx: push({}) };
      row.ours = type === 'ingredient'
        ? arrs.map((a) => Object.keys(mon.ings).map((t) => eng.metric(m, a.arr, { ...env, target: t })))
        : eng.metric(m, env);
      // おてつだいボーナスのチーム効果: ほかの4匹（サブスキルなし・無補正）がおてつだいスピード+5%で増やす分。
      if (type === 'skill' && ss0.length === 0 && nat === 'Bashful') {
        row.teamIdx = push({ helpBonusCount: 1 });
        row.oursTeam = eng.teamGain({ ...env, team: true });
      }
      rows.push(row);
    }
  }
  writeFileSync(f1, JSON.stringify(cases));
  writeFileSync(f2, JSON.stringify(rows));
  console.log(`${type}: ${rows.length}条件（にとよんツールは${cases.length}件）`);
} else {
  const rows = JSON.parse(readFileSync(f1)), nito = JSON.parse(readFileSync(f2));
  const rel = (a, b) => (b === 0 ? Math.abs(a) : Math.abs(a / b - 1));
  const diffs = [];
  const avg = (idx, arrs, f) => idx.reduce((s, ix, i) => s + arrs[i].p * nito[ix][f], 0);
  for (const r of rows) {
    const mon = def.MONS[r.key];
    if (type === 'ingredient') {
      r.arrs.forEach((a, i) => Object.keys(mon.ings).forEach((t, j) => {
        if (!a.arr.some((k, s) => mon.slots[s][k][0] === t)) return;
        diffs.push({ r, label: `${letters(a.arr)} ${t}`, ours: r.ours[i][j], nito: nito[r.idx[i]].ing[j] });
      }));
    } else {
      diffs.push({ r, label: '', ours: r.ours, nito: avg(r.idx, r.arrs, type) });
    }
    if (r.teamIdx) {
      const gain = 4 * (avg(r.teamIdx, r.arrs, 'skill') - avg(r.idx, r.arrs, 'skill'));
      diffs.push({ r, label: 'チーム効果', ours: r.oursTeam, nito: gain });
    }
  }
  diffs.forEach((x) => { x.d = rel(x.ours, x.nito); });
  diffs.sort((a, b) => b.d - a.d);
  const q = (f) => diffs[Math.floor((1 - f) * (diffs.length - 1))].d.toExponential(2);
  console.log(`${type}: ${diffs.length}件 相対差 中央値 ${q(0.5)} 99% ${q(0.99)} 最大 ${diffs[0].d.toExponential(2)}`);
  diffs.slice(0, 5).forEach((x) => console.log(
    `  ${x.r.key} Lv.${x.r.lv} ${JSON.stringify(x.r.env)} [${x.r.ss}] ${x.r.nat} ${x.label} このアプリ ${x.ours} にとよん ${x.nito}`));
}
