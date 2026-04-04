# Issue #46: production環境でDB接続失敗しDockerがフリーズする

## 関連タスク

- タスク番号: Jupyter Phase 9（SQL実行機能）, Workspace Phase 2（データ環境分離）, Infrastructure Phase 5（テーブル追加自動化）

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

Claude Desktop から FY24のスターランク別会員数集計プロンプト実行時、production環境でPostgreSQLに接続できず、Dockerがフリーズした。

## 再現手順

1. `scripts/switch-env.sh production` でproduction環境に切り替え
2. `docker compose up -d` で全コンテナ起動
3. Claude Desktop から execute_sql を使うプロンプトを実行
4. DB接続失敗 → リトライの末Dockerがフリーズ

## 再現確認結果

- 再現: 未確認（ディスク容量不足でスキップ）

## 期待する動作

- production環境でもjupyter-serverからPostgreSQLに正常接続できること
- DB接続失敗時に適切なエラーを返し、Dockerがフリーズしないこと

## 推定原因

- production環境の大量データロード（26テーブル、90列超）によるDockerリソース逼迫
- Docker Desktop for macOS のリソース限界
- switch-env.sh の pg_isready 待機時間（30秒）不足の可能性

## 原因（調査後に記入）

3層の問題が連鎖してフリーズに至っている。

### 原因1（トリガー）: DB初期化完了前にサービスが接続を試みる

- `scripts/switch-env.sh` の `pg_isready` チェック（L111-121）は、PostgreSQLプロセスが接続を受け付けるかのみ確認する
- `docker-entrypoint-initdb.d/` のスクリプト（テーブル作成 + CSVデータロード）の完了は確認していない
- production環境は27テーブル + 26CSVで、sample（3テーブル）の数倍〜数十倍の初期化時間を要する
- 30秒のタイムアウトではproduction環境の初期化完了を待ちきれない
- docker-compose.yml の PostgreSQL healthcheck にも `start_period` が未設定

### 原因2（増幅）: jupyter-server のスレッドプールリーク

- `sql_handlers.py` L130-158: `_execute_sql_sync` は毎回 `create_engine()` で新規エンジンを生成
- `asyncio.wait_for` でタイムアウトしても `run_in_executor` のスレッドはキャンセルされない
- DB接続失敗が繰り返されるとスレッドが蓄積し、リソースを圧迫
- `connect_timeout=10` 秒のスレッドが複数並走 → ThreadPoolExecutor のワーカー上限に到達

### 原因3（リトライループ）: jupyter-mcp のエラーレスポンスに isError フラグがない

- `execute-sql.ts` L122-127: エラー時に `createErrorResponse()` を返すが `isError: true` が設定されていない
- MCPプロトコル上は「成功レスポンス」として扱われる
- Claude Desktop（LLM）がソフトエラーと判断し、自律的にリトライを繰り返す
- 各リトライが原因2のスレッド蓄積を加速させる

### 関連要因: Docker リソース制限の未設定

- docker-compose.yml にどのサービスも `mem_limit`/`cpus` が設定されていない
- production環境の大量データロードがホストのリソースを食い尽くし、Docker Desktop自体がフリーズ

### 仕様の不足

- DB接続タイムアウトの仕様が未定義（SQLクエリタイムアウトのみ定義）
- リトライポリシーが未定義
- ヘルスチェックにDB接続状態が含まれていない

## 修正方針（調査後に記入）

### アプローチ: 3層それぞれで防御する

#### 修正A: switch-env.sh — DB初期化完了を確認する

`pg_isready` に加えて、テーブルの存在確認クエリで初期化完了を検証する。production環境のタイムアウトを120秒に延長する。

```bash
# pg_isready 後にテーブル存在確認
docker compose exec -T postgres psql -U jupyter -d analysis_db \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" \
  | grep -q "27"  # production: 27テーブル
```

docker-compose.yml の PostgreSQL healthcheck に `start_period: 30s` を追加する。

#### 修正B: jupyter-server — スレッドリークを防止する

`_execute_sql_sync` で毎回エンジンを生成する代わりに、接続タイムアウトを短くし、エンジン生成時にプールサイズを制限する。

```python
engine = sqlalchemy.create_engine(
    database_url,
    connect_args={"connect_timeout": 5},  # 10→5秒に短縮
    pool_size=1,
    max_overflow=0,
)
```

#### 修正C: jupyter-mcp — エラーレスポンスに isError フラグを設定する

`execute-sql.ts` のエラーレスポンスに `isError: true` を設定し、Claude Desktop がリトライしないようにする。

```typescript
return createErrorResponse(
  extractErrorMessage(error),
  extractErrorCode(error),
  true  // isError フラグ
);
```

他の MCP ツールのエラーレスポンスも同様に `isError: true` を設定する。

#### 修正D: docker-compose.yml — PostgreSQL にリソース制限を追加

```yaml
postgres:
  ...
  healthcheck:
    ...
    start_period: 30s  # 追加
```

### 影響範囲

- `scripts/switch-env.sh` — 環境切り替えスクリプト
- `jupyter-server/extensions/custom_api/sql_handlers.py` — SQL実行ハンドラー
- `jupyter-mcp/src/tools/execute-sql.ts` — execute_sql ツール
- `jupyter-mcp/src/utils/response-formatter.ts` — エラーレスポンス生成（isError対応）
- `docker-compose.yml` — PostgreSQL healthcheck設定
- 要件定義・API仕様の変更: 不要（実装上の改善のみ）

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `scripts/switch-env.sh` | pg_isready 後にテーブル存在確認を追加、production用タイムアウトを120秒に延長 |
| `jupyter-server/extensions/custom_api/sql_handlers.py` | `create_engine` に `pool_size=1, max_overflow=0` を追加、`connect_timeout` を5秒に短縮 |
| `jupyter-mcp/src/tools/execute-sql.ts` | エラーレスポンスに `isError: true` を設定 |
| `jupyter-mcp/src/utils/response-formatter.ts` | `createErrorResponse` に isError パラメータを追加 |
| `docker-compose.yml` | PostgreSQL healthcheck に `start_period: 30s` を追加 |

### テスト計画

1. **ユニットテスト**: `jupyter-mcp/tests/unit/tools/execute-sql.test.ts` でエラーレスポンスに `isError: true` が含まれることを検証
2. **手動テスト（sample環境）**: `scripts/switch-env.sh sample` でテーブル存在確認が正常に動作することを確認
3. **手動テスト（production環境）**: ディスク容量確保後、`scripts/switch-env.sh production` で初期化完了まで待機できることを確認
4. **回帰テスト**: `scripts/test.sh jupyter-mcp` で既存テストが通ることを確認
