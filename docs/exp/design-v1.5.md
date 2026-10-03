# 育成日数シミュレーター v1.5・厳選チェッカー v1.2 設計書

両アプリの「他アプリへのカード」（育成の「厳選チェッカーで見る」・チェッカーの「育成日数を見る」）を、ほかのカードから独立させ、ページの一番下（フッターの直前）に置く。見た目は両アプリで同じ1枚のカードにそろえる。あわせて、育成のヘッダーの右のボタンを 天秤・日程・テーマ の順にする。カードの中身と動き（リンク先・`?mon=` などのパラメータ・無効表示の条件と文言・再描画のタイミング）、計算、保存の形は変えない。作業の基準は `47fa49b`。

## 1. 今の状態（読んで確かめたこと）

| 場所 | 今 |
|---|---|
| 育成の `#toChecker`（`exp/index.html:102`） | 右の列（2つ目の `.col-in`）で、結果のカード（`#outSec`）のすぐ下・「目標レベル別」（`#lvx`）の上。入れ物は `<div class="tocheck">` で、中身は `renderToChecker`（`exp/js/main.js:101-108`）がポケモンが変わったときだけ `<a class="toexp">` か `<div class="toexp" aria-disabled="true">` に作り直す |
| 育成の右の列の並び | `#outSec` → `#toChecker` → `#lvx` → `#planSec`（育て方）→ `footer.foot` |
| 育成の `.tocheck`（`exp/css/exp.css:142-145`） | `.lvx` と同じ枠（`margin:0 0 14px`・`border:1px solid var(--line)`・`border-radius:20px`・`background:var(--card)`・`overflow:hidden`）。中の `.toexp` は上の区切り線を消す。無効は `opacity:.45` |
| チェッカーの `#toExp`（`checker/index.html:51`） | 左の列（`.col-in`）の `section.mon` の一番下にある `<a class="toexp">`。上に区切り線（`theme.css:110`）。`renderToExp`（`checker/js/ui.js:172-177`）が `refresh` のたびに `href` と `#toExpSub` を作り直す |
| チェッカーの未選択 | `MON_PARTS`（`ui.js:227`）に `toExp` があり、ポケモン未選択のときは `hidden` で隠す |
| チェッカーの右の列（`.col-out`）の並び | `section.cnd` → `#outSec` → `#lvx` → `section.detail`（`#detailSec`）→ `footer.foot` |
| チェッカーのフッター（`checker/index.html:121`） | 著作権表示の下に、文字のリンク `<p class="credit"><a href="../exp/">育成日数シミュレーター</a></p>` |
| 2列の切り替え | チェッカーは `theme.css:290-295` の `@media (min-width:960px)` で `main` を2列のグリッドにする。育成も同じ `theme.css` を読む。育成は右の列を `position:sticky`（`exp.css:131-133`） |
| `.toexp` の中身 | 左のアイコン（`--psy-ink`、20px）・`<b>`（.9rem・800）・`<small>`（.7rem・600・`--muted`）・右の ＞（14px・`--muted`）。両アプリで同じ部品 |
| 育成のヘッダー（`exp/index.html:30`） | 右: 日程（`#schedTop`）・天秤（厳選へ、`<a class="icon">`）・テーマ（`#themeBtn`） |
| 版の表示 | 育成は `exp/index.html` のログイン画面 `v1.4` とフッター `育成日数シミュレーター v1.4`。チェッカーは `checker/index.html` のログイン画面 `v1.1` とフッター `厳選チェッカー v1.1` |

## 2. 変更するファイル

