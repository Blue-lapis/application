// 結果（ver1.11 で ui.js から分けた）。くわしい数値の行、タイプごとの期待値の表示、確率の注記。
import { ingOpen, NAT, natsOf } from '../../../js/constants.js';
import { trunc, mmss } from '../../../js/format.js';
import { eff } from '../../../js/calc.js';
import { arrName } from '../ingredient/constants.js';
import { slotsOf, ingEnergy, recipeMulOf } from '../ingredient/calc.js';
import { TEAM_OTHERS } from '../berry/constants.js';
import { boostedEnergy } from '../berry/calc.js';
import { ingIcon } from '../ingicons.js';
import { icon } from '../dom.js';
import { state, hasMon, monData, currentSubs, currentArr, isComplete, canRate, env, ingByEnergy } from '../state.js';
import { $, def, withUnit } from './common.js';
import { healText, tapText, genkiText, boostText, recipeText } from './params.js';

// 性能の行。'grp' は見出し行。
const ROWS = {
  ingredient: [
    ['grp', 'おてつだい'], ['rTime', 'おてつだい時間'], ['rCut', '時間の短縮'], ['rHelps', '1日のおてつだい回数'], ['rGenki', 'げんき'],
    ['grp', '食材'], ['rIng', '食材確率'], ['rAmt', '1回あたりの狙い食材'], ['rIngHelps', '1日の食材おてつだい回数'],
    ['rIngList', '1日の食材の個数'], ['rCap', '最大所持数'], ['rFull', '睡眠中に満タンになる確率'],
    ['grp', '狙い食材の内訳'], ['rSelf', '自分の狙い食材'], ['rTeam', `おてボによるほかの${TEAM_OTHERS}匹の増加`],
    ['grp', '無補正個体との比較'], ['rBase', '無補正個体の1日個数'], ['rDRatio', '1日の個数の比（評価の基準）'], ['rGe', '同等以上の個体になる確率'], ['rOdds', '平均何匹に1匹'], ['rPos', '性能値の順位（参考）'],
  ],
  // 食材タイプをエナジーで評価するとき（ver1.12）。食材の行は同じで、内訳と比較をエナジーにする。
  ingredientEnergy: [
    ['grp', 'おてつだい'], ['rTime', 'おてつだい時間'], ['rCut', '時間の短縮'], ['rHelps', '1日のおてつだい回数'], ['rGenki', 'げんき'],
    ['grp', '食材・きのみ'], ['rIng', '食材確率'], ['rAmt', '1回あたりの食材'], ['rIngHelps', '1日の食材おてつだい回数'],
    ['rIngList', '1日の食材の個数'], ['rBerryN', '1日のきのみの個数'], ['rCap', '最大所持数'], ['rFull', '睡眠中に満タンになる確率'],
    ['grp', 'エナジーの内訳'], ['rIngE', '食材のエナジー'], ['rBerryE', 'きのみのエナジー'], ['rSelf', '自分のエナジー'], ['rTeam', `おてボによるほかの${TEAM_OTHERS}匹の増加`],
    ['grp', '無補正個体との比較'], ['rBase', '無補正個体の1日エナジー'], ['rDRatio', '1日のエナジーの比（評価の基準）'], ['rGe', '同等以上の個体になる確率'], ['rOdds', '平均何匹に1匹'], ['rPos', '性能値の順位（参考）'],
  ],
  berry: [
    ['grp', 'おてつだい'], ['rTime', 'おてつだい時間'], ['rCut', '時間の短縮'], ['rHelps', '1日のおてつだい回数'], ['rGenki', 'げんき'],
    ['grp', 'きのみ'], ['rEnergy', 'きのみ1個のエナジー'], ['rAmt', '1回あたりのきのみ'], ['rCount', '1日のきのみの個数'],
    ['grp', '所持数'], ['rIng', '食材確率（満タンまで）'], ['rCap', '最大所持数'], ['rFull', '就寝時までに満タンになる確率'],
    ['rIngs', '1日に持ち帰る食材'],
    ['grp', 'エナジーの内訳'], ['rSelf', '自分のきのみエナジー'], ['rTeam', `おてボによるほかの${TEAM_OTHERS}匹の増加`],
    ['grp', '無補正個体との比較'], ['rBase', '無補正個体の1日エナジー'], ['rDRatio', '1日のエナジーの比（評価の基準）'], ['rGe', '同等以上の個体になる確率'], ['rOdds', '平均何匹に1匹'], ['rPos', '性能値の順位（参考）'],
  ],
  skill: [
    ['grp', 'おてつだい'], ['rTime', 'おてつだい時間'], ['rCut', '時間の短縮'], ['rHelps', '1日のおてつだい回数'],
    ['rGenki', 'げんき'], ['rCap', '最大所持数'], ['rIng', '食材おてつだい確率'], ['rRoll', '睡眠中のスキル抽選'],
    ['grp', 'スキル'], ['rRate', 'スキル確率'], ['rEff', '天井込みの実質確率'], ['rAvg', '発動までの平均おてつだい'], ['rAvgT', '発動までの平均時間'],
    ['grp', '発動回数の内訳'], ['rSelf', '自分の発動回数'], ['rTeam', `おてボによるほかの${TEAM_OTHERS}匹の増加`],
    ['grp', '無補正個体との比較'], ['rBase', '無補正個体の1日回数'], ['rDRatio', '1日の回数の比（評価の基準）'], ['rGe', '同等以上の個体になる確率'], ['rOdds', '平均何匹に1匹'], ['rPos', '性能値の順位（参考）'],
  ],
};

