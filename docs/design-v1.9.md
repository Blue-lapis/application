# ver1.9 設計書

既定の条件の上位%の分布を、公開時（GitHub Actions）に Node で事前計算し、gzip した JSON として GitHub Pages に一緒に置く。画面（Worker）は IndexedDB に保存がなければそのファイルを読み、なければ今までどおり計算する。評価の規則・計算結果の値・`MODEL_VERSION`（10）は変えない。あわせて、ヒーラーの1日の発動回数の既定値を3回から5回にする。要件と範囲の決め方は [要件定義](requirements-v1.9.md)。作業の基準は `77965e2`。

## 1. 範囲

| 項目 | 値 |
|---|---|
| レベル | 50 / 60 / 70 / 80（`PRE_LEVELS`） |
| チケット | あり / なし |
| ポケモン | 3タイプの全ポケモン（きのみ31・食材40・スキル54）。食材タイプは狙い食材ごと |
| そのほか | ヒーラー1匹・回復量18・発動回数5・チーム効果を含める・受け取りはタイプの既定（きのみ `none`、食材・スキル `always`） |
| 件数 | 1,554件（Lv.50 で狙い食材が開いていない78件を除く） |

- 範囲の判定は `isPrecomputed(type, env)`。`env` の項目が1つでも違えば（増えても）範囲外で、ファイルを取りに行かない（404 を出さない）。
- 既定の値は `state.js` の既定と同じにする。`tests/check-precomputed.mjs` が、画面の既定の条件とチケットを切り替えた条件が範囲に入ることを確かめる。
- Lv.50 で狙い食材が Lv.60 の枠にしか出ない条件は、無補正の個体の個数が0になり、分布は無補正比 NaN の1行になる（ver1.8 までと同じ動き）。JSON に書けず意味もないので対象から外し、Worker に任せる。

## 2. ファイル

- 場所: `checker/dist/v<MODEL_VERSION>/<タイプ>/<ポケモン>/lv<レベル>-<camp|nocamp>[-<狙い食材>].json.gz`（`distPath`）。
- 中身（gzip 前）: `{ v: MODEL_VERSION, key: dataKey, r: [...], p: [...] }`。
  - `dataKey` は IndexedDB のキー（`cacheKey`）から公開の版 `BUILD` を除いたもの（`MODEL_VERSION|COMMON|タイプ|ポケモンの基礎値のハッシュ|条件`）。ファイルは公開のたびに作り直すので、版の代わりにこのキーで照合する。`cacheKey` の形は変えていない。
  - `r` は無補正比を 1e9 倍した整数の、前の行との差（先頭はそのまま）。`buildDist` が `toFixed(9)` で作る値なので `n / 1e9` で同じ値に戻る。高い順なので差は正。
  - `p` は確率をそのまま（JSON の数値は倍精度を失わない）。
- 読み込み（`decodeDist`）は、`v`・`key` が今の値と違う、行の数が合わない、差が正の整数でない、`p` が 0〜1 の数でない、確率の合計が1から 1e-9 以上ずれている、のどれかで `null` を返す。

## 3. 画面

`worker.js` の順番を「IndexedDB → 事前計算のファイル（`fetchDist`）→ 計算」にした。

- `fetchDist` は範囲外なら何もせず `null`。範囲内なら `../dist/<distPath>?v=<モジュールの版>` を取得する。`?v=` は公開時に付くコミットで、Pages のキャッシュ（10分）で前の公開のファイルと混ざらないようにする。
- 届いたバイト列が gzip（先頭 `1f 8b`）なら `DecompressionStream('gzip')` で戻す。サーバーが `Content-Encoding` を付けてブラウザが展開済みのときはそのまま読む。`DecompressionStream` のないブラウザ（Safari 16.3 以前など）は `null`。
- 404・通信エラー・6秒の時間切れ（`FETCH_TIMEOUT`）・壊れた gzip や JSON・照合の失敗は、どれも `null` で、Worker は `{ computing: true }` を送って計算する。例外は外に出さない（画面は止まらない）。
- ファイルから読んだ分布も IndexedDB に保存する（キーは今までどおり `cacheKey`）。
- 取得中の表示は、保存済みの分布を読んでいるときと同じ「…」。「計算中」は計算に入ったときだけ出る。
- 画面が頼むのは今の条件とチケットを切り替えた条件の2つ（`requestDist`、変更なし）なので、1ポケモンを開いて取るのは2ファイル。全件を一括では読まない。

### スマートフォンでの考え方

- 通信量: 1ファイルは gzip で きのみ 1〜2KB、食材 中央値約45KB・最大約210KB、スキル 中央値約40KB・最大約130KB。計算に比べて、スマートフォンの CPU（PC の数倍遅い見込み）より速く届くことが多い。
- 遅い回線: 6秒で諦めて計算に切り替える。届かないまま待ち続けることはない。
- 保存: 取得した分布は IndexedDB に入るので、同じ条件を開き直しても通信しない（公開の版が変わるまで）。

## 4. 生成（CI）