| ファイル | 変更 |
|---|---|
| `exp/index.html` | `<div class="tocheck" id="toChecker">` を `#planSec` のあと、`footer.foot` の直前に移す。クラスを `tocheck` → `xapp` に。ヘッダーの右を 天秤・日程・テーマ の順に。版 `v1.4` → `v1.5`（ログイン画面とフッター） |
| `exp/css/exp.css` | `.tocheck` の3行を消す（`theme.css` の `.xapp` に移す） |
| `checker/index.html` | `#toExp` を `section.mon` から出し、`<div class="xapp" id="toExpCard">` で包んで `section.detail` のあと、`footer.foot` の直前に置く。フッターの文字のリンク（121行目の `<p class="credit">`）を消す。版 `v1.1` → `v1.2`（ログイン画面とフッター） |
| `checker/css/theme.css` | 共通のカード `.xapp`（§4）。`.toexp` の上の区切り線と、前のコメント（「ポケモンのカードの下の1行」）を直す |
| `checker/js/ui.js` | `MON_PARTS` の `'toExp'` を `'toExpCard'` に（未選択のとき、枠ごと隠すため）。`renderToExp` は変えない |
| `exp/js/main.js` | 変えない（`#toChecker` の `id` と中身の作り方はそのまま） |
| `README.md` | 「バージョン」に1行。`exp/` の行の「結果の下の『厳選チェッカーで見る』」を「ページの一番下の…」に直す |

## 3. 置き場所

### 3.1 HTML

育成（右の列の最後）:

```html
    <section class="plan-sec" id="planSec">…</section>

    <!-- 厳選チェッカーへ（チェッカーの「育成日数を見る」と同じ部品）。ポケモンだけを渡す。 -->
    <div class="xapp" id="toChecker"></div>

    <footer class="foot">…</footer>
```

チェッカー（右の列 `.col-out` の最後）:

```html
    <section class="detail" id="detailSec">…</section>

    <!-- 育成日数シミュレーターへ。このポケモン・性格のEXP補正・評価のレベル（70まで）を引き継いで開く。 -->
    <div class="xapp" id="toExpCard"><a class="toexp" id="toExp" href="../exp/">…今と同じ中身…</a></div>

    <footer class="foot">…</footer>
```

- `<a>` の `id`・`href`・中身（アイコン・`<b>`・`<small id="toExpSub">`・＞）は今のまま。`renderToExp` はそのまま動く。
- チェッカーで包む `<div>` を足すのは、育成と同じ「入れ物＋`.toexp`」の形にし、CSS を1つにするため（§7）。

### 3.2 画面の幅ごとの位置

| 幅 | 育成 | チェッカー |
|---|---|---|
| スマホ幅（〜959px、1列） | 入力のカード → 結果 → 目標レベル別 → 育て方 → **カード** → フッター | ポケモン → 食材配列 → サブスキル → 性格 → 条件 → 結果 → レベル別 → くわしい数値 → **カード** → フッター |
| PC幅（960px〜、2列） | 右の列の一番下（育て方の下・フッターの上）。右の列は今どおり上に貼りつく（sticky） | 右の列の一番下（くわしい数値の下・フッターの上） |

どちらも、2列のときはフッターと同じ右の列に入るので、「右の列の一番下」と「フッターの直前」が同時に満たされる。1列のときは右の列が下に来るので、ページの一番下になる。CSS のグリッドの指定は変えない。

## 4. 見た目（`checker/css/theme.css`）

育成の `.tocheck` を、名前を `.xapp`（他アプリへのカード）に変えて `theme.css` に移す。育成も `theme.css` を読んでいるので、両アプリで同じ1つの指定になる。

```css
/* 他アプリへのカード（チェッカーの「育成日数を見る」・育成の「厳選チェッカーで見る」）。ページの一番下に置く1枚のカード。 */
.xapp{margin:0 0 14px;border:1px solid var(--line);border-radius:20px;background:var(--card);overflow:hidden}
.xapp .toexp[aria-disabled="true"]{opacity:.45;cursor:default}
.toexp{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 16px;color:var(--ink);text-decoration:none}
```