// くわしい数値の枠（見出しごとに開閉する）。最初の見出しだけ開いておく。値は render*Stats が入れる。
// type は ROWS のキー（rowsKey）。
export const rowsKey = () => (ingByEnergy() ? 'ingredientEnergy' : state.type);
export function rowsHtml(type) {
  const groups = [];
  ROWS[type].forEach(([id, label]) => {
    if (id === 'grp') groups.push({ label, rows: [] });
    else groups[groups.length - 1].rows.push(`<dt>${label}</dt><dd id="${id}">—</dd>`);
  });
  return groups.map((g, i) => `<details${i === 0 ? ' open' : ''}><summary>${g.label}`
    + icon('<path d="M6 9l6 6 6-6"/>', 18, 2.2)
    + `</summary><dl class="rows">${g.rows.join('')}</dl></details>`).join('');
}

// 計算条件の表示。r は daily の結果（起床時のげんき wakeE）。
const condText = (m, e, r) => {
  const recText = m.rec > 1 ? '・げんき回復量↑1.2倍' : m.rec < 1 ? '・げんき回復量↓0.88倍' : '';
  return `Lv.${state.lv}・睡眠8.5時間・${healText(e)}${e.heal === 'g80' ? '' : `・起床時げんき${r.wakeE}${recText}`}・${tapText(e)}`;
};
const genkiRow = (r, e) => (e.heal === 'g80' ? '常に81%以上' : `${genkiText(r.genki)}<span>起床時${r.wakeE}・${e.heal ? `ヒーラー${e.heal}匹` : 'ヒーラーなし'}</span>`);
const timeRows = (r, m, e) => {
  const Tm = Math.floor(r.Te / 60), Ts = Math.floor(r.Te % 60);
  $('rTime').innerHTML = `${Tm}分${String(Ts).padStart(2, '0')}秒<span>${e.camp ? 'チケット込み・' : ''}げんき補正前</span>`;
  const cut = (1 - m.timeMul) * 100;
  $('rCut').innerHTML = `${cut >= 0 ? '−' : '+'}${trunc(Math.abs(cut))}%<span>性格・サブスキル合計</span>`;
  $('rHelps').innerHTML = `${(r.Ha + r.Hs).toFixed(1)}回<span>日中${r.Ha.toFixed(1)}回・睡眠中${r.Hs.toFixed(1)}回</span>`;
};
// 結果カードの横棒。日中と睡眠中の割合を幅で見せる（値がないときは空）。
const setSplit = (day, night) => {
  const all = day + night;
  $('hSplit').style.width = all > 0 ? `${(day / all) * 100}%` : '0';
};
// きのみタイプのチームへの効果の行。v が null なら隠し、日中・睡眠中の見出しも元に戻す。
// 出すときは、日中・睡眠中が自分の分だけだとわかるように見出しに「自分」を付ける。
function heroTeam(v, label = `おてボによるほかの${TEAM_OTHERS}匹の増加`) {
  $('hTeamL').textContent = label;
  $('hTeamW').hidden = v === null;
  $('hTeam').textContent = v ?? '';
  $('hDayL').textContent = v === null ? '日中' : '自分・日中';
  $('hNightL').textContent = v === null ? '睡眠中' : '自分・睡眠中';
}
// 未選択のサブスキル・性格は「なし他」・無補正として計算する。
// 順位の基準は、自分の狙い食材の個数＋おてボでほかの4匹（同じポケモン）が増やす狙い食材の個数。
function renderIngStats(engine) {
  const e = env(), mm = monData();
  const m = def().mults(currentSubs(), state.up, state.down);
  const tName = mm.ings[state.target];

  // 食材配列が決まっていれば、エナジーで評価するときの基準はその配列の無補正個体。
  const arrOk = !currentArr().includes(null);
  const ref = engine.reference(e, arrOk ? state.arr : undefined);
  const byE = ingByEnergy();
  $('rBase').innerHTML = byE ? `${Math.round(ref.v).toLocaleString()}<span>${arrName(mm, ref.arr)}・無補正</span>`
    : `${ref.v.toFixed(1)}個<span>${arrName(mm, ref.arr)}・無補正</span>`;

  // 食材配列が決まるまでは、無補正基準の配列で時間・確率などを表示する。
  const r = engine.daily(m, arrOk ? state.arr : ref.arr, e);
  $('cond').textContent = condText(m, e, r);
  $('hLabel').textContent = byE ? '1日のエナジー（食材＋きのみ）' : `1日の${mm.short[state.target]}`;
  timeRows(r, m, e);
  $('rGenki').innerHTML = genkiRow(r, e);
  $('rIng').innerHTML = `${(r.ingP * 100).toFixed(1)}%<span>基礎${+(mm.ingP * 100).toFixed(2)}% × ${m.ingMul.toFixed(3)}</span>`;
  $('rIngHelps').innerHTML = `${((r.Ha + r.Hs) * r.ingP).toFixed(1)}回<span>所持数あふれを除く</span>`;
  $('rCap').innerHTML = `${r.cap}個<span>基礎${mm.cap}＋進化${mm.evo}回×5＋サブスキル${e.camp ? '・チケット込み' : ''}・きのみ${m.berry}個</span>`;

  if (!arrOk) {
    ['hAll', 'hDay', 'hNight', 'rAmt', 'rIngList', 'rFull', 'rSelf', 'rTeam', 'rBerryN', 'rIngE', 'rBerryE'].forEach((id) => { if ($(id)) $(id).textContent = '—'; });
    setSplit(0, 0);
    $('rDRatio').textContent = '—';
    return;
  }
  const slots = slotsOf(mm, state.arr, ingOpen(state.lv));
  const tAmt = slots.reduce((s, [ing, a]) => s + (ing === state.target ? a : 0), 0) / slots.length;
  const allAmt = slots.reduce((s, [, a]) => s + a, 0) / slots.length;
  const tDay = r.day[tName] || 0, tNight = r.night[tName] || 0, self = tDay + tNight;
  const team = engine.team(m, e, state.arr);
  const showTeam = e.team && m.hb;
  if (byE) {
    renderIngEnergy(r, m, e, mm, slots, ref, team, showTeam);
    return;
  }

  $('hAll').innerHTML = withUnit(self.toFixed(1), '個');
  $('hDay').textContent = tDay.toFixed(1);
  $('hNight').textContent = tNight.toFixed(1);
  setSplit(tDay, tNight);
  heroTeam(showTeam ? `+${team.toFixed(1)}個` : null);

  $('rAmt').innerHTML = `${tAmt.toFixed(2)}個<span>全食材${allAmt.toFixed(2)}個</span>`;
  const names = [...new Set(slots.map(([k]) => mm.ings[k]))];
  $('rIngList').innerHTML = names.map((n) => {
    const k = Object.keys(mm.ings).find((x) => mm.ings[x] === n);
    return `${ingIcon(n)}${mm.short[k]} ${((r.day[n] || 0) + (r.night[n] || 0)).toFixed(1)}個`;
  }).join('<br>');
  $('rFull').innerHTML = `${(r.full * 100).toFixed(1)}%<span>あふれた食材 平均${r.lost.toFixed(1)}個</span>`;
  $('rSelf').innerHTML = `${self.toFixed(1)}個<span>日中${tDay.toFixed(1)}個・睡眠中${tNight.toFixed(1)}個</span>`;
  $('rTeam').innerHTML = !e.team ? '—<span>含めない設定</span>'
    : !m.hb ? '0個<span>おてつだいボーナスなし</span>'
      : `+${team.toFixed(1)}個<span>1匹あたり+${(team / TEAM_OTHERS).toFixed(1)}個（同じポケモン・${arrName(mm, ref.arr)}・無補正）</span>`;
  $('rDRatio').textContent = canRate() ? `${((self + team) / ref.v).toFixed(2)}倍` : '—';
}
// 食材タイプをエナジーで評価するとき（ver1.12）。すべての食材のエナジーと、きのみのエナジー（フィールドボーナスなし）の合計。
function renderIngEnergy(r, m, e, mm, slots, ref, team, showTeam) {
  const be = r.berryInfo.energy, mul = recipeMulOf(e);
  const ingDay = ingEnergy(r.day, mul), ingNight = ingEnergy(r.night, mul);
  const day = ingDay + r.berryDay * be, night = ingNight + r.berryNight * be, self = day + night;
  const berries = r.berryDay + r.berryNight;
  const fmt = (x) => Math.round(x).toLocaleString();
  $('hAll').textContent = fmt(self);
  $('hDay').textContent = fmt(day);
  $('hNight').textContent = fmt(night);
  setSplit(day, night);
  heroTeam(showTeam ? `+${fmt(team)}` : null);

  const allAmt = slots.reduce((s, [, a]) => s + a, 0) / slots.length;
  $('rAmt').innerHTML = `${allAmt.toFixed(2)}個<span>開いている${slots.length}枠の平均</span>`;
  const names = [...new Set(slots.map(([k]) => mm.ings[k]))];
  $('rIngList').innerHTML = names.map((n) => {
    const k = Object.keys(mm.ings).find((x) => mm.ings[x] === n);
    return `${ingIcon(n)}${mm.short[k]} ${((r.day[n] || 0) + (r.night[n] || 0)).toFixed(1)}個`;
  }).join('<br>');
  $('rBerryN').innerHTML = `${berries.toFixed(1)}個<span>1回${r.berry}個${m.berry > 1 ? '（きのみの数S）' : ''}・満タン後もきのみを拾う</span>`;
  $('rFull').innerHTML = `${(r.full * 100).toFixed(1)}%<span>あふれた食材 平均${r.lost.toFixed(1)}個</span>`;
  $('rIngE').innerHTML = `${fmt(ingDay + ingNight)}<span>${recipeText()}（料理の倍率${mul.toFixed(3)}倍）</span>`;
  $('rBerryE').innerHTML = `${fmt(berries * be)}<span>${r.berryInfo.name} Lv.${r.LV} 1個${be}</span>`;
  $('rSelf').innerHTML = `${fmt(self)}<span>日中${fmt(day)}・睡眠中${fmt(night)}</span>`;
  $('rTeam').innerHTML = !e.team ? '—<span>含めない設定</span>'
    : !m.hb ? '0<span>おてつだいボーナスなし</span>'
      : `+${fmt(team)}<span>1匹あたり+${fmt(team / TEAM_OTHERS)}（同じポケモン・${arrName(mm, ref.arr)}・無補正）</span>`;
  $('rDRatio').textContent = canRate() ? `${((self + team) / ref.v).toFixed(2)}倍` : '—';
}
function renderBerryStats(engine) {
  const e = env(), mm = monData();
  const m = def().mults(currentSubs(), state.up, state.down);
  const base = engine.baseMetric(e);
  const r = engine.daily(m, e);
  $('cond').textContent = `${condText(m, e, r)}・食材配列は捕獲時の出現率で平均`;
  $('hLabel').textContent = e.team ? '1日のエナジー（チームへの効果込み）' : '1日のきのみエナジー';

  // フィールドボーナス・好きなきのみは、きのみ1個のエナジーを変えるだけなので、表示の段で同じ比率 k を掛ける。
  // 自分・チームへの効果・無補正の個体に同じ比率が掛かるので、無補正比は変わらない。
  const energy = boostedEnergy(r.energy, state.fieldBonus, state.fav);
  const k = energy / r.energy;
  const count = r.day + r.night;
  const self = count * energy;
  const team = engine.teamGain(m, e) * k;
  const total = self + team;
  const baseE = base * k;
  // 日中・睡眠中は自分のきのみの分。チームへの効果があるときは別の行に出す。
  const showTeam = e.team && m.hb;
  $('hAll').textContent = Math.round(total).toLocaleString();
  $('hDay').textContent = Math.round(r.day * energy).toLocaleString();
  $('hNight').textContent = Math.round(r.night * energy).toLocaleString();
  setSplit(r.day, r.night);
  heroTeam(showTeam ? `+${Math.round(team).toLocaleString()}` : null);

  timeRows(r, m, e);
  $('rEnergy').innerHTML = `${energy}<span>${mm.berry} Lv.${r.LV}${k !== 1 ? `・${r.energy}に${boostText()}を掛けて切り上げ` : ''}</span>`;
  $('rAmt').innerHTML = `${r.berry}個<span>${m.berry ? `基礎${mm.berries}個＋きのみの数S` : 'きのみタイプ'}</span>`;
  $('rCount').innerHTML = `${count.toFixed(1)}個<span>日中${r.day.toFixed(1)}個・睡眠中${r.night.toFixed(1)}個</span>`;
  $('rIng').innerHTML = `${(r.ingP * 100).toFixed(1)}%<span>基礎${+(mm.ingP * 100).toFixed(2)}% × ${m.ingMul.toFixed(3)}</span>`;
  $('rCap').innerHTML = `${r.cap}個<span>基礎${mm.cap}＋進化${mm.evo}回×5＋サブスキル${e.camp ? '・チケット込み' : ''}</span>`;
  const pct = (x) => `${(Math.max(0, x) * 100).toFixed(1)}%`;
  $('rFull').innerHTML = e.tap === 'none' ? '100%<span>受け取らないので常に満タン</span>'
    : `${pct(r.fullBed)}<span>就寝前の受け取りまで・睡眠中は起床時まで${pct(r.full)}</span>`;
  $('rIngs').innerHTML = `${r.ings.toFixed(1)}個<span>満タンになるまで</span>`;
  $('rGenki').innerHTML = genkiRow(r, e);
  $('rSelf').innerHTML = `${Math.round(self).toLocaleString()}<span>日中${Math.round(r.day * energy).toLocaleString()}・睡眠中${Math.round(r.night * energy).toLocaleString()}</span>`;
  $('rTeam').innerHTML = !e.team ? '—<span>含めない設定</span>'
    : !m.hb ? '0<span>おてつだいボーナスなし</span>'
      : `+${Math.round(team).toLocaleString()}<span>1匹あたり+${Math.round(team / TEAM_OTHERS).toLocaleString()}（同じポケモン・無補正）</span>`;
  $('rBase').innerHTML = `${Math.round(baseE).toLocaleString()}<span>無補正${k !== 1 ? '（同じエナジーの補正）' : ''}</span>`;
  $('rDRatio').textContent = isComplete() ? `${(total / baseE).toFixed(2)}倍` : '—';
}
// 順位の基準は、自分の発動回数＋おてボでほかの4匹（同じポケモン）が増やす発動回数。
function renderSkillStats(engine) {
  const e = env(), mm = monData();
  const m = def().mults(currentSubs(), state.up, state.down);
  const base = engine.baseMetric(e);
  const r = engine.daily(m, e);
  $('cond').textContent = `${condText(m, e, r)}・食材配列は捕獲時の出現率で平均`;
  $('hLabel').textContent = '1日の期待発動回数';

  const self = r.day + r.night;
  const team = engine.team(m, e);
  const showTeam = e.team && m.hb;
  const p = eff(r.p, r.ceil);
  const avgHelps = 1 / p;
  $('hAll').innerHTML = withUnit(self.toFixed(2), '回');
  $('hDay').textContent = r.day.toFixed(2);
  $('hNight').textContent = r.night.toFixed(2);
  setSplit(r.day, r.night);
  heroTeam(showTeam ? `+${team.toFixed(2)}回` : null);

  timeRows(r, m, e);
  $('rGenki').innerHTML = genkiRow(r, e);
  $('rCap').innerHTML = `${r.cap}個<span>基礎${mm.cap}＋進化${mm.evo}回×5＋サブスキル${e.camp ? '・チケット込み' : ''}</span>`;
  $('rIng').innerHTML = `${(r.ingP * 100).toFixed(1)}%<span>基礎${+(mm.ingP * 100).toFixed(2)}% × ${m.ingMul.toFixed(3)}・きのみ${m.berry}個</span>`;
  $('rRoll').innerHTML = `${r.rolls.toFixed(1)}回<span>睡眠中${r.Hs.toFixed(1)}回のうち・満タン確率${(r.full * 100).toFixed(1)}%</span>`;
  $('rRate').innerHTML = `${(r.p * 100).toFixed(2)}%<span>基礎${+(mm.skillP * 100).toFixed(2)}% × ${m.skillMul.toFixed(3)}</span>`;
  $('rEff').innerHTML = `${(p * 100).toFixed(2)}%<span>${r.ceil}回目で確定を含む平均</span>`;
  $('rAvg').textContent = `${avgHelps.toFixed(1)}回`;
  $('rAvgT').innerHTML = `${mmss(avgHelps * r.Te * 0.45)}<span>げんき81%以上のとき</span>`;
  $('rSelf').innerHTML = `${self.toFixed(2)}回<span>日中${r.day.toFixed(2)}回・睡眠中${r.night.toFixed(2)}回</span>`;
  $('rTeam').innerHTML = !e.team ? '—<span>含めない設定</span>'
    : !m.hb ? '0回<span>おてつだいボーナスなし</span>'
      : `+${team.toFixed(2)}回<span>1匹あたり+${(team / TEAM_OTHERS).toFixed(2)}回（同じポケモン・無補正）</span>`;
  $('rBase').innerHTML = `${base.toFixed(2)}回<span>無補正</span>`;
  $('rDRatio').textContent = isComplete() ? `${((self + team) / base).toFixed(2)}倍` : '—';
}