- `scripts/precompute-dist.mjs [出力先] [--jobs=N]`。`worker_threads` で CPU の数だけ並列に、条件ごとに新しいエンジンで計算して `clearCaches()` する（Worker と同じ手順）。出力先（既定 `checker/dist`）は作り直す。
- 書き出した gzip を読み戻して `decodeDist` にかけ、元の分布と `Object.is` で全行一致しなければ失敗する（全件で行う）。
- `pages.yml` の `deploy` ジョブ（`test` ジョブの後）で、`?v=` を付ける前に `node scripts/precompute-dist.mjs` と `node tests/check-precomputed.mjs` を実行する。`Collect site files` が `checker/` ごとコピーするので `checker/dist/` も公開物に入る。
- 毎回計算する（`actions/cache` は使わない。要件定義 §5）。`checker/dist/` は `.gitignore` に入れ、コミットしない。

## 5. 変更したファイル

| ファイル | 変更 |
|---|---|
| `checker/js/berry/constants.js` | `HEAL_TIMES` を 3 → 5 |
| `checker/js/distcache.js` | `MODEL_VERSION` を export。`dataKey` を追加（`cacheKey` の形は同じ） |
| `checker/js/precomputed.js` | 新規。範囲・場所・書き出しと読み込み・取得 |
| `checker/js/worker.js` | IndexedDB の次に事前計算のファイルを読む |
| `scripts/precompute-dist.mjs` | 新規。事前計算 |
| `tests/check-precomputed.mjs` | 新規。CI で実行 |
| `tests/check-precomputed-browser.mjs` | 新規。ヘッドレス Chromium（ローカルのみ） |
| `.github/workflows/pages.yml` | 事前計算と確認の手順 |
| `.gitignore` | `checker/dist/` |

## 6. 確認

この環境（Xeon 2.8GHz・4コア、Node 22.22.2、Playwright 1.56.1 のヘッドレス Chromium）で確かめた。

| 確認 | 結果 |
|---|---|
| 生成 | `node scripts/precompute-dist.mjs`: 1,554件、4並列で 137秒（計算の合計 511秒）。未圧縮 369MB、gzip（公開物）68MB。全件で読み戻した分布が元と一致 |
| 計算との一致（Node） | `node tests/check-precomputed.mjs --all`: 全1,554件、行数・`r`・`p` がビットまで一致（差は0で、浮動小数の誤差もない）。CI の抜き取り（84件・73万行）は 21秒 |
| 計算との一致（Chromium） | `node tests/check-precomputed-browser.mjs`: 75件・59万行を Chromium の V8 で計算し、ファイルから戻した分布とビットまで一致 |
| 既存のテスト | `check-segs.mjs`（221ケース）・`check-dist.mjs`・`check-boost.mjs`（32,008ケース）が通る |
| 版の違い | `v`・`key` の古い／新しい `MODEL_VERSION`、別の条件のキーは使わない（テスト）。ブラウザでも、`MODEL_VERSION` を11にし、v10 のファイルを v11 の場所にコピーして開くと、取得はするが使わずに計算した |
| ファイルがない・壊れている | 範囲外（発動回数3など9通り）は取得しない。404・通信エラー・途中で切れた gzip・壊れた JSON・行の数の違い・確率の合計の違い・6秒の時間切れは、どれも計算に切り替わる（Node のテストとブラウザ） |
| 画面の既定の条件 | 各タイプの既定のポケモンとチケットを切り替えた条件が範囲に入る（テスト） |
| 公開時の `?v=` | `pages.yml` と同じ sed を掛けたコピーで、ファイルの URL に `?v=` が付き、200 で読める |

### ヘッドレス Chromium（スマートフォンの幅 390×844、タッチ）

Worker に頼んでから分布が届くまで。左が今の条件、右がチケットを切り替えた条件（先読み）。コンソールのエラーはどれも0件（外部のフォントは環境によって届かないので空で返している）。

| 場面 | 計算 | 待ち |
|---|---|---|
| フライゴン Lv.60（既定・事前計算） | 0回 | 229ms・18ms |
| フライゴン Lv.60（発動回数3・範囲外） | 2回 | 452ms・191ms |
| フライゴン Lv.60（404 → 計算） | 2回 | 398ms・184ms |
| ミュウツー Lv.80（既定・事前計算） | 0回 | 181ms・22ms |
| ミュウツー Lv.80（発動回数3・範囲外） | 2回 | 705ms・427ms |

- 事前計算の最初の待ち（約200ms）の大半は、Worker のモジュールの読み込みと IndexedDB を開く時間で、ファイルの取得と展開は約20ms。
- PC ではもともと1秒未満だが、スマートフォンでは計算が数倍かかる見込みなので、差はその分大きくなる（DevTools の CPU 絞り込みは Worker に効かず、スマートフォンの速さは再現できていない）。

### ワークフローの所要時間

変更前は直近5回で 29〜73秒。増えるのは `deploy` ジョブの、事前計算（この環境で137秒）・確認（27秒。うち6秒は時間切れのテスト）・`setup-node`・公開物のアップロード（68MB 増える）。GitHub のランナー（4コア）がこの環境と同じ速さなら **+3分前後**（全体で約4分）の見込み。実際の値は main で最初に動いたときに確かめる。

## 7. 気づいたこと（今回は変えない）

- Lv.50 で、狙い食材が Lv.60 の枠にしか出ない食材を選ぶと、無補正の個体の個数が0で、分布の無補正比が NaN になる（ver1.8 までと同じ）。狙い食材の選び方か表示で扱うかを別に決めたい。
- IndexedDB のキーに `BUILD` が入っているので、公開のたびに保存済みの分布は使えなくなる。範囲内の条件はファイルから読むので待たないが、範囲外は公開のたびに計算し直しになる。
