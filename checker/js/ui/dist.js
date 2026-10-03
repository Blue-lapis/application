// 上位%の分布の依頼（ver1.11 で ui.js から分けた）。分布の計算は Worker（../worker.js）で1つずつ行う。
// 画面のほかのファイルには、initDist・requestDist・isComputing だけを出す。
import { LEVELS } from '../../../js/constants.js';
import { state, hasMon, canRate, env, distReady } from '../state.js';

let worker = null;
// Worker で計算している分布 { type, env }。
let inFlight = null;
// 保存してなかったので計算している分布（タイプと条件の組）。読み込み中は「…」、計算中は「計算中」と出す。
const computing = new Set();
const jobKey = (type, e) => `${type}|${JSON.stringify(e)}`;
// タイプごとの計算エンジン。分布が届いたら setDist で渡す。
let engines = null;
// 分布が届いたときと計算を始めたときに呼ぶ（帯と記録の一覧を描き直す）。
let onChange = () => {};
// 今のポケモンの分のあとに頼む分布 [{ type, env }]。
let extraJobs = () => [];

// 計算中か（読み込み中は false）。
export const isComputing = (type, e) => computing.has(jobKey(type, e));

export function initDist(eng, opts) {
  engines = eng;
  ({ onChange, extraJobs } = opts);
  startWorker();
}

// 分布の計算は Worker で1つずつ行う。終わったら次の分布を頼む。
function startWorker() {
  // Keeps the version tag on the worker URL so it loads the same module set as this page.
  worker = new Worker(new URL(`../worker.js${new URL(import.meta.url).search}`, import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.computing) {
      computing.add(jobKey(data.type, data.env));
      onChange();
      return;
    }
    computing.delete(jobKey(data.type, data.env));
    engines[data.type].setDist(data.env, data.dist);
    inFlight = null;
    onChange();
    requestDist();
  };
}

// 今の条件の分布を頼み、あればチケットのあり・なしを切り替えた条件を先に計算しておく（その場で切り替えられるため）。
// 今の条件の分布がないのに別の条件を計算しているとき（ポケモンや条件を変えた直後）は、その計算をやめて今の条件から始める。
// 未選択のときは分布を頼まない（Worker・IndexedDB・事前計算のファイルに触れない）。
export function requestDist() {
  if (!hasMon()) return;
  const type = state.type, engine = engines[type];
  const cur = env();
  if (inFlight) {
    if (engine.ready(cur) || jobKey(inFlight.type, inFlight.env) === jobKey(type, cur)) return;
    worker.terminate();
    computing.delete(jobKey(inFlight.type, inFlight.env));
    inFlight = null;
    startWorker();
  }
  // そのあとに、レベル別の一覧で使うほかのレベルの分布（確率を出せるレベルだけ）。
  const others = LEVELS.filter((lv) => lv !== state.lv && canRate(lv)).map((lv) => env(lv));
  // エナジーで評価するときは、食材配列がそろうまで分布を頼まない（同じ食材配列の個体の分布なので）。
  const next = [cur, { ...cur, camp: !cur.camp }, ...others].find((e) => distReady(e) && !engine.ready(e));
  if (next) {
    inFlight = { type, env: next };
    worker.postMessage({ type, env: next });
    return;
  }
  // そのあとに、extraJobs が返す分布（記録の一覧を開いている間の、ほかのポケモン・レベルの記録の分布）を1つずつ読み込む（または計算する）。
  const job = extraJobs().find((x) => !engines[x.type].ready(x.env));
  if (!job) return;
  inFlight = job;
  worker.postMessage(job);
}
