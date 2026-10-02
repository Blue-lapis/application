// 育成日数シミュレーター（exp/）の計算のテスト。node tests/check-exp.mjs
// 期待値は Pokémon Sleep 攻略・検証 Wiki の表と、表から手で計算した値。
import assert from 'node:assert/strict';
import { thresholds, useCandy, sleepDay, napMinutes, plan, dayKind, fullMoonMs, gsdCalendar, gsdSchedule } from '../exp/js/calc.js';
import { NAP, NATURE_RATE } from '../exp/js/data.js';
import { TOTAL_EXP, SHARDS_PER_CANDY } from '../exp/js/data.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('表の長さ', () => {
  assert.equal(TOTAL_EXP.length, 71);
  assert.equal(SHARDS_PER_CANDY.length, 71);
});

// wiki「経験値タイプ」：レベルごとの必要EXP（600タイプ）と、Lv.10→41 の合計。
ok('必要EXP', () => {
  const th = thresholds(600);
  assert.deepEqual([th[25] - th[24], th[50] - th[49], th[70] - th[69]], [600, 1066, 3255]);
  assert.equal(th[41] - th[10], 19458);
  // 900タイプは wiki が 29,197 だが、累計に1.5を掛けて丸めると 29,187（requirements §7）。
  assert.equal(thresholds(900)[41] - thresholds(900)[10], 29187);
});

// wiki「ゆめのかけら」：Lv.10 から目標までのゆめのかけらとアメ（600タイプ、性格なし）。
ok('アメとゆめのかけら（wiki の表）', () => {
  const th = thresholds(600);
  for (const [target, shards, candy] of [[25, 12623, 178], [30, 22688, 273], [50, 166155, 993], [60, 537974, 1853], [70, 1679761, 3080]]) {
    const r = useCandy({ cum: th[10], th, target, nature: 'none', candy: 99999 });
    assert.deepEqual([r.shards, r.used, r.level], [shards, candy, target], `Lv.${target}`);
  }
});

ok('アメが足りないとき・ゆめのかけらの上限', () => {
  const th = thresholds(600);
  const r = useCandy({ cum: th[10], th, target: 30, nature: 'none', candy: 100 });
  assert.equal(r.used, 100);
  assert.ok(r.level < 30);
  const s = useCandy({ cum: th[10], th, target: 30, nature: 'none', candy: 9999, shardCap: 5000 });
  assert.ok(s.shards <= 5000 && s.shards > 5000 - 100);
});

// wiki「ゴンベのおひるね島」の考察：毎日スコア100、グッドスリープデーが3日（前後と満月）ある週の睡眠EXPは 1,100、
// EXPダウンの性格は 902。睡眠EXPボーナス1つで1週間 +98（700 → 798）。
ok('睡眠EXP', () => {
  // 2026年の満月を1つ探して、その前日から3日と、前の4日の計7日を数える。
  let full = Date.UTC(2026, 0, 1) / 864e5;
  while (dayKind(full) !== 'full') full++;
  const week = [-5, -4, -3, -2, -1, 0, 1].map((k) => full + k);
  const sum = (o) => week.reduce((s, d) => s + sleepDay(d, { score: 100, bonus: 0, incense: 'none', ...o }).exp, 0);
  assert.deepEqual(week.map(dayKind), ['normal', 'normal', 'normal', 'normal', 'gsd', 'full', 'gsd']);
  assert.equal(sum({ nature: 'none' }), 1100);
  assert.equal(sum({ nature: 'down' }), 902);
  const normal = week.slice(0, 4);
  assert.equal(normal.reduce((s, d) => s + sleepDay(d, { score: 100, bonus: 1, incense: 'none', nature: 'none' }).exp, 0), 4 * 114);
});

ok('おひるね島', () => {
  // 1日150、7日で1,050。7日未満は半分なので、1,000 は「半分では 13日以上かかる」→ 7日待つ。
  assert.deepEqual(napMinutes(1050, 'none', 0), { minutes: 7 * 1440, half: false });
  assert.deepEqual(napMinutes(1000, 'none', 0), { minutes: 7 * 1440, half: false });
  // 少ないEXPは半分で引き取るほうが早い（150 は半分なら2日）。
  assert.deepEqual(napMinutes(150, 'none', 0), { minutes: 2 * 1440, half: true });
  // 性格の上昇は1.18倍、下降は効かない。チケットは1日600。
  assert.equal(napMinutes(177 * 8, 'up', 0).minutes, 8 * 1440);
  assert.equal(napMinutes(150 * 8, 'down', 0).minutes, 8 * 1440);
  assert.equal(napMinutes(600 * 7, 'none', 1).minutes, 7 * 1440);
  assert.equal(napMinutes(600 * 7 + 150, 'none', 1).minutes, 8 * 1440);
});