- 枠・角丸・下の余白は `section`（`theme.css:64`：`border:1px solid var(--line)`・`border-radius:20px`・`margin:0 0 14px`）と同じ。フッターとの間も、ほかのカードとフッターの間と同じ 14px になる。
- `.toexp` の上の区切り線（`border-top`）は、`section.mon` の中の1行だったときのもの。どちらのアプリでも中の1行ではなくなるので、`.toexp` から外す（今の `.tocheck .toexp{border-top:0}` は要らなくなる）。
- アイコン（20px・`--psy-ink`）、文字の大きさ（`<b>` .9rem、`<small>` .7rem）、＞（14px）、高さ（56px 以上）、横の余白（16px）は今の `.toexp` のままで、両アプリとも同じ。
- 無効の薄さ（`.45`）は今の育成と同じ。チェッカーは無効を出さず、未選択のときは隠す（今どおり）。
- `overflow:hidden` は、角丸の内側に、押したときの色やフォーカスの枠がはみ出さないようにするため（今の `.tocheck` と同じ）。

## 5. ヘッダー（育成）

`exp/index.html:30` の `.appbar-act` の中身を、天秤（`<a class="icon" href="../checker/">`）→ 日程（`#schedTop`）→ テーマ（`#themeBtn`）の順に並べ替える。要素の中身（`aria-label`・`title`・アイコン）は変えない。チェッカー（カレンダー・しおり・テーマ）と同じく「左端が他アプリへのリンク、右端がテーマ」になる。Tab の順も見た目の順になる。

## 6. 版と README

- 育成: `exp/index.html` のログイン画面とフッターを `v1.4` → `v1.5`。
- チェッカー: `checker/index.html` のログイン画面とフッターを `v1.1` → `v1.2`。README の冒頭（「（v1.1）」）と「バージョンは…『v1.1』」も `v1.2` に。
- `README.md` の「バージョン」に1行:
  - 「v1.2 — 他アプリへのカード（チェッカーの『育成日数を見る』・育成の『厳選チェッカーで見る』）を、独立したカードにしてページの一番下（2列のときは右の列の一番下）に移した。チェッカーのフッターの文字のリンクは、カードと重なるので外した。育成日数シミュレーターは v1.5 で、ヘッダーの右を 天秤・日程・テーマ の順にした。設計は [`docs/exp/design-v1.5.md`](design-v1.5.md)。」

## 7. 確認

### テスト

- CI で動くもの（`check-segs.mjs`・`check-dist.mjs`・`check-boost.mjs`・`check-exp.mjs`・`check-draft.mjs`・`check-precomputed.mjs`）が通ること。JS の計算と判定は変えないので、テストは足さない。

### ブラウザ（Playwright のヘッドレス Chromium、390×844 のタッチと 1280×800）

`python3 -m http.server` でリポジトリを出し、ログインしてから:

1. 両アプリで、カード（`.xapp`）の次の要素が `footer.foot` であること（DOM で確かめる）。1280 幅では右の列の中、390 幅ではページの一番下にあること（位置で確かめる）。スクリーンショットを撮る。
2. 育成で「選ばない」にする → カードが `<div aria-disabled="true">`・「ポケモンを選ぶと開けます」・薄い。`?mon=mew` で開いても同じ。ポケモンを選ぶと `<a>`・「<名前>の個体を判定」になり、押すとチェッカーがそのポケモンで開く。
3. チェッカーで未選択のときカードが枠ごと隠れ、ポケモンを選ぶと出ること。押すと `?mon=…&nature=…&target=…` で育成が開くこと（今と同じ）。チェッカーのフッターに文字のリンクがないこと。
4. 育成のヘッダーの右が 天秤・日程・テーマ の順であること。
5. 両アプリでカードの角丸・枠・余白・アイコン・文字の大きさが同じこと（計算されたスタイルを比べる）。ライト・ダークで見る。
6. 版の表示（育成 v1.5、チェッカー v1.2）。コンソールのエラーが0件。

## 8. 迷った点・前提を置いた点

