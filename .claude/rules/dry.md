# DRY 原則（Don't Repeat Yourself）

同じ知識やルールを複数箇所に書かない。単一の正（Single Source of Truth）を定め、他の箇所からは参照すること。

## 適用範囲

- `.claude/rules/` — ルール定義の正
- `.claude/commands/` — コマンド固有手順のみ記述。原則は `rules/` を参照
- `.claude/skills/` — 専門知識・実装パターン。原則は `rules/` を参照
- `docs/` — 要件・設計。`docs/STRUCTURE.md` に従う

## サブエージェントへの指示

ルールの原則全文を転記せず、ルールファイルを読むよう指示する（例: `` `.claude/rules/tdd.md` の原則に従うこと。``）。

## DRY 違反としないもの（許容パターン）

- `docs/STRUCTURE.md` の SSoT テーブルで「意図的二重管理」と宣言されたもの（環境変数テーブル、overview と requirements の部分重複等を含む）
- 共通パッケージからの re-export ファイル（import パス統一目的）
- npm workspaces 内の各パッケージが同じ dependency を直接宣言すること
- コンポーネント設定ファイル（tsconfig, vitest.config 等）が共通ベースを extends/スプレッドした上で存在すること

## 禁止事項

同じルールや手順をコピー&ペーストで複数ファイルに書くこと、およびルール変更時に一部ファイルだけ更新して他を放置することを禁止する。