ok('plan', () => {
  const startDay = Date.UTC(2026, 9, 1) / 864e5;
  const base = { expType: 600, level: 30, target: 50, nature: 'none', candy: 0, shardCap: null, score: 100, bonus: 0, incense: 'none', tickets: 0, startDay };
  const p = plan(base);
  const th = thresholds(600);
  assert.equal(p.need, th[50] - th[30]);
  for (const r of Object.values(p.routes)) assert.ok(r && r.days > 0);
  // 併用はどちらか単独より遅くならない。
  assert.ok(p.routes.mix.days <= Math.min(p.routes.sleep.days, p.routes.nap.days) + 1e-9);
  // アメだけで届くとき。
  const c = plan({ ...base, candy: 9999 });
  assert.equal(c.routes, null);
  assert.equal(c.candy.level, 50);
  // 次のレベルまでのEXP を入れると、そのぶん必要EXP が減る。
  assert.equal(plan({ ...base, toNext: 1 }).need, th[50] - th[31] + 1);
});

// 満月の時刻（暦に載っている値、UTC）と1分以内で一致する。
ok('満月の時刻', () => {
  for (const [k, want] of [[297, '2024-01-25T17:54'], [298, '2024-02-24T12:30'], [309, '2025-01-13T22:27'], [321, '2026-01-03T10:03'], [331, '2026-10-26T04:12']]) {
    assert.ok(Math.abs(fullMoonMs(k) - Date.parse(want + 'Z')) <= 60e3, `${k}: ${new Date(fullMoonMs(k)).toISOString()}`);
  }
});

ok('グッドスリープデーは満月の日を中心にした3日間で、手で直せる', () => {
  const day = (s) => Date.UTC(...s.split('-').map((v, i) => (i === 1 ? v - 1 : +v))) / 864e5;
  const full = day('2026-10-26'); // 2026-10-26 13:12（日本時間）が満月
  assert.deepEqual([-2, -1, 0, 1, 2].map((k) => dayKind(full + k)), ['normal', 'gsd', 'full', 'gsd', 'normal']);
  // 1年ぶん、満月の日はどれも前後が2倍の日で、4日以上続かない。
  for (let d = day('2026-01-01'); d < day('2027-01-01'); d++) {
    if (dayKind(d) === 'full') assert.ok(dayKind(d - 1) === 'gsd' && dayKind(d + 1) === 'gsd' && dayKind(d + 2) !== 'full');
  }
  const later = gsdCalendar({ [full]: 1 });
  assert.deepEqual([-1, 0, 1, 2].map((k) => later(full + k)), ['normal', 'gsd', 'full', 'gsd']);
  const off = gsdCalendar({ [full]: 'off' });
  assert.deepEqual([-1, 0, 1].map((k) => off(full + k)), ['normal', 'normal', 'normal']);
  const sch = gsdSchedule(full - 3, full + 3, { [full]: -1 });
  assert.deepEqual(sch, [{ est: full, full: full - 1, shift: -1, off: false }]);
  // 直した日程で計算が変わる（なしにすると睡眠だけのルートは遅くなる）。
  const base = { expType: 600, level: 30, target: 40, nature: 'none', candy: 0, shardCap: null, score: 100, bonus: 0, incense: 'none', tickets: 0, startDay: full - 5 };
  assert.ok(plan({ ...base, gsd: { [full]: 'off' } }).routes.sleep.days > plan(base).routes.sleep.days);
});

ok('7日未満で引き取ると、貯まったEXPの半分', () => {
  const startDay = Date.UTC(2026, 9, 1) / 864e5;
  // あと少し（Lv.30 で次まで 40 EXP）なら、島に預けて半分で引き取るのが早い。
  const p = plan({ expType: 600, level: 30, toNext: 40, target: 31, nature: 'none', candy: 0, shardCap: null, score: 100, bonus: 0, incense: 'none', tickets: 0, startDay });
  assert.equal(p.need, 40);
  const nap = p.routes.nap.blocks.at(-1);
  assert.equal(nap.half, true);
  assert.ok(nap.exp === Math.floor(nap.raw / 2) && nap.exp >= 40);
  assert.equal(p.routes.nap.days, (40 * 2) / 150); // 80 EXP 貯まる 12時間48分
  const last = p.routes.mix.blocks.at(-1);
  assert.ok(last.mode === 'nap' && last.half && last.exp === Math.floor(last.raw / 2));
});

