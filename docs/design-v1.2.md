# ver1.2 設計書

[要件定義](requirements-v1.2.md) を実装した作りをまとめる。ver1.1 の作りは [`design-v1.1.md`](design-v1.1.md) にあり、ここでは変えた部分だけを書く。

## 1. 変えたファイル・変えないファイル

| ファイル | 変更 |
|---|---|
| `checker/js/ingredient/calc.js` | 書き換え（2章） |
| `checker/js/ingredient/constants.js` | 受け取り `TAPS = ['always', '3h']`・`TAP_EVERY`、性格の分類に「げんき回復」 |
| `checker/js/ingredient/mons.js` | 進化の回数 `evo` を加える |
| `checker/js/state.js` | 食材タイプの `env` にヒーラー・受け取り・チーム効果を加える。ヒーラー・チーム効果はきのみタイプと共通、受け取りは `ckingtap` に別に保存 |
| `checker/js/ui.js` / `checker/index.html` | 食材タイプの結果の表示（3章）、パラメーター画面（`data-for` をタイプ名の空白区切りに） |
| `checker/js/distcache.js` | `MODEL_VERSION` を 6 に |
| `checker/js/berry/*` | **変えない**。食材タイプは export 済みの `curveOf`・`timesMix`・`mixed`・`energyAt` と定数（`EVO_CAP`・`ENERGY_REC`・`TEAM_OTHERS`・`HB_SPEED`）を読むだけ |
| `js/calc.js` | 変えない（`helpsPerTap` を使う） |

## 2. 食材タイプの計算エンジン（`checker/js/ingredient/calc.js`）

計算条件 `env = { N, camp, mon, target, heal, tap, team, healAmt, healTimes }`。

1. **倍率** `mk`: きのみタイプと同じ形。性格のげんき回復量補正 `rec` とおてつだいボーナス `hb` を持つ。
2. **スケジュール** `scheduleOf`: `curveOf` → `helpsPerTap` で、受け取りの区間ごとの小数のおてつだい回数 `[日中, 睡眠中]` を求める。「常にタップ」は日中を1区間、「3時間ごと」は3時間ごとと就寝時に区切る。睡眠中は1区間。
3. **所持数** `capIngredients` / `segIngredients`: 区間ごとに所持数0から追い、スロットごとの食材の個数と満タンの確率を求める。満タン後は食材が増えない。回数が小数なら、前後の整数回の結果を1回の計算で求めて線形に混ぜる。「常にタップ」の日中は所持数を見ない。最大所持数に `evo × 5` を含める。
4. **値**:
   - `metric(m, arr, env)` = 自分の狙い食材の1日の個数（発動回数が小数なら `mixed` で平均）。
   - `reference(env)` = 無補正個体で `metric` が最大の食材配列（狙いが A なら AAA）。`baseMetric` はその値。
   - `teamGain(env)` = `TEAM_OTHERS(4) ×`（基準の配列・サブスキルなし・無補正で、スピード `HB_SPEED(5%)` ありの `metric` − `baseMetric`）。条件ごとにキャッシュする。
   - `value = metric + (env.team && m.hb ? teamGain(env) : 0)`、`score = value / baseMetric`。
5. **分布** `buildDist`: サブスキル × 性格25種 × 食材配列（`slotWeights`）を数え上げる。狙い食材ごとに別の分布（`envKey` に `target` を含む）。
6. **表示用** `daily`: 食材ごとの個数（日中 / 睡眠中）、おてつだい回数、満タンの確率、あふれた個数、げんき。

## 3. 画面（食材タイプの結果）

- 大きく出す値: 自分の狙い食材の個数（日中 / 睡眠中の内訳）。おてボ持ちで「含める」のときは、同じ枠に「おてボによるほかの4匹の増加 +○個」。
- 性能の欄: げんき、食材確率、1日の食材の個数（食材ごと）、最大所持数（基礎＋進化×5＋サブスキル）、満タンの確率、自分の狙い食材、ほかの4匹の増加、無補正個体の個数（基準の配列）、個数の比。
- パラメーター: メインに「日中の受け取り（常にタップ / 3時間ごと）」「いいキャンプチケット」。詳細ダイアログにヒーラー・回復量・発動回数・おてボのチーム効果（きのみタイプと共通）。

## 4. 保存・移行

- 受け取りは `ckingtap` に保存する（きのみタイプの `cktap` とは選択肢が違う）。
- ヒーラー・回復量・発動回数・チーム効果はきのみタイプと同じキー（`ckheal`・`ckhealamt`・`ckhealtimes`・`ckteam`）。以前の「げんき常時81%以上」（`ckg80`）は、`ckheal` がまだないときだけ「常に81%以上」として引き継ぐ（ver1.1 と同じ処理）。
- 記録は今の条件で計算し直すので形式は変えない。並びは順位の基準（無補正比）の順。

## 5. テスト

- `tests/check-dist.mjs` に食材タイプの新しい条件（ヒーラー・受け取り・チーム効果、狙い A と B）を加えた。
- きのみタイプに影響がないことを、変更前後で31匹 × パラメーター4通り × サブスキル4通り × 性格4通りの値が一致することで確かめた。
- 5枠の分布の計算は約6.4秒（ver1.1 は約3.3秒）。Web Worker で計算し、一度計算した分布は保存する。
