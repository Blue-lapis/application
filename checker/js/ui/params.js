// 条件（ver1.11 で ui.js から分けた）。条件の欄の切り替え、詳細のダイアログ、条件の文言。
import { HEAL_AMT, HEAL_TIMES, TEAM_OTHERS, FIELD_BONUS } from '../berry/constants.js';
import { energyAt } from '../engine.js';
import { RECIPE_BONUSES, RECIPE_BONUS, RECIPE_LEVEL, RECIPE_LEVEL_BONUS, recipeMul } from '../ingredient/energy.js';
import {
  state, monData, hasMon, env, PARAM_LIMITS, setCamp, setLevel, setHeal, setTap, setIngTap, setTeam, setFav, setParam, setIngBy, setRecipeBonus,
} from '../state.js';
import { $ } from './common.js';

// 入力が変わったときの描き直し（ui.js の refresh）。initParams で受け取る。
let refresh = () => {};

// パラメーター。日中の受け取りといいキャンプチケットはその場で切り替え、
// ヒーラー・げんき・チームへの効果・げんきオールS の回復量と発動回数は詳細のダイアログで変える。
export const healText = (e) => (e.heal === 'g80' ? 'げんき常時81%以上'
  : e.heal ? `ヒーラー${e.heal}匹（げんきオールS ${e.healAmt}×${e.healTimes}回/日）` : 'ヒーラーなし');
const teamText = (e) => `おてボのチーム効果を${e.team ? '含める' : '含めない'}`;
export const tapText = (e) => (e.tap === '3h' ? '起床中は3時間ごとと就寝時に受け取る'
  : e.tap === 'always' ? '日中は常時タップ（所持数はあふれない）' : '受け取らない（ずっといつのまに育成）');
export const genkiText = (g) => `就寝時${g.bed}→起床前${g.end}`;
// きのみのエナジーの補正（きのみタイプだけ）。既定のとき（ボーナス0%・好きでない）は null。
export const boostText = () => {
  const t = [state.fieldBonus ? `フィールドボーナス+${state.fieldBonus}%` : '', state.fav ? '好きなきのみ' : ''].filter(Boolean);
  return t.length ? t.join('・') : null;
};
// 料理の倍率（食材タイプをエナジーで評価するときだけ）。
export const recipeText = () => (state.recipeBonus === 0 ? 'レシピボーナスなし（ミックス料理）'
  : `レシピボーナス${state.recipeBonus}%・レシピLv.${state.recipeLevel}`);

// パラメーターの切り替え。[要素の id, 今の値をボタンの data-v と同じ文字列にする関数, data-v から値を設定する関数]。
const SEGS = [
  ['lvSeg', () => String(state.lv), (v) => setLevel(+v)],
  ['healSeg', () => String(state.heal), (v) => setHeal(v === 'g80' ? v : +v)],
  ['tapSeg', () => state.tap, setTap],
  ['ingTapSeg', () => state.ingTap, setIngTap],
  ['ingBySeg', () => state.ingBy, setIngBy],
  ['campSeg', () => (state.camp ? '1' : '0'), (v) => setCamp(v === '1')],
  ['teamSeg', () => (state.team ? '1' : '0'), (v) => setTeam(v === '1')],
  ['favSeg', () => (state.fav ? '1' : '0'), (v) => setFav(v === '1')],
];

export function initParams({ refresh: redraw }) {
  refresh = redraw;
  SEGS.forEach(([id, , set]) => $(id).querySelectorAll('button').forEach((b) => {
    b.onclick = () => { set(b.dataset.v); refresh(); };
  }));

  $('paramBtn').onclick = () => { renderParamDlg(); $('paramDlg').showModal(); };
  $('paramClose').onclick = () => $('paramDlg').close();
  $('paramDlg').addEventListener('click', (e) => { if (e.target === $('paramDlg')) $('paramDlg').close(); });
  // 範囲外の値は受け付けず、入力欄を今の値に戻す。
  $('recipeBonus').innerHTML = RECIPE_BONUSES.map(([v, t]) => `<option value="${v}">${v}%（${t}）</option>`).join('');
  $('recipeBonus').addEventListener('change', () => { setRecipeBonus(Number($('recipeBonus').value)); refresh(); });
  ['healAmt', 'healTimes', 'fieldBonus', 'recipeLevel'].forEach((k) => {
    $(k).addEventListener('change', () => {
      if (!setParam(k, Number($(k).value))) $(k).value = state[k];
      refresh();
    });
  });
  $('paramReset').onclick = () => {
    setParam('healAmt', HEAL_AMT);
    setParam('healTimes', HEAL_TIMES);
    setParam('fieldBonus', FIELD_BONUS);
    setFav(false);
    setIngBy('count');
    setRecipeBonus(RECIPE_BONUS);
    setParam('recipeLevel', RECIPE_LEVEL);
    refresh();
  };
  // 回復量・発動回数・レシピレベルの −／＋ は1ずつ動かす（発動回数の小数はそのまま残す）。範囲の端で止める。
  ['healAmt', 'healTimes', 'recipeLevel'].forEach((k) => {
    const [lo, hi] = PARAM_LIMITS[k];
    [['Down', -1], ['Up', 1]].forEach(([id, d]) => {
      $(k + id).onclick = () => {
        setParam(k, Math.min(hi, Math.max(lo, Math.round((state[k] + d) * 100) / 100)));
        refresh();
      };
    });
  });
  // フィールドボーナスは手入力なら整数で1%単位。−／＋ は5の倍数に揃えながら5%ずつ動かす（33 なら＋で35、−で30）。範囲の端で止める。
  const [bMin, bMax] = PARAM_LIMITS.fieldBonus;
  [['bonusDown', -5], ['bonusUp', 5]].forEach(([id, d]) => {
    $(id).onclick = () => {
      const v = d > 0 ? Math.floor(state.fieldBonus / 5) * 5 + 5 : Math.ceil(state.fieldBonus / 5) * 5 - 5;
      setParam('fieldBonus', Math.min(bMax, Math.max(bMin, v)));
      refresh();
    };
  });
}

