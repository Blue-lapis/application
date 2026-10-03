// 事前計算した上位%の分布（ver1.9）。デプロイ時に Node（../../scripts/precompute-dist.mjs）が既定の条件の分布を
// 計算して checker/dist/ に置き、Worker は IndexedDB に保存がなければここから読む。範囲外の条件や、
// 読めない・合わないファイルは null を返し、Worker が今までどおり計算する。
// Node とブラウザで同じ関数を使い、書き出しと読み込みの形をそろえる。
import { SLOTS_AT } from '../../js/constants.js';
import { HEAL_AMT, HEAL_TIMES } from './berry/constants.js';
import { targetOpen } from './ingredient/constants.js';
import { TYPES, DEFAULT_TAP } from './types.js';
import { MODEL_VERSION, dataKey } from './distcache.js';

// 事前計算するレベル。チケットはあり・なしの両方、食材タイプは狙い食材をすべて。
export const PRE_LEVELS = [50, 60, 70, 80];
// レベル・チケット・ポケモン・狙い食材以外は既定の値だけ（state.js の既定と同じ。tests/check-precomputed.mjs で確かめる）。
const preEnv = (type, mon, lv, camp, target) => ({
  lv, N: SLOTS_AT[lv], camp, mon, ...(type === 'ingredient' ? { target } : {}),
  heal: 1, tap: DEFAULT_TAP, team: true, healAmt: HEAL_AMT, healTimes: HEAL_TIMES,
});

// 食材タイプで、狙い食材がそのレベルで開いている食材の枠に出ない条件（Lv.50 で Lv.60 の枠だけに出る食材）は
// 無補正比が出せない（画面は「—」）ので、事前計算しない（targetOpen）。

// 事前計算するすべての条件 [{ type, env }]。
export function preEnvs() {
  const out = [];
  for (const [type, { MONS }] of Object.entries(TYPES)) {
    for (const mon of Object.keys(MONS)) {
      const targets = type === 'ingredient' ? Object.keys(MONS[mon].ings) : [undefined];
      for (const target of targets) {
        for (const lv of PRE_LEVELS) {
          if (target && !targetOpen(MONS[mon], lv, target)) continue;
          for (const camp of [true, false]) out.push({ type, env: preEnv(type, mon, lv, camp, target) });
        }
      }
    }
  }
  return out;
}

const sorted = (env) => JSON.stringify(Object.keys(env).sort().map((k) => [k, env[k]]));
// 事前計算の範囲に入る条件か。項目が1つでも違えば（増えても）範囲外で、ファイルを取りに行かない。
export function isPrecomputed(type, env) {
  const mons = TYPES[type]?.MONS;
  if (!mons || !env || typeof env.mon !== 'string' || !Object.hasOwn(mons, env.mon)) return false;
  if (!PRE_LEVELS.includes(env.lv) || typeof env.camp !== 'boolean') return false;
  if (type === 'ingredient' && !(Object.hasOwn(mons[env.mon].ings, env.target) && targetOpen(mons[env.mon], env.lv, env.target))) return false;
  return sorted(env) === sorted(preEnv(type, env.mon, env.lv, env.camp, env.target));
}

// checker/dist/ から見たファイルの場所。MODEL_VERSION を入れて、版の違うファイルを取らないようにする。
export const distPath = (type, env) => `v${MODEL_VERSION}/${type}/${env.mon}/lv${env.lv}-${env.camp ? 'camp' : 'nocamp'}${type === 'ingredient' ? `-${env.target}` : ''}.json.gz`;

// 分布 [{ r, p }] をファイルの中身にする。r は toFixed(9) を数値にした値なので 1e9 倍の整数にし、
// 高い順に並んでいるので前の行との差（正の整数）で持つ。p は丸めない（JSON の数値は倍精度をそのまま戻せる）。
export function encodeDist(type, env, dist) {
  const n = dist.map((x) => Math.round(x.r * 1e9));
  return { v: MODEL_VERSION, key: dataKey(type, env), r: n.map((x, i) => (i ? n[i - 1] - x : x)), p: dist.map((x) => x.p) };
}

// ファイルの中身を分布に戻す。版・キーが違う、形が壊れている、確率の合計が1でないときは null。
export function decodeDist(obj, key) {
  if (!obj || obj.v !== MODEL_VERSION || obj.key !== key) return null;
  const { r, p } = obj;
  if (!Array.isArray(r) || !Array.isArray(p) || !r.length || r.length !== p.length) return null;
  const dist = new Array(r.length);
  let n = 0, sum = 0;
  for (let i = 0; i < r.length; i++) {
    if (!Number.isSafeInteger(r[i]) || (i > 0 && r[i] <= 0)) return null;
    n = i ? n - r[i] : r[i];
    if (n < 0 || typeof p[i] !== 'number' || !(p[i] >= 0 && p[i] <= 1)) return null;
    dist[i] = { r: n / 1e9, p: p[i] };
    sum += p[i];
  }
  return Math.abs(sum - 1) < 1e-9 ? dist : null;
}

// 取得を諦めて計算に切り替えるまでの時間（ミリ秒）。スマートフォンの遅い回線で待ち続けないようにする。
const FETCH_TIMEOUT = 6000;
// 公開時に付くモジュールの版（?v=コミット）をファイルにも付け、Pages のキャッシュで古いファイルと混ざらないようにする。
const VERSION = new URL(import.meta.url).search;

// 事前計算のファイルを取得して分布を返す。範囲外・404・通信エラー・時間切れ・壊れたファイルは null。
export async function fetchDist(type, env) {
  if (!isPrecomputed(type, env)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(new URL(`../dist/${distPath(type, env)}${VERSION}`, import.meta.url), { signal: ctrl.signal });
    if (!res.ok) return null;
    let bytes = new Uint8Array(await res.arrayBuffer());
    // サーバーが Content-Encoding を付けて返したときは、ブラウザがもう展開している。
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') return null;
      bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    }
    return decodeDist(JSON.parse(new TextDecoder().decode(bytes)), dataKey(type, env));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
