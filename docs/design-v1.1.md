# ver1.1 設計書

[要件定義](requirements-v1.1.md) を実装した作りをまとめる。計算式・ゲームデータの出典は [`README.md`](../README.md)（共通）と [`checker/README.md`](../checker/README.md)（タイプごと）にあり、ここでは重ねて書かない。

## 1. 全体の構成

ビルドなしの静的サイト（ES モジュール）。GitHub Pages に公開し、公開時にモジュールの import に `?v=コミット` を付けてキャッシュを切り替える。

```
画面 (checker/index.html, css/theme.css)
  └ main.js ─ ui.js ─ state.js (localStorage)
                │
                ├ types.js ── berry/ ingredient/ skill/ の constants.js・calc.js・mons.js
                │               └ 共通: js/constants.js・js/calc.js
                └ worker.js（Web Worker）─ distcache.js（IndexedDB）
```

| ファイル | 役割 |
|---|---|
| `js/constants.js` | 3タイプ共通のゲームデータ。サブスキル・性格・げんきの倍率、料理の回復表（`COOK_AT`・`cookRecovery`）、回復上限 `HEAL_CAP`、食材配列のスロットの重み `slotWeights` |
| `js/calc.js` | 共通の計算。げんきの推移 `energyCurve`、受け取り区間ごとのおてつだい回数 `helpsPerTap`、サブスキルの抽選分布 `subsetDist`、同じ性能のまとめ `mergeSame`（`SAME_REL = 1e-7`） |
| `checker/js/{type}/constants.js` | タイプごとのパラメーター・性格の分類 `natCat`・食材配列の組み合わせ（`amountPatterns` / `allArrs`） |
| `checker/js/{type}/calc.js` | タイプごとの計算エンジン `createEngine()`（`metric`・`value`・`score`・`dist`） |
| `checker/js/{type}/mons.js` | ポケモンの基礎値（きのみタイプは進化回数 `evo` を含む） |
| `checker/js/state.js` | 選択・パラメーター・記録の状態と保存。`env()` で計算条件を作る |
| `checker/js/ui.js` | 描画とダイアログ |
| `checker/js/worker.js` / `distcache.js` | 上位%の分布の計算と保存 |
| `tests/check-dist.mjs` | 分布の整合性テスト |

## 2. 計算条件（env）

`state.env()` が作るオブジェクトを、計算・分布の保存キー・記録の再計算で共通に使う。

| タイプ | 項目 |
|---|---|
| きのみ | `N`（枠数）, `camp`, `mon`, `heal`（`0` / `1` / `'g80'`）, `tap`（`'none'` / `'3h'`）, `team`, `healAmt`, `healTimes` |
| 食材 | `N`, `camp`, `g80`, `mon`, `target` |
| スキル | `N`, `camp`, `g80`, `mon` |

パラメーターは localStorage に保存する（`ckheal`・`cktap`・`ckteam`・`ckhealamt`・`ckhealtimes` など）。保存値が選択肢にないとき（以前の「2匹」など）は既定値に戻す。`healTimes` は小数第2位に丸め、`PARAM_LIMITS` の範囲に収める。

## 3. きのみタイプの計算エンジン（`checker/js/berry/calc.js`）

