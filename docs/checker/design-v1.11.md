# ver1.11 設計書

厳選チェッカーの画面のコード `checker/js/ui.js`（973行）を、役割ごとのファイルに分ける。あわせて、チェッカーの設計書・要件定義書を `docs/` の直下から `docs/checker/` に移し、`docs/exp/` と並べる。**画面の見た目・動き・計算・保存データ・`MODEL_VERSION`（10）は変えない。**画面のバージョン（v1.2）も変えない。作業の基準は `e24f620`（第2弾の整理を取り込んだ `main`）。

## 1. 今の状態（読んで確かめたこと）

`ui.js` には、次の役割がまとめて入っている（行は `e24f620` のもの）。

| 役割 | 主な関数・変数 | 行 | 行数 |
|---|---|---|---|
| 小さな部品 | `$`・`chipHtml`・`monSrc`・`def`・`METRIC`・`withUnit`・`fmtOdds`・`syncUrl` | 22-77 | 約30 |
| 性能の行の定義 | `ROWS` | 33-57 | 25 |
| 分布の依頼（Worker） | `worker`・`inFlight`・`computing`・`jobKey`・`pendingText`・`startWorker`・`requestDist` | 79-85, 669-717 | 56 |
| 初期化 | `initUI`（タブ・ポケモンを選ぶダイアログ・記録の保存・入力を消す・記録のダイアログのボタン） | 87-166 | 80 |
| ヘッダーと未選択の画面 | `renderToExp`・`renderHeader`・`renderTabs`・`showMonParts`・`renderEmpty` | 169-247 | 79 |
| 入力 | `renderIngs`（狙い食材・食材配列）・`renderSlots`・`renderNat`・`initDialogs`・`openSub`・`renderSubDlg`・`renderNatDlg` | 249-397 | 149 |
| 条件 | `healText` などの文言・`SEGS`・`initParams`・`renderParams`・`renderParamDlg` | 399-502 | 104 |
| 結果 | `condText`・`genkiRow`・`timeRows`・`setSplit`・`heroTeam`・`renderIngStats`・`renderBerryStats`・`renderSkillStats` | 504-667 | 164 |
| 判定 | `renderLvList`・`barCaption`・`renderBar`・`scoreOf` | 719-764, 783-826 | 約95 |
| お知らせ | `toast`・`hideToast` | 766-781 | 16 |
| 記録 | `logFilter`・`logNeeds`・`evalLevel`・`rateLog`・`renderLog` | 828-942 | 115 |
| 確率の注記 | `renderRankNote` | 944-952 | 9 |
| 描き直し | `refresh` | 954-973 | 20 |

役割どうしのつながりで、分けるときに気をつけるもの:

- **分布の依頼と記録が、お互いの状態を見ている。**`requestDist` は記録の一覧で要る分布 `logNeeds` を読み、`renderLog` は計算中の一覧 `computing` を読む。Worker から分布が届くと `renderBar` と `renderLog` を呼ぶ。
- **入力を変える処理は、どれも最後に `refresh(engines)` を呼ぶ。**入力・条件・記録・お知らせの「元に戻す」から呼ばれるので、`refresh` を持つファイルと持たないファイルの間で、呼び合いが生まれる。
- **ヘッダーが結果の行の定義を使う。**`renderHeader` は、ポケモンが変わったときに `ROWS` から「くわしい数値」の枠を作る。
- **結果が条件の文言を使う。**`condText`・`genkiRow`・きのみのエナジーの行は、`healText`・`tapText`・`genkiText`・`boostText` を使う。
- **Worker の場所は `ui.js` から見た相対パス。**`new URL('./worker.js…', import.meta.url)` で作っている。

## 2. 方針

1. `checker/js/ui/` を作り、役割ごとのファイルに分ける。`checker/js/ui.js` は入口（`main.js` から読む `initUI`）として残し、ファイルどうしをつなぐ役にする。
2. **ファイルの間で import が循環しないようにする。**`refresh` や Worker からの知らせは、初期化のときにコールバックとして渡す（§4）。
3. **関数の中身は動かすだけにする。**直すのは、`refresh(engines)` をコールバックの `refresh()` に置き換えることと、ファイルをまたぐための export・import だけ。描き直しの順番（`refresh` の中の呼ぶ順）も変えない。
4. 変数名・関数名・コメントは今のものを使う。ファイルの先頭に、そのファイルの役割を1〜2行で書く。

## 3. 分け方

