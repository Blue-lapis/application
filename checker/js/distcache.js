// 上位%の分布を IndexedDB に保存して、開き直したときや別のポケモンから戻ったときに計算を省く。
// 分布は食材タイプの4枠で1万行を超えるので、容量の小さい localStorage ではなく IndexedDB に数値の配列で持つ。
// 保存できない環境（プライベートブラウズなど）では何もせず、毎回計算する。
import { SUBS, RARITY_P, NAT, ENERGY_BANDS, slotWeights } from '../../js/constants.js';
import { TYPES } from './types.js';

// 計算方法を変えたら上げる。キーが変わるので古い分布は使われず、そのうち消える。
// 事前計算のファイル（precomputed.js）も、置き場所と中身の照合にこの値を使う。
export const MODEL_VERSION = 10;
// 公開時にモジュールの URL に付く版（?v=コミット）。上げ忘れても、公開のたびに分布を計算し直す。
const BUILD = new URL(import.meta.url).searchParams.get('v') || '';
const DB_NAME = 'checker-dist';
const STORE = 'dist';
// 保存する分布の数の上限。超えたら最後に使ったのが古いものから消す。
const MAX_ENTRIES = 300;
// 最後に使った時刻を更新する間隔（ミリ秒）。
const TOUCH_EVERY = 24 * 3600 * 1000;

// 文字列の簡単なハッシュ（FNV-1a）。ポケモンの基礎値や共通データが変わったら、キーも変わるようにする。
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}
const COMMON = hash(JSON.stringify([SUBS, RARITY_P, NAT, ENERGY_BANDS, String(slotWeights)]));

// 条件（env）はすべての項目をキーに入れる。パラメーターを増やしても書き足さなくてよい。
const envText = (env) => JSON.stringify(Object.keys(env).sort().map((k) => [k, env[k]]));
const keyParts = (type, env) => [COMMON, type, hash(JSON.stringify(TYPES[type].MONS[env.mon])), envText(env)];
export const cacheKey = (type, env) => [MODEL_VERSION, BUILD, ...keyParts(type, env)].join('|');
// 公開した版（BUILD）を除いたキー。事前計算のファイルはデプロイのたびに作り直すので、版の代わりにこのキーで照合する。
export const dataKey = (type, env) => [MODEL_VERSION, ...keyParts(type, env)].join('|');

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: 'k' });
          store.createIndex('t', 't');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

const done = (req) => new Promise((resolve) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => resolve(null);
});

// 保存してある分布を [{ r, p }] で返す。なければ null。
export async function loadDist(key) {
  const db = await openDb();
  if (!db) return null;
  try {
    const rec = await done(db.transaction(STORE).objectStore(STORE).get(key));
    if (!rec) return null;
    // 最後に使った時刻を更新して、よく使う分布が消されないようにする。
    // 更新は分布ごと書き直すことになる（最大で数百KB）ので、1日に1回までにする。
    if (Date.now() - rec.t > TOUCH_EVERY) db.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...rec, t: Date.now() });
    return Array.from(rec.r, (r, i) => ({ r, p: rec.p[i] }));
  } catch {
    return null;
  }
}

export async function saveDist(key, dist) {
  const db = await openDb();
  if (!db) return;
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    store.put({ k: key, t: Date.now(), r: Float64Array.from(dist, (x) => x.r), p: Float64Array.from(dist, (x) => x.p) });
    const n = await done(store.count());
    if (n > MAX_ENTRIES) {
      let extra = n - MAX_ENTRIES;
      const cur = db.transaction(STORE, 'readwrite').objectStore(STORE).index('t').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || extra <= 0) return;
        c.delete();
        extra--;
        c.continue();
      };
    }
  } catch { /* storage unavailable or full */ }
}