// 併用（動的計画法）は、すべての予定を試した最短と一致する。総当たりは島を 7〜30日のどの長さでも預けられ、
// 最後は「半分で引き取る」「7日待つ」「満喫して届いた時刻」を試す。グッドスリープデー・満月が週をまたぐ開始日も含む。
function brute(need, o, { cap = 30, sleep = true } = {}) {
  const rate = Math.max(NATURE_RATE[o.nature], 1);
  const napE = (min, tkMin) => { const u = Math.min(min, tkMin); return Math.floor(rate * (NAP.ticketPerDay * u + NAP.perDay * (min - u)) / 1440 + 1e-9); };
  let best = Infinity;
  const go = (d, t, e) => {
    if (d >= best) return;
    if (e >= need) { best = d; return; }
    // ここから預けて届く時刻（分単位）。
    for (let m = 1; m <= cap * 1440 && d + m / 1440 < best; m++) {
      const full = napE(m, t * 1440), got = m < 7 * 1440 ? Math.floor(full / 2) : full;
      if (e + got >= need) { best = d + m / 1440; break; }
    }
    if (sleep) go(d + 1, t, e + sleepDay(o.startDay + d + 1, o).exp);
    for (let k = 7; k <= cap; k++) { const u = Math.min(t, k); go(d + k, t - u, e + napE(k * 1440, u * 1440)); }
  };
  go(0, o.tickets * 7, 0);
  return best;
}
ok('併用 = 総当たりの最短', () => {
  const s0 = Date.UTC(2026, 9, 1) / 864e5;
  const cases = [
    { target: 34, tickets: 0, incense: 'none', bonus: 0 },
    { target: 34, tickets: 0, incense: 'fullMoon', bonus: 2 },
    { target: 35, tickets: 1, incense: 'gsd', bonus: 1 },
  ];
  for (const c of cases) {
    for (let k = 0; k < 30; k += 3) {
      const o = { expType: 600, level: 30, nature: 'none', candy: 0, shardCap: null, score: 100, startDay: s0 + k, ...c };
      const p = plan(o);
      const want = brute(p.need, o);
      assert.ok(Math.abs(p.routes.mix.days - want) < 1e-9, `${JSON.stringify(c)} +${k}日: ${p.routes.mix.days} != ${want}`);
    }
  }
});

// 島に預ける日数に上限（2週間など）があるとき。上限で引き取ってすぐ預け直し、預け直すと7日の数えはやり直し。
ok('預ける日数の上限（引き取って預け直す）', () => {
  const s0 = Date.UTC(2026, 9, 1) / 864e5;
  for (const [cap, c] of [[14, { target: 36, tickets: 0 }], [10, { target: 35, tickets: 1 }], [7, { target: 35, tickets: 0 }]]) {
    for (let k = 0; k < 30; k += 10) {
      const o = { expType: 600, level: 30, nature: 'none', candy: 0, shardCap: null, score: 100, incense: 'none', bonus: 0, startDay: s0 + k, napMax: cap, ...c };
      const p = plan(o);
      assert.ok(Math.abs(p.routes.mix.days - brute(p.need, o, { cap })) < 1e-9, `mix cap=${cap} +${k}日`);
      assert.ok(Math.abs(p.routes.nap.days - brute(p.need, o, { cap, sleep: false })) < 1e-9, `nap cap=${cap} +${k}日`);
      // 上限があると、上限なしより早くはならない。
      const free = plan({ ...o, napMax: null });
      assert.ok(p.routes.nap.days >= free.routes.nap.days - 1e-9 && p.routes.mix.days >= free.routes.mix.days - 1e-9);
    }
  }
  // 島のみ・14日ごと：1回の預けはどれも14日以下で、回数は日数から決まる。
  const p = plan({ expType: 900, level: 30, target: 50, nature: 'none', candy: 0, shardCap: null, score: 100, incense: 'none', bonus: 0, tickets: 0, startDay: s0, napMax: 14 });
  assert.equal(p.routes.nap.blocks.length, 1);
  assert.equal(p.routes.nap.blocks[0].days, p.routes.nap.days);
});

// 睡眠のみは、毎晩の睡眠EXPを足していって届いた日と同じ。
ok('睡眠のみ = 毎晩足していく計算', () => {
  const s0 = Date.UTC(2026, 9, 1) / 864e5;
  for (const extra of [{}, { incense: 'every2Days', bonus: 2 }, { nature: 'down', score: 63 }]) {
    const o = { expType: 1080, level: 20, target: 45, nature: 'none', candy: 0, shardCap: null, score: 100, bonus: 0, incense: 'none', tickets: 3, startDay: s0, ...extra };
    const p = plan(o);
    let e = 0, d = 0;
    while (e < p.need) e += sleepDay(s0 + ++d, o).exp;
    assert.equal(p.routes.sleep.days, d);
    assert.deepEqual(p.routes.sleep.blocks.map((b) => [b.mode, b.days]), [['sleep', d]]);
  }
});

ok('併用は単独のルートより遅くならない', () => {
  const s0 = Date.UTC(2026, 9, 1) / 864e5;
  for (let k = 0; k < 60; k++) {
    for (const extra of [{}, { tickets: 2 }, { incense: 'gsd', bonus: 3 }, { nature: 'up' }]) {
      const p = plan({ expType: 900, level: 25, target: 50, nature: 'none', candy: 0, shardCap: null, score: 100, bonus: 0, incense: 'none', tickets: 0, startDay: s0 + k, ...extra });
      const { sleep, nap, mix } = p.routes;
      assert.ok(mix.days <= Math.min(sleep.days, nap.days) + 1e-9, `+${k}日 ${JSON.stringify(extra)}`);
      // 予定の日数の合計が到達日数と合う。
      assert.ok(Math.abs(mix.blocks.reduce((s, b) => s + b.days, 0) - mix.days) < 1e-9);
    }
  }
});

console.log(`${n} 件すべて通った`);