1. **倍率** `mults` / `mk`: サブスキル・性格から、おてつだい時間・食材確率・所持数・きのみの数・げんき回復ボーナス・げんき回復量補正 `rec`・おてつだいボーナス `hb` を求める。
2. **げんき** `curveOf(env, wake, rec)` → `energyCurve`: 10分ごとのげんき。ヒーラーの回復・料理の回復のイベントを起床からの分で置き、睡眠による回復は2回まわして起床時の値を定常にする。
3. **スケジュール** `scheduleOf`: 受け取りの区間ごとに `helpsPerTap` で小数のおてつだい回数を求める（起床中と睡眠中は別に数える。げんき1以下は0扱い）。
4. **所持数** `segBerries` / `dayBerries`: 区間ごとに、満タンまでの食材おてつだいを数えて拾うきのみを求める。回数が小数なら前後の整数回の結果を線形に混ぜる。受け取り「なし」はすべてきのみ。最大所持数には進化1回ごとの +5 を含める。
5. **発動回数が小数** `timesMix` / `mixed`: 前後の整数回の結果を重みで平均する。
6. **食材配列**: `amountPatterns` で配列ごとの個数の並びと出現率（`slotWeights`）を作り、値を重み付き平均する。
7. **順位の基準** `value`: 自分のきのみエナジー + `team` がオンかつ `hb` を持つとき `TEAM_OTHERS(4) × teamGain`。`teamGain` はサブスキルなし・無補正のメンバーの、スピード `HB_SPEED(5%)` ありとなしの差。`score` = `value` / `baseMetric`（無補正個体）。
8. **分布** `buildDist`: サブスキルの抽選分布 × 性格25種 × （配列の重み）を数え上げ、`[{ r, p }]` を `mergeSame` で同じ性能ごとにまとめて返す。

食材タイプ・スキルタイプのエンジンも、分布の作り方（`mergeSame`・`slotWeights`）は同じ。

## 4. 上位%の算出と表示

- 分布 `dist = [{ r: 無補正比, p: 確率 }]`（`r` の降順）。
- 同等以上の確率 = `r ≥ 自分の r × (1 − SAME_REL)` の行の `p` の合計。平均何匹に1匹 = 丸める前の確率の逆数。
- 性能値の順位 = 1 + `r > 自分の r × (1 + SAME_REL)` の行数。行数とあわせて参考値として出す。
- `ui.js` の `renderBar` は無補正比・確率・何匹に1匹だけをバーに出す。`setRows` で結果の行に確率・何匹に1匹・順位を、`renderRankNote` で抽選条件の注記（金枠確定なし・食材配列の出現率）を出す。

## 5. 分布の計算と保存

- 分布は Web Worker（`worker.js`）で計算し、計算が必要なときは先に `{ computing: true }` を送って「計算中」を出す。
- 保存は IndexedDB（`checker-dist`）。上限300件で、最後に使ったのが古いものから消す。
- 保存キー `cacheKey(type, env)` = `MODEL_VERSION` | 公開版 `BUILD`（`?v=`）| 共通データのハッシュ `COMMON`（サブスキル・色の確率・性格・げんきの倍率・`slotWeights`）| タイプ | ポケモンの基礎値のハッシュ | env の全項目。
- 計算方法を変えたら `MODEL_VERSION` を上げる（今は5）。上げ忘れても `BUILD` が変わるので、公開のたびに計算し直す。

## 6. 画面

- **パラメーター**: メインの `#params` に「日中の受け取り」（きのみのみ）と「いいキャンプチケット」、1行の要約 `#paramSum` と「詳細」ボタン。詳細は `#paramDlg`。`data-for="berry"` / `"other"` の要素をタイプごとに出し分ける（`renderParams`）。
- **結果（きのみ）**: `hAll` に順位の基準、`hDay` / `hNight` に自分のきのみエナジーの内訳、`hTeamW` にチーム効果（オンでおてボ持ちのときだけ）。条件の欄に就寝時・起床時のげんきとげんき回復量補正。
- **ダイアログ**: `dialog.sheet` は画面の高さに収め、`.dlg-foot` を下端に固定する。サブスキルは全枠が埋まったら閉じる。
- **記録**: サブスキル・性格・食材配列だけを保存し、表示のたびに今の条件で計算し直す。性格は名前から今のタイプの分類で決め直す（「げんき回復」の分類を加えたため）。

## 7. テスト

- `node tests/check-dist.mjs`: 代表的な条件で、確率の合計が1、同等以上の確率が順位とともに単調に増える、順位と行の数え方が一致する、個体の無補正比が分布に含まれることを確かめる。
- にとよんツールとの突き合わせ（31匹 × サブスキル5 × 性格8 × パラメーター6）は手元で行い、結果を `checker/README.md` に記す。
- 上位%はモンテカルロ（60万回）と比べて一致を確かめた（例: 66位で 0.235% と 0.228%）。
