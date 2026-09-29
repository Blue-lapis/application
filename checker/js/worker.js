import { TYPES } from './types.js';
import { clearCaches } from './engine.js';
import { cacheKey, loadDist, saveDist } from './distcache.js';

// 保存してある分布があればそれを返し、なければ計算して保存する。
// 計算が必要なときは先に { computing: true } を送り、画面に「計算中」と出せるようにする。
// 途中の値のキャッシュは5枠の分布1つで数百MBになるので、分布ごとに新しいエンジンで計算し、終わったら捨てる。
self.onmessage = async ({ data: { type, env } }) => {
  const key = cacheKey(type, env);
  const saved = await loadDist(key);
  if (saved) {
    self.postMessage({ type, env, dist: saved });
    return;
  }
  self.postMessage({ type, env, computing: true });
  const dist = TYPES[type].createEngine().dist(env);
  clearCaches();
  self.postMessage({ type, env, dist });
  await saveDist(key, dist);
};