export function renderParams() {
  // 性能の欄と詳細のダイアログの両方で、タイプに合う行だけを出す。
  document.querySelectorAll('[data-for]').forEach((row) => { row.hidden = !row.dataset.for.split(' ').includes(state.type); });
  SEGS.forEach(([id, cur]) => $(id).querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(cur() === b.dataset.v))));
  // 詳細のダイアログにある設定の要約。
  const e = env();
  // 食材タイプをエナジーで評価しているときは、いちばん前に出す（既定の狙い食材の個数と違うことがすぐわかるように）。
  $('paramSum').textContent = [
    state.type === 'ingredient' && state.ingBy === 'energy' ? `エナジーで評価（${recipeText()}）` : null,
    e.heal === 'g80' ? healText(e) : `${healText(e)}・げんき${genkiText(energyAt(e, 100))}`,
    teamText(e),
    state.type === 'berry' ? boostText() : null,
  ].filter(Boolean).join('・');
  if ($('paramDlg').open) renderParamDlg();
}

function renderParamDlg() {
  ['healAmt', 'healTimes', 'fieldBonus', 'recipeLevel'].forEach((k) => {
    if (document.activeElement !== $(k)) $(k).value = state[k];
  });
  $('recipeBonus').value = String(state.recipeBonus);
  $('recipeLevel').disabled = state.recipeBonus === 0;
  $('recipeNote').textContent = `食材1個のエナジーを ((1＋レシピボーナス) × (1＋レシピレベルのボーナス${state.recipeBonus === 0 ? '' : ` ${RECIPE_LEVEL_BONUS[state.recipeLevel]}%`}) × 0.8 ＋ 0.2) 倍します`
    + `（料理に使う食材を8割とみなす。にとよんツールと同じ）。今は ${recipeMul(state.recipeBonus, state.recipeLevel).toFixed(3)} 倍。`
    + `きのみのエナジーには掛からないので、食材ときのみの比率が変わり、無補正比・確率も変わります。${state.ingBy === 'energy' ? '' : '「評価」が「狙い食材の個数」のときは使いません。'}`;
  ['healAmt', 'healTimes', 'recipeLevel'].forEach((k) => {
    $(k + 'Down').disabled = state[k] <= PARAM_LIMITS[k][0];
    $(k + 'Up').disabled = state[k] >= PARAM_LIMITS[k][1];
  });
  const e = env();
  if (state.type === 'berry') {
    const mm = hasMon() ? monData() : null;
    $('favLbl').textContent = mm ? `${mm.name}のきのみ（${mm.berry}）を好きなきのみとして扱う` : '選んだポケモンのきのみを好きなきのみとして扱う';
    const [bMin, bMax] = PARAM_LIMITS.fieldBonus;
    $('bonusDown').disabled = state.fieldBonus <= bMin;
    $('bonusUp').disabled = state.fieldBonus >= bMax;
  }
  const teamNote = state.type === 'ingredient' && state.ingBy === 'energy'
    ? `。おてボのチーム効果は、ほかの${TEAM_OTHERS}匹を同じポケモン（同じ食材配列・サブスキルなし・無補正性格）として、おてつだいボーナスで増えるエナジーを足します。ヒーラーの設定は3タイプで共通です。`
    : state.type === 'ingredient'
    ? `。おてボのチーム効果は、ほかの${TEAM_OTHERS}匹を同じポケモン（狙い食材が最も多い食材配列・サブスキルなし・無補正性格）として、おてつだいボーナスで増える狙い食材の個数を足します。ヒーラーの設定は3タイプで共通です。`
    : state.type === 'skill'
      ? `。おてボのチーム効果は、ほかの${TEAM_OTHERS}匹を同じポケモン（サブスキルなし・無補正性格・食材配列は出現率で平均）として、おてつだいボーナスで増える発動回数を足します。ヒーラーの設定は3タイプで共通です。`
      : '';
  $('paramNote').textContent = `ヒーラーは起床中に等間隔で発動し、チーム全員のげんきを回復します（上限150）。発動回数が小数のときは、前後の整数回の日が混ざるものとして平均します。料理（10時・14時・20時）でも、そのときのげんきに応じて1〜9回復します。睡眠中は回復せず、10分ごとに1減ります。今の値でのげんき（ヒーラー1匹・起床時100）: ${genkiText(energyAt({ ...e, heal: 1 }, 100))}${teamNote}`;
}
