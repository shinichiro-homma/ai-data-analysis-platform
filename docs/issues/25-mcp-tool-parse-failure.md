# Issue #25: 統合テスト: MCP ツール呼び出し結果のパース失敗 (31件)

## 関連タスク

- タスク番号: なし

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

jupyter-mcp の統合テストで、MCP ツール呼び出し結果の `success` フィールドが `false` を返す失敗が31件発生。
エラーメッセージ: `expected false to be true`

影響テストファイル: ai-sync-flow.test.ts (9件), execute-sql.test.ts (7件), workspace-isolation.test.ts (6件), file-list.test.ts (5件), execute-code.test.ts (2件), get-dataframe-info.test.ts (2件)

## 再現手順

1. Docker 環境が停止中、またはビルドが古い状態で統合テストを実行
2. `scripts/test.sh --integration jupyter-mcp`

## 期待する動作

統合テストが全て成功する（Docker 環境が正常に起動している状態で）

## 原因

### 根本原因: Docker 環境の接続失敗による連鎖的テスト失敗

`success: false` が返る唯一のコードパスは、各ツールの `catch (error)` ブロックで呼ばれる `createErrorResponse()` (`jupyter-mcp/src/utils/response-formatter.ts:53-72`)。

31件全ての失敗は、jupyter-server のカスタム API エンドポイント群（`/api/workspaces`, `/api/custom/sessions` 等）へのアクセス失敗が原因。ほぼ全てのテストは最初に `workspace_create` → `session_create` を呼ぶため、この初期ステップの失敗がテスト全体に連鎖する。

考えられる具体的原因:
1. Docker 環境が起動していない
2. Docker イメージが古く、カスタムAPIエンドポイントが存在しない（`scripts/check-freshness.sh` で確認可能）
3. 環境変数（`JUPYTER_TOKEN`, `JUPYTER_SERVER_URL`）の不一致

### 補足: テストファイル名の不一致

Issue に記載された `execute-sql.test.ts` と `get-dataframe-info.test.ts` は現在のコードベースに存在しない。対応するテストは `query-save.test.ts` と `variables-workflow.test.ts` に含まれている可能性がある。Issue 起票時のテスト構成と現在のコードが乖離している。

### parseToolCallResult 自体にバグはない

`parseToolCallResult` (`jupyter-mcp/tests/setup.ts:25-27`) は `result.content[0].text` を JSON パースするだけの単純な関数。パースロジックに問題はなく、ツールが `createErrorResponse` 経由で `success: false` を返していることが直接原因。

## 修正方針

### 方針: 環境起因の問題として対処 + テスト堅牢性改善

このバグはコードロジックのバグではなく、環境（Docker）の状態に起因するテスト失敗。以下の2段階で対応する。

#### 1. 環境確認と再現確認

Docker 環境を正常に起動した状態で統合テストを再実行し、問題が再現するか確認する。

```bash
scripts/check-freshness.sh --rebuild
scripts/test.sh --integration jupyter-mcp
```

再現しない場合 → Issue をクローズ（環境問題として解決）

#### 2. 再現する場合のコード修正候補

テスト失敗時のエラーメッセージを改善し、根本原因の特定を容易にする。

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-mcp/tests/setup.ts` | `parseToolCallResult` で `success: false` の場合にエラー詳細を含むアサーションメッセージを追加 |
| `jupyter-mcp/tests/setup.ts` | `checkJupyterConnection` でカスタムエンドポイント（`/api/workspaces`）の疎通も確認 |

### 影響範囲

- 修正が影響するファイル: `jupyter-mcp/tests/setup.ts` のみ
- 要件定義・API仕様の変更: 不要

### テスト計画

1. Docker 環境を起動した状態で `scripts/test.sh --integration jupyter-mcp` を実行
2. Docker 環境を停止した状態で実行し、エラーメッセージが改善されていることを確認