// 今のタイプの期待値を描く。チームへの効果の行は、いったん隠してからタイプごとに出す。
export function renderStats(engine) {
  heroTeam(null);
  ({ ingredient: renderIngStats, berry: renderBerryStats, skill: renderSkillStats })[state.type](engine);
}

// 同等以上の確率・平均何匹に1匹・性能値の順位の意味と、確率の前提（抽選条件）。
export function renderRankNote() {
  const lv60 = ingOpen(state.lv) >= 3 ? '、Lv.60 は3候補を等確率' : '。Lv.60 の枠はまだ開いていないので使わない';
  const arr = ingByEnergy() ? '食材配列はこの個体と同じものだけ（同じ食材配列の個体の中での確率）、'
    : state.type === 'ingredient' ? `食材配列は捕獲時の出現率（Lv.30 は A 1/3・B 2/3${lv60}）、` : `食材配列は捕獲時の出現率で平均${ingOpen(state.lv) >= 3 ? '' : '（Lv.60 の枠は使わない）'}、`;
  // ストリンダーは姿に付く性格だけを数える。
  const k = hasMon() ? natsOf(monData()).length : NAT.length;
  const natText = k < NAT.length ? `は${monData().name}に付く${k}種` : `${NAT.length}種`;
  $('rankNote').textContent = '「同等以上の確率」は、同じポケモン・同じパラメーターで、サブスキルを1枠ずつ色（金14%・青33%・白53%）で抽選して'
    + `その色の未所持のものから均等に選び、性格${natText}を等確率とした場合（${arr}フレンドメダルによる金枠確定なし）に、`
    + 'この個体の無補正比以上になる推定確率です。「平均何匹に1匹」はその逆数（丸める前の確率から計算）です。'
    + '「性能値の順位」は、無補正比が異なる組み合わせの中での順位で、組み合わせごとの出やすさを考えないため、確率とは一致しません（参考値）。';
}