| ファイル | 中身 | 目安の行数 |
|---|---|---|
| `checker/js/ui.js` | `initUI`（タブ・ポケモンを選ぶダイアログ・入力を消す・テーマ・各ファイルの初期化）、ヘッダーと未選択の画面、判定（`renderLvList`・`barCaption`・`renderBar`・`scoreOf`・`fmtOdds`・`pendingText`）、`refresh` | 約280 |
| `checker/js/ui/common.js` | チェッカーの画面の小さな部品: `$`・`monSrc`・`def`・`withUnit`・`syncUrl`・お知らせ（`toast`・`hideToast` と「元に戻す」のボタン） | 約45 |
| `checker/js/ui/input.js` | 入力: 狙い食材・食材配列（`renderIngs`・`chipHtml`）、サブスキルの枠とダイアログ、性格のボタンと表（`METRIC` もここ） | 約165 |
| `checker/js/ui/params.js` | 条件: 切り替え（`SEGS`）、詳細のダイアログ、条件の文言（`healText`・`teamText`・`tapText`・`genkiText`・`boostText`） | 約115 |
| `checker/js/ui/stats.js` | 結果: 性能の行の定義（`ROWS`）と枠の HTML、タイプごとの結果（`renderIngStats` など）、確率の注記（`renderRankNote`） | 約215 |
| `checker/js/ui/log.js` | 記録: 記録する（今の `initUI` の `saveEntry`）、記録のダイアログ（開く・閉じる・評価するレベル・絞り込み）、一覧（`evalLevel`・`rateLog`・`renderLog`）、削除と元に戻す | 約160 |
| `checker/js/ui/dist.js` | 分布の依頼: Worker の起動と作り直し、`requestDist`、計算中の一覧 | 約70 |

`checker/js/dom.js`（両アプリで共通の部品）と `monpick.js`・`picker.js`・`state.js` はそのまま使う。`ui/common.js` は、チェッカーの画面だけで使う部品に限る。

### import のつながり（矢印は「読む」）

```
ui.js ──→ ui/input.js ──→ ui/common.js
  │  ──→ ui/params.js ──→ ui/common.js
  │  ──→ ui/stats.js  ──→ ui/params.js（条件の文言）, ui/common.js
  │  ──→ ui/log.js    ──→ ui/dist.js（計算中か・依頼）, ui/common.js
  │  ──→ ui/dist.js
  └──→ ui/common.js
```

`ui/` の中のファイルは `ui.js` を読まない。`ui/dist.js` は `ui/log.js` を読まない（§4.2）。

## 4. ファイルの間の受け渡し

### 4.1 描き直し（`refresh`）

`refresh` は `ui.js` に置く。入力・条件・記録のファイルは、初期化のときに引数のないコールバック `refresh` を受け取り、今 `refresh(engines)` を呼んでいるところでそれを呼ぶ。

```js
// ui.js の initUI
const redraw = () => refresh(engines);
initInput({ refresh: redraw });
initParams({ refresh: redraw });
initLog({ engines, refresh: redraw });
```

`engines` を使う描画の関数（`renderLog(engines)` など）は、今の引数の形のままにする。`renderIngs` は `engines` を `refresh` に渡すためだけに受け取っていたので、引数をなくした（`renderInput()` から呼ぶ）。

### 4.2 分布の依頼（`ui/dist.js`）

Worker・`inFlight`・`computing` は `ui/dist.js` の中だけで持つ。外には次の4つを出す。

```js
// 初期化。onChange は分布が届いたときと計算を始めたときに呼ぶ。extraJobs は今のポケモンの分のあとに頼む分布の一覧を返す。
initDist(engines, { onChange, extraJobs })
requestDist()                 // 今の requestDist(engines) と同じ順で頼む
isComputing(type, env)        // 今の computing.has(jobKey(type, env))
```

- `onChange` には、`ui.js` が `() => { renderBar(engines); renderLog(engines); }` を渡す（今の `worker.onmessage` と同じ順）。
- `extraJobs` には、`ui/log.js` の `logJobs`（記録のダイアログが開いていれば、一覧で要る分布 `logNeeds`、閉じていれば `[]`）を渡す。今は `requestDist` が `$('logDlg').open` と `logNeeds` を直接見ているが、そこをこの関数に置き換える。動きは同じ。
- Worker の URL は、ファイルが1段深くなるので `new URL('../worker.js…', import.meta.url)` にする。公開時に付く版（`?v=`）を引き継ぐ形はそのまま。

### 4.3 記録（`ui/log.js`）

- `initLog({ engines, refresh })` は、今の `initUI` にある記録の配線（`#save`・`#logBtn`・`#logLvSeg`・`#logFilter`・`#logClose`・背景のタップ）をまとめて行う。
- 記録の行をタップして戻すときの `setMon`・`syncUrl`・`refresh` も、今と同じ順で呼ぶ。
- `renderLog(engines)` と `logJobs()` を出す。

### 4.4 お知らせ（`ui/common.js`）

`toast`・`hideToast` と、「元に戻す」のボタンの配線（今は `initUI` の中）を `ui/common.js` に置く。`toastFn`・`toastTimer` もここで持つ。

### 4.5 結果の行の枠（`ui/stats.js`）

`renderHeader` の中の「くわしい数値」の枠を作る部分を、`ui/stats.js` の `rowsHtml(type)` にする。`renderHeader` はその HTML を `#rows` に入れるだけにする。

`refresh` で、`heroTeam(null)` とタイプごとの結果を呼ぶ2行は、`renderStats(engine)` にまとめる。

## 5. docs の置き場所

