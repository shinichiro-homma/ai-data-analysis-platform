# Issue #52: export_sql の file_path に data/ プレフィックス付きパスを渡すと INVALID_FILE_PATH エラー

## 関連タスク

- タスク番号: Jupyter 14.1, Jupyter 14.2

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`export_sql` MCP ツールの `file_path` パラメータに `data/otac_washing.parquet` のようなディレクトリ付きパスを渡すと、`INVALID_FILE_PATH` エラー（"filename contains invalid characters"）が返される。

Claude Desktop から利用する場合、AI が `file_path` に `data/` プレフィックスを付けて送信するケースが多く、実質的に export_sql が利用できなくなる。

## 再現手順

1. Claude Desktop から `export_sql` ツールを呼び出す
2. `file_path` に `data/otac_washing.parquet` を指定
3. レスポンス: `{"error": {"code": "INVALID_FILE_PATH", "message": "filename contains invalid characters"}}`

## 再現確認結果

- 再現: できた
- 確認方法: curl で直接 `POST /api/sql/export` を実行
- `data/otac_washing.parquet` → INVALID_FILE_PATH エラー
- `otac_washing.parquet` → 正常に動作（ファイルは `workspaces/{env}/{workspace_id}/data/` に保存される）

## 期待する動作

`data/otac_washing.parquet` が渡された場合、自動的に `data/` プレフィックスを除去して `otac_washing.parquet` として処理される。または MCP ツール側で入力値を正規化してからサーバーに送信する。

## 原因

### 根本原因

jupyter-mcp の `export_sql` ツールが `file_path` パラメータを正規化せずにそのまま jupyter-server へ送信している。jupyter-server 側の `_validate_filename_with_extensions()` (L246) はパストラバーサル防止のため `/` を含む文字列を一律拒否するため、`data/otac_washing.parquet` はエラーになる。

サーバーは `file_path` をファイル名のみとして受け取り、自動的に `data/` ディレクトリに保存する設計だが、ツール定義の description が「保存先ファイルパス（data/ディレクトリ内）」と曖昧なため、AI が `data/` プレフィックスを付けて送信してしまう。

### 関連ファイルと行番号

| ファイル | 行番号 | 内容 |
|----------|--------|------|
| `jupyter-server/extensions/custom_api/sql_handlers.py` | L246 | `/` を含むファイル名を拒否するバリデーション |
| `jupyter-mcp/src/tools/export-sql.ts` | L52-59 | file_path の文字列バリデーション（パス正規化なし） |
| `jupyter-mcp/src/tools/export-sql.ts` | L98-104 | file_path をそのまま jupyter-server に送信 |

### 副次的な問題

- ツール定義の `file_path` description が曖昧（「保存先ファイルパス」→ファイル名のみが正しい）
- `INVALID_FILE_PATH` エラーコードが API 仕様（`api-contracts.md`）に未記載

## 修正方針

**`execute_sql` と同じパターンに統一する。** `file_path` → `filename` にリネームし、`validateFilename()` によるバリデーションを適用する。加えて、`data/` プレフィックスの自動除去を MCP 側で行う。

理由:
- `execute_sql` は既に `filename` パラメータ + `validateFilename()` で正しく動作している
- サーバー側のパストラバーサル防止ロジックは正当なセキュリティ対策であり、変更すべきでない
- MCP ツールは AI との接点であり、AI の入力を正規化するのは MCP の責務
- パラメータ名を `filename` にすることで、AI がディレクトリ付きパスを送信する可能性を低減

### 修正内容

1. **jupyter-mcp**: `export-sql.ts` の `file_path` パラメータを `filename` にリネーム
2. **jupyter-mcp**: `validateStringParameter` → `validateFilename` に変更（パストラバーサル防止）
3. **jupyter-mcp**: `filename` から `data/` プレフィックスを自動除去する正規化を追加
4. **jupyter-mcp**: ツール定義（`index.ts`）の `file_path` → `filename` にリネーム + description を「保存先ファイル名」に修正
5. **jupyter-mcp**: `types.ts` の `SqlExportRequest` は `file_path` のまま（サーバー API の I/F は変更しない）
6. **テスト更新**: パラメータ名変更 + `data/` プレフィックス付きケースのテスト追加

### 影響範囲

- **jupyter-mcp のみ**: MCP ツールのインターフェース変更（`file_path` → `filename`）
- jupyter-server の変更は不要（REST API は `file_path` のまま）
- サーバー側の `SqlExportRequest` 型は変更不要（MCP → サーバー間は `file_path` で送信）
- 要件定義のツール定義部分は更新が望ましい

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-mcp/src/tools/export-sql.ts` | `file_path` → `filename` リネーム、`validateFilename` 適用、`data/` プレフィックス除去 |
| `jupyter-mcp/src/tools/index.ts` | ツール定義の `file_path` → `filename`、description を「保存先ファイル名」に変更 |
| `jupyter-mcp/tests/unit/tools/export-sql.test.ts` | パラメータ名変更 + `data/` プレフィックス付きテスト追加 |
| `jupyter-mcp/tests/integration/export-sql.test.ts` | パラメータ名変更 + `data/` プレフィックス付きテスト追加 |

### テスト計画

1. **ユニットテスト**: `filename: 'export.parquet'`（プレフィックスなし）が従来通り動作することを確認
2. **ユニットテスト**: `filename: 'data/otac_washing.parquet'` → `data/` が除去されて正常動作することを確認
3. **ユニットテスト**: パストラバーサル（`../evil.parquet`）が `validateFilename` で拒否されることを確認
4. **統合テスト**: `data/` プレフィックス付きで export_sql を実行し、正常にファイルが保存されることを確認
5. **回帰テスト**: 既存テストが全て通ることを確認
