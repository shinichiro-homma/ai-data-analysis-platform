# DRY 原則（Don't Repeat Yourself）

同じ知識やルールを複数箇所に書かない。単一の正（Single Source of Truth）を定め、他の箇所からは参照すること。

## 適用範囲

- `.claude/rules/` — プロジェクト全体のルール定義（正）
- `.claude/commands/` — コマンド手順。ルールの原則は `rules/` を参照し、コマンド固有の手順のみ記述する
- `.claude/skills/` — 専門知識・実装パターン。ルールの原則は `rules/` を参照する
- `docs/` — 要件定義・設計ドキュメント。`docs/STRUCTURE.md` に従う

## サブエージェントへの指示

サブエージェントのプロンプトでルールを伝える場合は、原則の全文を転記せず、ルールファイルを読むよう指示すること。

```
`.claude/rules/tdd.md` の原則に従うこと。
```

## DRY 違反としないもの（許容パターン）

- `docs/STRUCTURE.md` の SSoT テーブルで「意図的二重管理」と宣言されたもの
- 共通パッケージからの re-export ファイル（import パスの統一目的）
- npm workspaces 内の各パッケージが同じ dependency を直接宣言すること
- requirements と CLAUDE.md 間の環境変数テーブル（SSoT 注記付き）
- コンポーネントごとの設定ファイル（tsconfig, vitest.config）が共通ベースを extends/スプレッドした上で存在すること
- `docs/overview.md` のコンポーネント責務サマリーが `docs/requirements/*.md` の内容と部分的に重なること（粒度が異なるため）

## 禁止事項

- 同じルールや手順をコピー&ペーストで複数ファイルに書くこと
- ルールを変更する際に、一部のファイルだけ更新して他を放置すること
