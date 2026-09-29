// 上位%の分布を IndexedDB に保存して、開き直したときや別のポケモンから戻ったときに計算を省く。
// 分布は食材タイプの4枠で1万行を超えるので、容量の小さい localStorage ではなく IndexedDB に数値の配列で持つ。
// 保存できない環境（プライベートブラウズなど）では何もせず、毎回計算する。
import { SUBS, RARITY_P, NAT, ENERGY_BANDS } from '../../js/constants.js';
import { TYPES } from './types.js';

// 計算方法を変えたら上げる。キーが変わるので古い分布は使われず、そのうち消える。
const MODEL_VERSION = 2;
const DB_NAME = 'checker-dist';
const STORE = 'dist';
// 保存する分布の数の上限。超えたら最後に使ったのが古いものから消す。
const MAX_ENTRIES = 300;

// 文字列の簡単なハッシュ（FNV-1a）。ポケモンの基礎値や共通データが変わったら、キーも変わるようにする。
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}
const COMMON = hash(JSON.stringify([SUBS, RARITY_P, NAT, ENERGY_BANDS]));

export const cacheKey = (type, env) => [
  MODEL_VERSION, COMMON, type, hash(JSON.stringify(TYPES[type].MONS[env.mon])),
  env.mon, env.N, env.camp, env.g80 ?? '', env.target ?? '',
  // きのみタイプだけのパラメーター。
  env.heal ?? '', env.tap ?? '', env.team ?? '', env.healAmt ?? '', env.healTimes ?? '',
].join('|');

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
    db.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...rec, t: Date.now() });
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
