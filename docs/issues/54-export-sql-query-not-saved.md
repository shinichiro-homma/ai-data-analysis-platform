# Issue #54: export_sql でSQLクエリが data/queries/ に保存されない

## 関連タスク

- タスク番号: Jupyter 14.2

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`export_sql` MCP ツールを実行しても、SQLクエリが `data/queries/` ディレクトリに保存されない。
`execute_sql` では `saveQueryFile()` によりクエリが `data/queries/{NNN}_{filename}.sql` として自動保存されるが、`export_sql` にはこの機能が実装されていない。

## 再現手順

1. `session_create` でワークスペース付きセッションを作成
2. `export_sql` でSQLクエリを実行（例: `SELECT 1 AS test_col`, filename: `test.parquet`）
3. `file_list` で `data/queries/` を確認 → ディレクトリ自体が存在しない

## 再現確認結果

- 再現: できた
- 確認方法: MCP ツール + curl での直接 API 呼び出し
- エビデンス: `export_sql` 実行後、`data/` 配下にエクスポートファイル（Parquet）は生成されるが、`data/queries/` ディレクトリは作成されず、クエリファイルも保存されない

## 期待する動作

`export_sql` 実行時にも `execute_sql` と同様に、実行したSQLクエリが `data/queries/` に `.sql` ファイルとして保存される。

## 原因

`export-sql.ts` のハンドラー（64〜87行目）に `saveQueryFile()` の呼び出しが存在しない。

- `execute-sql.ts` では SQL 実行成功後に `resolveWorkspacePath()` → `saveQueryFile()` を呼び出してクエリを `data/queries/{NNN}_{filename}.sql` に保存している
- `export-sql.ts` は `jupyterClient.exportSql()` を呼び出してレスポンスを返すだけで終わっている
- `saveQueryFile()` は `execute-sql.ts` のモジュールスコープ内のプライベート関数であり、`export-sql.ts` からはインポートも呼び出しもできない
- 要件定義（F11）にもクエリ保存の要件が記載されておらず、仕様の不完全さも原因の一つ

## 修正方針

### アプローチ

1. `saveQueryFile()` を `execute-sql.ts` から共通ユーティリティに切り出す
2. `export-sql.ts` のハンドラーで、エクスポート成功後に `saveQueryFile()` を呼び出す
3. `export-sql.ts` に `resolveWorkspacePath` のインポートを追加する
4. レスポンスに `query_file_path` を含める
5. 要件定義（F11）に「F11.3: 実行クエリの保存」を追加する（execute_sql の F9.3 と同等）
6. 受け入れ条件 AC12 にクエリ保存の項目を追加する

### 影響範囲

- **コード変更**: jupyter-mcp コンポーネントのみ
- **要件定義変更**: `docs/requirements/jupyter-mcp.md`（F11 セクション、AC12 セクション）
- 他コンポーネント（jupyter-server 等）への影響なし

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-mcp/src/tools/execute-sql.ts` | `saveQueryFile()` を共通ユーティリティとしてエクスポート、または別ファイルに切り出し |
| `jupyter-mcp/src/tools/export-sql.ts` | `saveQueryFile()` の呼び出し追加、`resolveWorkspacePath` インポート追加、レスポンスに `query_file_path` 追加 |
| `docs/requirements/jupyter-mcp.md` | F11.3 追加（クエリ保存要件）、AC12 にクエリ保存の受け入れ条件追加 |

### テスト計画

- `jupyter-mcp/tests/integration/export-sql.test.ts` に `query_file_path` の検証テストを追加
- `jupyter-mcp/tests/integration/query-save.test.ts` に `export_sql` のクエリ保存テストケースを追加
- 既存の `execute_sql` クエリ保存テストが回帰しないことを確認

