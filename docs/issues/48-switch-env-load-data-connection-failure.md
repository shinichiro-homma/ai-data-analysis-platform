# Issue #48: switch-env.sh --force-reload production で load-data.py が DB 接続に失敗する

## 関連タスク

- タスク番号: Workspace 2.2, Workspace 2.3, Infrastructure 5.1, Infrastructure 5.2
- 関連 Issue: #46（クローズ済み、同様の DB 接続失敗問題）

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`scripts/switch-env.sh --force-reload production` 実行時、`run_load_data` ステップで `load-data.py` が PostgreSQL への接続に失敗する。

Python エラー:
```
psycopg2.OperationalError: connection to server at "localhost" (::1), port 5432 failed: server closed the connection unexpectedly
```

Docker ログ:
```
FATAL:  password authentication failed for user "postgres"
DETAIL:  Role "postgres" does not exist.
```

## 再現手順

1. `scripts/generate-init-scripts.sh production` を実行
2. `scripts/switch-env.sh --force-reload production` を実行
3. `=== Loading data from host ===` の後で接続エラーが発生

## 再現確認結果

- 再現: できた
- 確認方法: `switch-env.sh --force-reload production` を実行し、同一エラーを確認
- エビデンス:
  - Docker ログで `Role "postgres" does not exist` を確認
  - PostgreSQL コンテナは healthy 状態
  - 正しい認証情報（jupyter/jupyter-dev-password/analysis_db）では接続成功
  - `load-data.py` のデフォルト値（postgres/postgres/analysis）では接続失敗

## 期待する動作

- `switch-env.sh --force-reload production` が正常に完了し、production データがロードされること

## 原因

`load-data.py` の自動生成テンプレート (`scripts/lib/generate_init.py:284-286`) で、`psycopg2.connect()` のデフォルト値が `postgres/postgres/analysis` にハードコードされている。

実際の DB 設定は `.env` で `jupyter/jupyter-dev-password/analysis_db` であり、`common.sh` の `run_load_data` 関数はこの値を環境変数 `PGUSER`/`PGPASSWORD`/`PGDATABASE` として渡している。しかし、何らかの理由で環境変数が未設定になった場合（`.env` が見つからない、grep が失敗する等）、`load-data.py` は不正なデフォルト値で接続を試行し失敗する。

### 根本原因の箇所

| ファイル | 行番号 | 問題 |
|----------|--------|------|
| `scripts/lib/generate_init.py` | 284-286 | テンプレートのデフォルト値が `postgres/postgres/analysis` |
| `postgres/init/production/load-data.py` | 137-139 | 生成済みファイルに同じデフォルト値 |
| `postgres/init/sample/load-data.py` | 37-39 | 生成済みファイルに同じデフォルト値 |

### 呼び出しフロー

```
switch-env.sh --force-reload production
  → run_load_data "production"  (common.sh:130)
    → .env から POSTGRES_USER/PASSWORD/DB を読み取り
    → PGUSER/PGPASSWORD/PGDATABASE として python3 load-data.py に渡す
      → load-data.py: os.environ.get("PGUSER", "postgres")  ← 環境変数なければ不正デフォルト
```

## 修正方針

### アプローチ: デフォルト値を実環境に合わせる

`generate_init.py` のテンプレートと、生成済みの `load-data.py` のデフォルト値を `jupyter`/（パスワードはデフォルトなし）/`analysis_db` に変更する。

パスワードのみデフォルト値を設定せず、環境変数必須とする（セキュリティ上、パスワードをハードコードしない）。環境変数が未設定の場合は明確なエラーメッセージを出す。

```python
conn = psycopg2.connect(
    host=os.environ.get("PGHOST", "localhost"),
    port=os.environ.get("PGPORT", "5432"),
    user=os.environ.get("PGUSER", "jupyter"),
    password=os.environ["PGPASSWORD"],  # 必須（デフォルトなし）
    dbname=os.environ.get("PGDATABASE", "analysis_db"),
)
```

### 影響範囲

- `scripts/lib/generate_init.py` — テンプレート（根本修正）
- `postgres/init/production/load-data.py` — 生成済みファイル（再生成で反映）
- `postgres/init/sample/load-data.py` — 生成済みファイル（再生成で反映）
- 要件定義・API仕様の変更は不要

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `scripts/lib/generate_init.py` | テンプレートの psycopg2.connect デフォルト値を修正（user→jupyter, password→必須, dbname→analysis_db） |
| `postgres/init/production/load-data.py` | `scripts/generate-init-scripts.sh production` で再生成 |
| `postgres/init/sample/load-data.py` | `scripts/generate-init-scripts.sh sample` で再生成 |

### テスト計画

1. `scripts/generate-init-scripts.sh sample` で再生成し、デフォルト値が正しいことを確認
2. `scripts/generate-init-scripts.sh production` で再生成し、同様に確認
3. `scripts/switch-env.sh --force-reload sample` で正常にデータロードされることを確認
4. 回帰テスト: `scripts/test.sh` で既存テストが通ることを確認
