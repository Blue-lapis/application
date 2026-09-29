// 食材タイプのおてつだいボーナスのチーム効果で使う、ほかのメンバー（ライチュウ固定）のきのみエナジー。DOM に触れない。
// きのみタイプのエンジンはレベルを枠数から決め、受け取りに「常にタップ」がないので、きのみタイプの部品関数だけを使って別に計算する。
// きのみタイプのファイル（../berry/*）は読むだけで変えない。
import { AWAKE_SEC, DAY_SEC, helpsPerTap } from '../../../js/calc.js';
import { byId } from '../../../js/constants.js';
import { MONS as BERRY_MONS, amountPatterns, EVO_CAP, TEAM_OTHERS, HB_SPEED } from '../berry/constants.js';
import { mk, NO_SUBS, curveOf, mixed, segBerries, berryEnergy } from '../berry/calc.js';
import { TEAM_MEMBER, TAP_EVERY } from './constants.js';

// メンバーのサブスキル効果の合計（きのみタイプの mk に渡す形）。
const memberEffects = (subs) => subs.reduce((a, id) => {
  const s = byId[id];
  return { ...a, sp: a.sp + (s.speed || 0), inv: a.inv + (s.inv || 0), ing: a.ing + (s.ing || 0), berry: a.berry + (s.berry || 0), erb: a.erb || !!s.erb };
}, NO_SUBS);

// 受け取りの区間ごとのおてつだい回数 [日中, 睡眠中]（期待値なので小数）。
// 「常にタップ」は日中を1区間とし、所持数を見ない。睡眠中は所持数0から起床まで。
function segments(Te, env, wake, rec) {
  const f = curveOf(env, wake, rec);
  const energy = (t) => (f(t) <= 1 ? 0 : f(t));
  const every = TAP_EVERY[env.tap] || AWAKE_SEC;
  const awake = helpsPerTap(Te, energy, 0, every, AWAKE_SEC);
  const sleep = helpsPerTap(Te, energy, AWAKE_SEC, DAY_SEC - AWAKE_SEC, DAY_SEC - AWAKE_SEC);
  return [...awake.map((n) => [n, 0]), [0, sleep.reduce((a, b) => a + b, 0)]];
}

// メンバー1匹の1日のきのみエナジー。sp はおてつだいボーナスで上がるおてつだいスピード（0 か HB_SPEED）。
// lv は検証のために変えられるようにしておく（きのみタイプの計算と突き合わせる）。
export function memberEnergy(env, sp = 0, member = TEAM_MEMBER) {
  const mon = BERRY_MONS[member.mon];
  const e = memberEffects(member.subs);
  const m = mk({ ...e, sp: e.sp + sp }, member.up, member.down);
  return mixed(env, (en) => {
    const T = Math.floor(mon.time * (1 - (member.lv - 1) * 0.002) * m.timeMul);
    const Te = en.camp ? T / 1.2 : T;
    const ingP = Math.min(1, mon.ingP * m.ingMul);
    const cap0 = mon.cap + EVO_CAP * mon.evo + m.inv;
    const cap = en.camp ? Math.ceil(cap0 * 1.2) : cap0;
    const berry = mon.berries + m.berry;
    const segs = segments(Te, en, m.wake, m.rec);
    let count = 0;
    for (const { amts, p } of amountPatterns(mon)) {
      segs.forEach(([ha, hs]) => {
        // 常にタップの日中は所持数があふれないので、食材おてつだい以外はすべてきのみ。
        if (en.tap === 'always' && hs === 0) count += p * ha * berry * (1 - ingP);
        else { const v = segBerries(cap, ha, hs, ingP, berry, amts); count += p * (v.day + v.night); }
      });
    }
    return count * berryEnergy(mon.berryBase, member.lv);
  });
}

// ほかのメンバー TEAM_OTHERS 匹のきのみエナジーの増加分の合計（おてつだいボーナスありとなしの差）。
const cache = new Map();
export function teamGain(env) {
  const k = [env.camp, env.heal, env.healAmt, env.healTimes, env.tap].join('|');
  if (!cache.has(k)) cache.set(k, TEAM_OTHERS * (memberEnergy(env, HB_SPEED) - memberEnergy(env, 0)));
  return cache.get(k);
}
export { TEAM_OTHERS };