- **チェッカーで包む `<div>` を足す。** `<a class="toexp xapp">` のように `<a>` に直接枠を付けることもできるが、育成は `<a>`／`<div>` を入れ替えるので入れ物が要る。両アプリで同じ形（入れ物＋`.toexp`）にし、CSS を1つにした。未選択で隠すのは入れ物（`#toExpCard`）にする。
- **未選択のチェッカーでは、今どおりカードを隠す。** 指定の「無効表示の条件は変えない」に従い、育成のような無効表示には変えない。未選択のときは、くわしい数値なども隠れるので、カードもない状態になる（今と同じ）。
- **クラス名を `.tocheck` から `.xapp` に変える。** 両アプリで使う名前なので、「厳選へ」の意味の名前をやめた。`id`（`#toChecker`・`#toExp`）は JS とテストが使うので変えない。
- **育成の右の列は sticky のまま（レビューで決定）。** 画面イメージ（1280×800）で、右の列が画面より高いと、ページを一番下まで送ってもカードが画面の上にはみ出て見えず、フッターの一部だけが残ることを確かめた（今の「育て方」も同じ）。sticky をやめる案も示したが、レビューで今のままでよいとなったので、sticky の指定は変えない。

## 9. 考えたが採らなかった案

| 案 | 採らなかった理由 |
|---|---|
| カードを `section` にする | `section` は 18px 16px の内側の余白が付き、`.toexp` の 8px 16px と二重になる。打ち消しの指定が増えるだけなので、今の育成と同じ枠だけの入れ物にした |
| 2列のときにカードを `main` の直下に出し、2列にまたがる帯にする | 指定は「右の列の一番下」。またがると、1列のときとカードの並び方が変わり、HTML の順と見た目の順もずれる |
| カードをフッターの中に入れる | フッターは著作権表示・版などの小さい文字の場所で、カードの余白・枠とそろわない。指定の「独立したカード」にも合わない |
| チェッカーで未選択のときも無効のカードを出す | 「無効表示の条件と文言は変えない」の範囲外。文言を新しく決める必要もある |
| フッターの文字のリンクを残す | 指定のとおり、カードと重なるので消す。育成のフッターの「厳選チェッカーへ」は指定にないので残す |
| `.xapp` を `exp.css` とチェッカー用の2か所に書く | 同じ値を2か所で保つことになり、ずれやすい。育成も読んでいる `theme.css` の1か所にした |

## 10. 確かめた結果

- テスト: `check-segs.mjs`・`check-dist.mjs`・`check-boost.mjs`・`check-exp.mjs`・`check-draft.mjs`・`check-precomputed.mjs`（`scripts/precompute-dist.mjs` のあと）がすべて通った。
- ブラウザ（390×844 タッチ・1280×800、ライト・ダーク）:
  - 両アプリでカードの次の要素が `footer.foot`。前は育成が `#planSec`、チェッカーが `#detailSec`。どちらも右の列の中。
  - カードの計算されたスタイルが両アプリで同じ（角丸 20px・枠 1px・下の余白 14px・高さ 56px・横の余白 16px・区切り線なし・文字 14.4px／11.2px・アイコン 20px）。
  - 育成の無効表示（`?mon=mew` で開いて未選択）: `<div aria-disabled="true">`・「ポケモンを選ぶと開けます」・`opacity:.45`。ポケモンありは `../checker/?mon=walrein`。押すとチェッカーがそのポケモンで開く。
  - チェッカーの未選択ではカードが枠ごと隠れる。ポケモンありは `../exp/?mon=walrein&nature=none&target=60` で、押すと育成がそのポケモンで開く（URL は既存の `replaceState` で消える）。フッターの文字のリンクはない。
  - 育成のヘッダーの右が 天秤・日程・テーマ の順。
  - 版の表示: 育成 v1.5、チェッカー v1.2。ページのエラーは0件（コンソールのエラーは、この環境から Google Fonts に繋がらないことによるものだけ）。
