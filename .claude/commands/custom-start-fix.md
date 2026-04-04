Issue #$ARGUMENTS の修正を実装します。

以下の手順で作業してください：

## 1. 未コミットの変更確認とブランチ切り替え

まず、未コミットの変更がないか確認してください：

```bash
git status
```

未コミットの変更がある場合は、先にコミットまたはスタッシュしてください。

次に、`.claude/rules/branch-workflow.md` の「ブランチ切り替え」に従い、対象 Issue の fix ブランチに切り替えてください。
ブランチが存在しない場合は「ブランチ作成」に従って作成してください。

## 2. イシュー詳細ファイルの確認

`docs/issues/` ディレクトリから、Issue #$ARGUMENTS に対応するファイルを探して読んでください。

### 確認事項

以下をすべて確認してください：

- [ ] ファイルが存在する
- [ ] 「修正方針レビュー完了」にチェックが入っている
- [ ] 原因が記載されている
- [ ] 修正ファイル一覧が記載されている
- [ ] テスト計画が記載されている

**「修正方針レビュー完了」にチェックが入っていない場合は、先に `/custom-fix-bug $ARGUMENTS` を実行して設計を完了させてください。設計なしで実装を開始しないでください。**

## 3. 関連ドキュメントの確認

イシュー詳細ファイルに記載されている関連ドキュメントを確認してください：

- 影響範囲に記載されたファイル
- 関連する要件定義（`docs/requirements/*.md`）
- 関連するAPI仕様（`docs/design/api-contracts.md`）

## 4. 関連 Skill の確認

修正対象に応じて、以下の Skill を確認してください：

| 修正対象 | 参照する Skill |
|----------|---------------|
| MCP サーバー（jupyter-mcp, document-mcp） | `.claude/skills/mcp-typescript-server/SKILL.md` |

**Skill がある場合は実装前に必ず読んでください。**

## 5. 修正の実装

イシュー詳細ファイルの「修正ファイル」一覧に従って、修正を実装してください。

実装中は以下に注意してください：

- 修正方針から逸脱しない
- 影響範囲外のファイルを不必要に変更しない
- 修正に伴う要件定義・API仕様の変更が必要な場合は、`/custom-change-requirement` で別途対応する

## 6. リビルド＋テストの実行

`scripts/test.sh --rebuild {対象コンポーネント名}` を実行してください。
`.claude/rules/rebuild-before-test.md` に従うこと。

イシュー詳細ファイルの「テスト計画」に追加のテスト項目がある場合は、それも実施してください。

### ブラウザ動作確認

対象がブラウザ動作確認に該当するかの判定と手順は `.claude/rules/testing.md` に従うこと。バグの再現手順に沿って操作し、修正後は症状が解消されていることを確認する。必要に応じて `browser_take_screenshot` でエビデンスを記録する。

## 7. 完了処理

修正が完了したら、以下を行ってください：

1. イシュー詳細ファイルのステータスを更新：
   ```markdown
   - [x] 修正完了   ← チェックを入れる
   ```

2. コミットメッセージに Issue 番号を含める：
   ```
   fix: {修正内容の要約}

   Refs #{Issue番号}
   ```

3. `tests/known-failures.json` に該当エントリがあれば削除する：
   ```bash
   scripts/manage-known-failures.sh list
   scripts/manage-known-failures.sh remove --id {kf-XXX}
   ```

4. `.claude/rules/branch-workflow.md` の「PR 作成」に従い、fix → dev の PR を作成する

5. `.claude/rules/branch-workflow.md` の「CI 待機 + Issue クローズ」に従い、CI パス後に Issue をクローズする。CI が失敗した場合は Issue をクローズせず、修正を案内して停止する

6. 以下の形式で報告する：
   ```
   ## 修正完了

   - Issue: #$ARGUMENTS
   - PR: {PR URL}
   - 設計ファイル: docs/issues/{番号}-{名前}.md

   ### 修正内容
   （修正の要約）

   ### テスト結果
   （テスト結果の要約）
   ```
