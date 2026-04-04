# Issue #23: ユニットテストが全パスでもDocker環境での統合不具合を検出できない

## 関連タスク

- タスク番号: Infrastructure 1.1（単体テスト整備）、Infrastructure 2.2（E2Eテストシナリオ）

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`scripts/test.sh` のユニットテストが全てパスするにもかかわらず、`scripts/rebuild.sh --reset` 後に Claude Desktop で実際に操作すると以下のエラーが発生する：

- ノートブックが作成されない
- SQL クエリの実行結果が保存されない

## 再現手順

1. `scripts/test.sh` を実行 → 全テストがパスすることを確認
2. `scripts/rebuild.sh --reset` で Docker 環境をリビルド
3. Claude Desktop から MCP ツールを使用してノートブック作成・SQL 実行を試みる
4. エラーが発生する

## 再現確認結果

- 再現: できた
- 確認方法: curl で Jupyter REST API を直接呼び出し
- エビデンス: `POST /api/contents/work` → `No such directory: work`（パス解決の不整合）。ユニットテストでは `jupyterClient.createNotebook` がモックされているため検出不可。

## 期待する動作

- `scripts/test.sh` で統合テストも実行できるオプションがあること
- Docker 環境でのサービス間通信の問題がテストで検出できること
- 少なくとも主要フロー（ノートブック作成、コード実行、SQL 実行・保存）の統合テストが CI で自動実行されること

## 原因

### 根本原因

`scripts/test.sh` が `npm test`（= `vitest run`）のみを呼び出しており、統合テストが実行フローに組み込まれていない。

具体的には：

1. **document-mcp**: `vitest.config.ts` の `exclude: ['tests/integration/**']` により統合テストが明示的に除外されている
2. **jupyter-mcp**: `vitest.config.ts` に exclude 設定はないが、統合テストの `beforeAll` で `checkJupyterConnection()` が失敗し、Docker 未起動時はテストがエラーになる
3. **scripts/test.sh**: `--integration` オプションが存在せず、`npm run test:integration` を呼び出す手段がない
4. **コンポーネント側の準備は完了**: 両コンポーネントとも `vitest.config.integration.ts` と `npm run test:integration` スクリプトは定義済み

### 関連ファイル

- `scripts/test.sh` — 統合テスト実行パスが存在しない
- `document-mcp/vitest.config.ts:8` — `exclude: ['tests/integration/**']`
- `jupyter-mcp/vitest.config.ts` — include/exclude 未設定（デフォルト動作に依存）
- `jupyter-mcp/package.json:14` — `test:integration` スクリプト定義済み
- `document-mcp/package.json:14` — `test:integration` スクリプト定義済み

## 修正方針

### アプローチ

3つの検証手段と、環境の鮮度保証の仕組みを提供する：

1. **`scripts/test.sh --integration`** — 既存の統合テストスイート（vitest）を実行するオプション追加
2. **`scripts/smoke-test.sh`** — リビルド後に主要フローの動作を素早く確認するスモークテストスクリプト（新規作成）
3. **`scripts/rebuild.sh --verify`** — リビルド後にスモークテストを自動実行するオプション追加
4. **環境の鮮度保証** — 統合テスト・スモークテスト実行前に Docker 環境が最新かチェックする仕組み

#### スモークテストの内容

`scripts/smoke-test.sh` は curl ベースの軽量スクリプトで、Docker 環境の主要フローを数秒で検証する：

1. **サービス疎通確認**: jupyter-server、document-server への HTTP アクセス
2. **ノートブック作成**: `POST /api/contents/work` でワークスペース作成 → ノートブック作成
3. **コード実行**: カーネル起動 → `print("hello")` 実行 → stdout 検証
4. **SQL 実行**: `execute_sql` 相当の操作 → 結果ファイルの存在確認
5. **カタログ参照**: `GET /api/catalog/tables` → テーブル一覧が返ること

各ステップで PASS/FAIL を表示し、失敗時は具体的なエラーメッセージを出力する。

### 変更内容

#### scripts/test.sh（既存ファイル修正）
1. フラグ変数 `INTEGRATION=false` を追加
2. オプション解析に `--integration)` ケースを追加
3. `--integration` 指定時、テスト実行前に以下の鮮度チェックを実行：
   - Docker サービス（jupyter-server, document-server）の起動確認
   - ソースコードの最終更新時刻と Docker イメージのビルド時刻を比較
   - イメージが古い場合は警告を表示し、`--rebuild` オプション付きなら自動リビルド