1. チェッカーの設計書・要件定義書（`docs/design-v1.1.md`〜`v1.11.md`、`docs/requirements-v1.*.md`）を `git mv` で `docs/checker/` に移す。ファイル名はそのまま。
2. 移したことで切れるリンクを直す。
   - 移したファイルの中の `../README.md` → `../../README.md`
   - 移したファイルの中の `../checker/…` → `../../checker/…`
   - 同じ置き場所のファイルどうし（`design-v1.1.md` など）は、そのまま
3. ほかの場所から設計書を指しているところを直す。
   - `README.md`（7か所）
   - `checker/README.md`（1か所）
   - `docs/README.md`（一覧の表）
   - `tests/compare-nitoyon.mjs`（コメントの2か所）
4. 前からリンクが切れているところを1つ直す。`docs/exp/design-v1.5.md` の97行目は README の文を引用していて、`docs/exp/design-v1.5.md` へのリンクが、そのファイルから見た位置では切れている。
5. 過去の設計書の中の「ファイル:行」の記述（例: `checker/js/ui.js:171-176`）は、書いた時点の基準のコミットでの記録なので書き換えない。

## 6. 確かめ方

| 確かめること | 方法 |
|---|---|
| 計算と保存 | `check-segs`・`check-dist`・`check-boost`・`check-exp`・`check-draft` が通る |
| 見た目 | 第1・2弾と同じ比較。ヘッドレス Chromium で、2つの幅（390 / 1100px）× ライト・ダーク × 13 の画面状態の計 52 通りについて、全要素の計算済みスタイル（::before・::after を含む）を `main` と比べ、一致すること |
| 動き | 同じ操作を `main` と新しいコードで行い、操作のたびに `<main>` と各ダイアログの HTML（`innerHTML`）・`localStorage` が一致すること（§6.1） |
| docs のリンク | `README.md`・`checker/README.md`・`docs/**/*.md` の相対リンクと、`#見出し` 付きのリンクが、すべてあるファイル・見出しを指していること |
| 公開の形 | `pages.yml` の版を付ける `sed` を手元で同じように当て、`checker/js/ui/*.js` の import にも `?v=` が付き、ページがエラーなく開くこと（`checker/js/*/*.js` に含まれるので、ワークフローは変えなくてよい見込み） |

### 6.1 操作の一覧（動きの比較）

ポケモン未選択から始め、次の操作を順に行う。

1. 3つのタブを切り替える
2. ポケモンを選ぶ（3タイプ）
3. サブスキルを5枠入れる。1つ外して入れ直す
4. 性格を選ぶ
5. 食材タイプで、狙い食材と食材配列を選ぶ
6. 条件を切り替える（レベル・受け取り・チケット）
7. 詳細のダイアログで、回復量・発動回数・フィールドボーナスを −／＋ と手入力で変える
8. レベル別の一覧を開き、行をタップする
9. 記録する。記録のダイアログを開き、絞り込み・評価するレベルを切り替える
10. 記録の行をタップして戻す。記録を削除して、元に戻す
11. 入力を消して、元に戻す
12. テーマを切り替える

分布は Worker の計算を待ってから比べる（「計算中」「…」が消えてから）。

## 7. 決めること（決定：D1〜D4 すべて推奨の案1）

| # | 項目 | 案 | 推奨 |
|---|---|---|---|
| D1 | 分けたファイルの置き場所 | 案1: `checker/js/ui/` にまとめる ／ 案2: `checker/js/` の直下に `ui-input.js` のように並べる | **案1**（直下はすでに13ファイルあり、タイプごとのフォルダ `berry/` などと同じ形になる） |
| D2 | `refresh` の渡し方 | 案1: 初期化でコールバックを渡す（§4.1） ／ 案2: `ui/` のファイルが `ui.js` を import する（循環 import。関数の宣言は巻き上げられるので動きはする） | **案1**（読む人が依存の向きを追いやすい） |
| D3 | §6.1 の動きの比較のスクリプト | 案1: `tests/check-ui-browser.mjs` として残す（Playwright が要る。CI では実行しない。`check-precomputed-browser.mjs` と同じ扱い） ／ 案2: 今回だけ使って残さない | **案1**（次に画面のコードを触るときにも、動きが変わっていないことを確かめられる） |
| D4 | 過去の設計書の「ファイル:行」 | 案1: 書き換えない（§5-5） ／ 案2: 今のファイルと行に書き換える | **案1**（設計書は、その時点の記録として読む） |

## 8. 採らなかった案

- **画面をフレームワーク（コンポーネント）で書き直す。**動きが変わる恐れが大きく、今回の目的（読みやすくする）に対して作業が大きすぎる。
- **`refresh` をやめ、変わった部分だけを描き直す。**描き直しの範囲を決め直すことになり、動きが変わる。分けたあとに必要になったら、別の版で考える。
- **`ui.js` も `ui/` の中に移す。**`main.js` の import と README の説明が変わるだけで、得るものが少ない。入口は今の場所に残す。
