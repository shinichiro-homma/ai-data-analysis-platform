---
paths:
  - "**/*"
---

# 一般ルール

プロジェクト全体に適用されるルール。

## 開発フロー

1. 作業開始前に `docs/plan/` で対象タスクを確認する
2. 関連する要件定義（`docs/requirements/*.md`）を確認する
3. 1タスク1機能で進める（複数タスクを同時に進めない）
4. 作業完了後に `docs/plan/` の該当カテゴリファイルのステータスを更新する

要件未確認で着手したり、複数タスクを並行したり、テスト定義があるのにテストなしで「完了」としてはならない。

## コミット規約

形式は `<type>: <subject>` ＋空行＋`<body>`。`type` は `feat`（新機能）/ `fix`（バグ修正）/ `docs`（ドキュメント）/ `refactor`（リファクタ）/ `test`（テスト）/ `chore`（ビルド・設定）のいずれか。

例:

```
feat: セッション作成APIを実装

- POST /api/kernels エンドポイントを追加
- カーネル起動処理を実装
```

メッセージは `-m` や heredoc で渡さず、`Write` で `tmp/commit-msg.txt` に書き出して `git commit -F tmp/commit-msg.txt` で渡す（コミット後に `rm tmp/commit-msg.txt`）。`.claude/hooks/prefer-commit-file.sh` が強制する。

## Bash は単一コマンドで実行する

`Bash` ツールの 1 呼び出しでは**単一コマンドのみ**を実行する。`|`・`&&`・`||`・`;`・`&` で複数コマンドを繋ぐこと（複合コマンド）は禁止し、`.claude/hooks/block-compound-commands.sh` が検出してブロックする。複数の処理が必要なときは Bash 呼び出しを分割する。

- 単一コマンドに統一することで、`settings.json` の許可リスト（コマンドのプレフィックス）が確実に効く
- 絞り込み・検索はパイプ（`... | grep`, `... | head`）ではなく `Grep` / `Read` ツールを使う
- redirect（`>`, `>>`, `2>&1`）と文字列・heredoc 本文内の `| & ;` は対象外
- 複数ステップの定型処理は `scripts/` 配下のスクリプトを使う（`.claude/rules/scripts.md` 参照）

## Bash コマンドの description は日本語で書く

`Bash` ツールの `description` は、ユーザーが承認プロンプトで即座に判断できるよう、**日本語**で具体的かつ簡潔に書く。

- 良い例: `"jupyter-mcp をリビルドして統合テストを実行"`
- 悪い例: `"Run tests"`（英語＋抽象的）、`"リビルド"`（対象不明）

## アドホックスクリプトの実行

使い捨てスクリプトは `.claude/rules/adhoc-script-execution.md` に従うこと（heredoc ワンライナー禁止、`tmp/` 配下にファイル化してから実行）。

## サブエージェントのモデル選択

Agent ツールでサブエージェントを起動する際は、**必ず `model` を明示的に指定する**（省略禁止。省略するとセッションのモデルを継承し、上位モデルが意図せず消費される）。

- **サブエージェントに Fable（Mythos クラス）を指定することは禁止**。Fable はメインコンテキストでのオーケストレーション・設計判断・最終確認専用とする
- モデルの目安: 実装・バグ修正・テスト作成は `opus`、レビュー・定型実装・影響分析は `sonnet`、調査・検索・機械的作業（コミット等）は `haiku`
- 品質はモデルの強さではなく**構造**で担保する: レビューループは `.claude/skills/review-loop/SKILL.md`、サブエージェントへの共通指示は `.claude/rules/subagent-defaults.md` を使う
