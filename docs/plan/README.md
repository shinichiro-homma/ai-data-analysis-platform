# 開発プラン

## 概要

開発タスクの一覧と進捗を管理する。コンポーネント群別に4ファイルに分割し、**進行中・未着手のタスクのみ**を保持する。完了したタスクは [archive/](archive/README.md) に退避する。

**方針:**
- 機能単位でタスクを整理（技術スタック単位ではなく）
- 各Phaseで独立してE2Eテストが可能な粒度

## ファイル構成

| ファイル | カテゴリ |
|---------|---------|
| [01-jupyter.md](01-jupyter.md) | Jupyter（server + mcp + ai-sync） |
| [02-document.md](02-document.md) | Document（server + mcp） |
| [03-workspace.md](03-workspace.md) | Workspace（cross-cutting） |
| [04-infrastructure.md](04-infrastructure.md) | Infrastructure |

完了した Phase・タスクは [archive/](archive/README.md) 配下の同名ファイルにある。

## ステータス凡例

- `[ ]` 未着手
- `[→]` 進行中
- `[x]` 完了（Phase 内に未完了タスクが残っている間のみ、この表記でカテゴリファイルに残る）
- `[!]` ブロック中（理由をメモ）

## 番号体系

Phase 番号はカテゴリ内の連番で、**アーカイブ済みの Phase も含めた通し番号**とする（新しい Phase は既存の最大番号 + 1）。タスク番号は `{Phase番号}.{タスク番号}`。

タスクの詳細計画は `docs/tasks/{カテゴリ}/` に置く（命名規則は `.claude/skills/task-plan-creation/SKILL.md` を参照）。

## アーカイブ規約

読み込みコンテキストを最小に保つため、完了した作業はアーカイブへ退避する。タスク完了時（PR 作成時）に以下を実施すること。

1. カテゴリファイルの該当タスク行のステータスを `[x]` に更新する
2. **Phase 内の全タスクが完了したら**、その Phase のセクション全体（見出し・説明・タスク表）を `docs/plan/archive/{同名ファイル}` の末尾へ移動する
3. `docs/tasks/{カテゴリ}/` にある該当タスクの詳細計画ファイルを `docs/tasks/archive/{カテゴリ}/` へ移動する
4. Issue 起因の修正の場合は、`docs/issues/` の該当ファイル（参照している画像等の添付ファイルを含む）を `docs/issues/archive/` へ移動する

移動時のルール:

- Phase セクションはアーカイブ側ファイルの**末尾に追記**し、見出し・表の形式は変えない（Phase 番号順が保たれる）
- アーカイブ済みタスクへの参照は `archive/` 込みの相対パスで書く
