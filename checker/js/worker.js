import { TYPES } from './types.js';
import { clearCaches } from './engine.js';
import { cacheKey, loadDist, saveDist } from './distcache.js';
import { fetchDist } from './precomputed.js';

// 分布は「保存してある分布（IndexedDB）→ 事前計算のファイル → 計算」の順に探し、見つかったものを返す。
// ファイルから読んだ分布も計算した分布も保存し、次からは IndexedDB から読む。
// 計算が必要なときは先に { computing: true } を送り、画面に「計算中」と出せるようにする。
// 途中の値のキャッシュは5枠の分布1つで数百MBになるので、分布ごとに新しいエンジンで計算し、終わったら捨てる。
self.onmessage = async ({ data: { type, env } }) => {
  const key = cacheKey(type, env);
  const saved = await loadDist(key);
  if (saved) {
    self.postMessage({ type, env, dist: saved });
    return;
  }
  const pre = await fetchDist(type, env);
  if (pre) {
    self.postMessage({ type, env, dist: pre });
    await saveDist(key, pre);
    return;
  }
  self.postMessage({ type, env, computing: true });
  const dist = TYPES[type].createEngine().dist(env);
  clearCaches();
  self.postMessage({ type, env, dist });
  await saveDist(key, dist);
};
