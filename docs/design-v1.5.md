# ver1.5 設計書

[要件定義](requirements-v1.5.md) に沿って、食材タイプ・スキルタイプ（とタイプ共通のおてつだい時間）をにとよんツールの計算に合わせる。作業の基準は `2acda86`。比較したにとよんツールは `nitoyon/pokesleep-tool` の `0dc4525`（2026年9月27日）。

## 1. 変えたファイル

| ファイル | 変更 |
|---|---|
| `js/calc.js` | `trunc4`・`helpTime`・`rateOf`・`stockSkills` を追加。`nightRolls` からキュー4回を除く。`runSegs` を削除 |
| `js/constants.js` | `QUEUE_AFTER_FULL`・`CHAIN_MAX_DAYS`・`CHAIN_TOL` を削除 |
| `checker/js/{berry,ingredient,skill}/calc.js` | おてつだい時間と確率を `helpTime`・`rateOf` で求める |
| `checker/js/skill/calc.js` | 発動回数を実質確率とストックで数える（`daySkills`） |
| `checker/js/skill/constants.js` | `ceilOf` を発動が確定するおてつだいの回数（Ceil[142000 / 時間] + 1）に |
| `checker/js/ui.js` | 天井の表示を「N回目」に |
| `checker/js/distcache.js` | `MODEL_VERSION` を9に |
| `tests/check-segs.mjs` | 新しい数え方の境界テスト（全経路の列挙） |
| `tests/compare-nitoyon.mjs`・`tests/nitoyon/runner.ts` | にとよんツールとの比較 |

## 2. 計算

### 2.1 おてつだい時間と確率

にとよんツールの `PokemonIv.frequencyWithHelpingBonus`・`skillRate`・`ingredientRate` と同じ。

- おてつだい時間 = 基準の時間 × trunc4((501 − Lv) / 500 × 性格 × (1 − min(0.35, サブスキル合計)))。秒は切り捨てない。
- 確率 = min(1, trunc4(基礎値 × 性格 × (1 + サブスキル合計)))。
- trunc4(v) = floor(round6(v × 10⁴)) / 10⁴（浮動小数の誤差を小数第6位で丸めてから切り捨てる）。

ver1.4 までは表示のおてつだい時間（秒を切り捨て）で計算していた。3時間ごとの受け取りでは、秒未満の差が積み重なって区間の境目で1回が移り、所持数のあふれ方が変わることがあった。

### 2.2 スキルの数え方

にとよんツールの `calculateSkillRateWithPityProc`・`HelpCount.ts` と同じ。

- 天井 c = Ceil[142000 / 基準の時間]。c 回続けて不発なら次で発動する。実質確率 pe = p / (1 − (1 − p)^(c + 1))。
- 常にタップの日中: おてつだい回数 n（小数）× pe。
- ストックのある区間（3時間ごとの受け取りの区間と睡眠中）: 所持数0から追い、満タンになったおてつだいまで抽選する。抽選 k 回の確率 P[k] で、E[min(2, Binomial(k, pe))] = 2 − 2(1 − pe)^k − k·pe·(1 − pe)^(k−1) を平均する。小数回の区間は前後の整数回の P を混ぜる。
- 区間どうし・日どうしで天井の途中経過は持ち越さない。

このため ver1.4 の `runSegs`（天井カウンタの分布を日をまたいで収束まで追う計算）はなくなった。

### 2.3 変えないもの

げんきの推移・ヒーラー・料理、受け取りの区間、所持数の遷移、食材配列の出現率、性格とサブスキルの分布、おてつだいボーナスのチーム効果（ほかの4匹がおてつだいスピード+5%で増やす分を足した無補正比）。

## 3. 検証

- にとよんツール: 次の条件で、にとよんツールの基礎値のまま比べた。差はどれも浮動小数の誤差。

| タイプ | 条件 | 件数 | 相対差の最大 |
|---|---|---|---|
| きのみ | 31匹 × Lv.60/80 × サブスキル6 × 性格7 × パラメーター5（食材配列は出現率で平均） | 13,020 | 8.9e-16 |
| 食材 | 40匹 × Lv.60/80 × サブスキル6 × 性格7 × パラメーター5 × 食材配列と狙い食材 | 199,500 | 2.0e-15 |
| スキル | 54匹 × Lv.60/80 × サブスキル6 × 性格7 × パラメーター5（食材配列は出現率で平均）＋チーム効果540 | 22,790 | 1.5e-14 |

パラメーターは、ヒーラーなし・常にタップ（きのみは受け取りなし）／ヒーラー1匹・同・チケットあり／ヒーラー1匹・3時間ごと・チケットあり／常に81%以上・3時間ごと／ヒーラー1匹・3時間ごと。ストリンダーは、にとよんツールが姿に合わない性格を置き換えるので、その条件を除いた。

- `node tests/check-segs.mjs`: 221ケース。所持数1・2・4・7、回数0〜6.25（小数を含む）、食材確率0・0.3・1、スキル確率0・0.2・1で、抽選回数の分布・満タン確率・発動回数を全経路の列挙と比べる。実質確率を天井つきの更新過程の平均と比べる。
- `node tests/check-dist.mjs`: 3タイプ各2条件で通過。

### 3.1 ver1.4 からの値の変化

`compare-values.mjs` と同じ条件（125匹 × 条件4 × サブスキル4 × 性格4）。

| タイプ | 自分の値（平均 / 最大） | 無補正比（平均 / 最大） |
|---|---|---|
| きのみ | −0.02% / 0.43% | −0.02% / 0.87% |
| 食材 | −0.02% / 1.19% | −0.02% / 1.12% |
| スキル | −2.39% / 10.88% | +0.38% / 6.10% |

スキルタイプは満タン後の4回を数えなくなったぶん少なくなる。所持数の少ないポケモン・3時間ごとの受け取りで差が大きい。

## 4. 計算時間

ミュウツー・5枠（Lv.80）・チケットあり・ヒーラー1匹（回復18）・チーム効果あり。Linux x86_64・Intel Xeon 2.10GHz・Node.js v22.22.2。各3回、新しいプロセスで計算した中央値。

| 日中の受け取り | ヒーラー発動回数 | ver1.4 | ver1.5 |
|---|---|---|---|
| 常にタップ | 3回 | 6.51秒 | 1.77秒 |
| 常にタップ | 2.5回 | 10.68秒 | 2.85秒 |
| 3時間ごと | 3回 | 10.78秒 | 2.64秒 |
| 3時間ごと | 2.5回 | 18.75秒 | 4.61秒 |

計算方法が変わったので、分布の行数も変わる（常にタップ3回で24,210行から26,641行）。

## 5. 再確認する手順

```sh
node tests/check-segs.mjs
node tests/check-dist.mjs
git clone https://github.com/nitoyon/pokesleep-tool.git ../pokesleep-tool
(cd ../pokesleep-tool && npm ci)
cp tests/nitoyon/runner.ts ../pokesleep-tool/
for t in berry ingredient skill; do
  node tests/compare-nitoyon.mjs gen $t /tmp/cases-$t.json /tmp/ours-$t.json
  (cd ../pokesleep-tool && npx vite-node runner.ts /tmp/cases-$t.json /tmp/nitoyon-$t.json)
  node tests/compare-nitoyon.mjs cmp $t /tmp/ours-$t.json /tmp/nitoyon-$t.json
done
```

にとよんツールの計算やデータが更新されると、結果は変わりうる。