4. テスト実行ブロックで `$INTEGRATION` が true の場合に `npm run test:integration` を呼び出す
5. MCP サーバー（jupyter-mcp, document-mcp）のビルドも実行前に自動更新（`npm run build`）
6. `--health` オプションとの併用もサポート
7. ヘルプメッセージの更新

#### scripts/smoke-test.sh（新規作成）
1. Docker サービスの起動確認（ヘルスチェック）
2. ソースコード vs Docker イメージの鮮度チェック（古い場合は警告表示）
3. 主要フロー 5 項目の curl ベース検証
4. クリーンアップ処理（テストで作成したリソースの削除）
5. 結果サマリーの表示（PASS/FAIL カウント）

#### scripts/rebuild.sh（既存ファイル修正）
1. `--verify` オプションを追加
2. リビルド完了後に `scripts/smoke-test.sh` を自動実行
3. リビルドにより Docker イメージは最新になるため、鮮度チェックは自動的に PASS

#### 鮮度チェックの仕組み

Docker イメージのビルド時刻と、各コンポーネントのソースコード最終更新時刻を比較する：

```bash
# Docker イメージのビルド時刻取得
docker inspect --format='{{.Created}}' <image_name>

# ソースコードの最終更新時刻取得
find <component>/src -name '*.ts' -newer <timestamp_file> | head -1
```

**全テスト実行時に適用**（ユニットテスト含む）：

- **ユニットテスト（`test.sh`）**: Docker サービスが起動中の場合、イメージの鮮度をチェック。古い場合は警告を表示（テストは続行）。Docker 未起動時はチェックをスキップ。
- **統合テスト（`test.sh --integration`）**: Docker サービスの起動を必須とし、鮮度チェックを実行。古い場合は警告 + `--rebuild` 併用で自動リビルド。
- **スモークテスト（`smoke-test.sh`）**: 古い場合は警告を表示（テストは続行）。
- **`rebuild.sh --verify`**: リビルド直後なので鮮度チェックは不要。

#### scripts/check-freshness.sh（新規作成）

鮮度チェックロジックを共通スクリプトとして切り出す。`test.sh` と `smoke-test.sh` から呼び出す。

```bash
# 使用例
scripts/check-freshness.sh           # 全サービスをチェック、警告のみ
scripts/check-freshness.sh --strict  # 古い場合は exit 1
scripts/check-freshness.sh --rebuild # 古い場合は自動リビルド
```

チェック対象：
- `jupyter-server`: Docker イメージ vs `jupyter-server/` ソース
- `document-server`: Docker イメージ vs `document-server/` ソース
- `jupyter-mcp`: ビルド成果物（`dist/`）vs `jupyter-mcp/src/` ソース
- `document-mcp`: ビルド成果物（`dist/`）vs `document-mcp/src/` ソース

### 影響範囲

- `scripts/test.sh` — `--integration` オプション追加
- `scripts/smoke-test.sh` — 新規作成
- `scripts/rebuild.sh` — `--verify` オプション追加
- `.claude/rules/scripts.md` — ドキュメント更新
- 要件定義・API仕様の変更は**不要**

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `scripts/test.sh` | `--integration` オプション追加、テスト実行ブロック分岐追加、ヘルプ更新 |
| `scripts/smoke-test.sh` | 新規作成：curl ベースのスモークテストスクリプト |
| `scripts/check-freshness.sh` | 新規作成：環境鮮度チェック共通スクリプト |
| `scripts/rebuild.sh` | `--verify` オプション追加 |
| `.claude/rules/scripts.md` | 新オプション・新スクリプトのドキュメント追加 |
| `.claude/rules/freshness-check.md` | 新規作成：環境鮮度保証の開発ルール |

### テスト計画

1. `scripts/test.sh --help` でヘルプに `--integration` が表示されることを確認
2. Docker 起動状態で `scripts/smoke-test.sh` を実行し、全項目 PASS を確認
3. Docker 未起動時に `scripts/smoke-test.sh` を実行し、疎通確認で FAIL することを確認
4. `scripts/test.sh --integration jupyter-mcp` で統合テストが実行されることを確認
5. 既存の `scripts/test.sh jupyter-mcp` が従来通りユニットテストのみ実行されることを確認（回帰なし）
6. `scripts/rebuild.sh --verify` でリビルド後にスモークテストが自動実行されることを確認
7. ソースコード変更後に `scripts/test.sh --integration` を実行し、鮮度チェック警告が表示されることを確認
8. `scripts/test.sh --integration --rebuild` でリビルド→テストが一括実行されることを確認
