タスク「$ARGUMENTS」を開始します。

以下の手順で作業してください：

## 1. 未コミットの変更確認

まず、未コミットの変更がないか確認してください：

```bash
git status
```

未コミットの変更がある場合は、先にコミットまたはスタッシュしてください。

## 2. feature ブランチの切り替え

`.claude/rules/branch-workflow.md` の「ブランチ切り替え」に従い、対象タスクの feature ブランチに切り替えてください。
ブランチが存在しない場合は「ブランチ作成」に従って作成してください。

## 3. タスク計画の確認

`docs/tasks/` ディレクトリに、タスク $ARGUMENTS の計画ファイルが存在するか確認してください。

**ファイル名パターン:** `docs/tasks/**/$ARGUMENTS-*.md`

### 計画ファイルが存在しない場合

先に `/custom-plan-task $ARGUMENTS` を実行して、計画を作成・レビューしてください。

**計画なしで実装を開始しないでください。**

### 計画ファイルが存在する場合

計画ファイルを開き、以下を確認してください：

- [ ] 「レビューステータス」の「計画レビュー完了」にチェックが入っている
- [ ] 実装計画が明確である
- [ ] 完了条件が明確である

レビューが完了していない場合は、先にレビューを依頼してください。

## 4. タスクの確認

`docs/plan/README.md` を Read ツールで読み、対象カテゴリファイルを特定してから該当カテゴリファイルも Read し、タスク $ARGUMENTS を見つけてください。

タスクが存在し、ステータスが `[ ]`（未着手）であることを確認してください。

## 5. ステータス更新

タスク $ARGUMENTS のステータスを `[ ]` から `[→]` に更新してください。

**注意: `[x]`（完了）にしないこと。`[→]`（進行中）に更新すること。完了は `/custom-complete-task` で行う。**

## 6. 関連 Skill の確認

タスクの内容に応じて、以下の Skill を確認してください：

| タスク内容 | 参照する Skill |
|-----------|---------------|
| MCP サーバー実装（jupyter-mcp, document-mcp） | `.claude/skills/mcp-typescript-server/SKILL.md` |
| JupyterLab 拡張実装（jupyterlab-ai-sync） | `.claude/skills/jupyterlab-extension/SKILL.md` |
| Jupyter カーネル通信 | `.claude/skills/jupyter-kernel-communication/SKILL.md` |

**Skill がある場合は実装前に必ず読んでください。**

## 7. テスト準備（Red フェーズ）

`.claude/rules/tdd.md` の「Red フェーズ」に従い、実装の**前に**テストを準備してください。

## 8. 実装（Green フェーズ）

`.claude/rules/tdd.md` の「Green フェーズ」に従い、計画ファイルの「実装計画」に沿って実装してください。

## 9. リビルド＋テスト（Green 確認）

`scripts/test.sh --rebuild {対象コンポーネント名}` を実行してください。
`.claude/rules/rebuild-before-test.md` に従うこと。

## 10. 開始報告

以下の形式で報告してください：

```
## タスク開始

- タスク: $ARGUMENTS
- 計画ファイル: docs/tasks/{カテゴリ}/{ファイル名}.md
- 実装内容: （計画の概要）

計画に従って実装を開始します。
```
