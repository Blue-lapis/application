# 設計書・要件定義書の一覧

`docs/` には2つのアプリの設計書・要件定義書があります。**番号の数え方がアプリごとに違う**ので、読むときはどちらのアプリのものかを先に確かめてください。

| 置き場所 | アプリ | 番号の意味 |
|---|---|---|
| `docs/`（直下） | 厳選チェッカー（`checker/`） | 計算と機能の設計の版（ver1.1〜ver1.10）。画面に出すリリースの番号（v1.0〜v1.2）とは別 |
| `docs/exp/` | 育成日数シミュレーター（`exp/`） | リリースの番号（画面に出す v1.0〜v1.5）と同じ |

そのため `docs/design-v1.4.md`（チェッカーの ver1.4）と `docs/exp/design-v1.4.md`（育成日数シミュレーターの v1.4）は、名前は似ていても別のものです。

## 厳選チェッカー（`docs/`）

要件定義がない版は、設計書だけがあります。

| 版 | 内容 | 要件定義 | 設計書 |
|---|---|---|---|
| ver1.1 | きのみタイプの評価基準の見直しと上位%の表示・確率モデルの整備 | [requirements-v1.1.md](requirements-v1.1.md) | [design-v1.1.md](design-v1.1.md) |
| ver1.2 | 食材タイプの評価基準の見直し | [requirements-v1.2.md](requirements-v1.2.md) | [design-v1.2.md](design-v1.2.md) |
| ver1.3 | スキルタイプの評価基準の見直し | [requirements-v1.3.md](requirements-v1.3.md) | [design-v1.3.md](design-v1.3.md) |
| ver1.4 | スキルタイプの分布計算の高速化 | [requirements-v1.4.md](requirements-v1.4.md) | [design-v1.4.md](design-v1.4.md) |
| ver1.5 | にとよんツールとの計算の一致 | [requirements-v1.5.md](requirements-v1.5.md) | [design-v1.5.md](design-v1.5.md) |
| ver1.6 | 計算の高速化と整理 | — | [design-v1.6.md](design-v1.6.md) |
| ver1.7 | レベルの選択（Lv.50 を追加）とサブスキルの5枠入力 | — | [design-v1.7.md](design-v1.7.md) |
| ver1.8 | きのみタイプのフィールドボーナスと好きなきのみ | — | [design-v1.8.md](design-v1.8.md) |
| ver1.9 | 上位%の分布の事前計算（あわせて、レベル別の一覧と、Lv.50 でまだ出ない狙い食材を押せなくする変更） | [requirements-v1.9.md](requirements-v1.9.md) | [design-v1.9.md](design-v1.9.md) |
| ver1.10 | 入力のポケモンごとの保存と初期値の変更（リリースの v1.1） | — | [design-v1.10.md](design-v1.10.md) |

リリースの v1.2（他アプリへのカードをページの一番下に移す）は、育成日数シミュレーター v1.5 と同じ設計書 [exp/design-v1.5.md](exp/design-v1.5.md) にあります。

## 育成日数シミュレーター（`docs/exp/`）

| 版 | 内容 | 文書 |
|---|---|---|
| v1.0 | 要件定義（v0.1〜v0.8 の試作の経緯と、v1.1 以降の追加も追記している） | [exp/requirements-v1.0.md](exp/requirements-v1.0.md) |
| v1.4 | 「厳選チェッカーで見る」のカードと、両アプリのヘッダーの整理 | [exp/design-v1.4.md](exp/design-v1.4.md) |
| v1.5 | 他アプリへのカードをページの一番下に移す（厳選チェッカー v1.2 と共通） | [exp/design-v1.5.md](exp/design-v1.5.md) |

v1.1〜v1.3 は設計書を作っていません（変更の内容はリポジトリ直下の [README](../README.md#育成日数シミュレーター) の版の一覧にあります）。
