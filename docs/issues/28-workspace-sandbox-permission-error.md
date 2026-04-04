# Issue #28: ワークスペース間アクセス制限のサンドボックスが PermissionError を発生させない

## 関連タスク

- タスク番号: なし（サンドボックス機能の既存バグ）

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`workspace-access-restriction.test.ts` の3件のテストが失敗する。ワークスペース A のカーネルからワークスペース B のファイルにアクセスした際、期待される `PermissionError` が発生せず `NO_ERROR` となる。

失敗するテスト:
1. ワークスペース外ファイルの読み取りが PermissionError になる
2. ワークスペース外への os.chdir() が PermissionError になる
7. pathlib.Path でのワークスペース外アクセスが PermissionError になる

## 再現手順

1. `docker-compose up -d` で Docker 環境を起動
2. `scripts/test.sh --integration jupyter-mcp` を実行
3. `workspace-access-restriction.test.ts` のテスト1, 2, 7 が失敗する

## 期待する動作

`session_create` 時にカーネルへ注入されるサンドボックスコードが、ワークスペース外のファイルアクセスを `PermissionError` で拒否する。

## 原因

テストコードがワークスペース B のパスを構築する際、カーネル内で `os.environ.get('WORKSPACE_ROOT_DIR', '/home/jovyan/work/workspaces')` を使用しているが、`WORKSPACE_ROOT_DIR` は環境変数として設定されていないため、フォールバック値 `/home/jovyan/work/workspaces` が使われる。

DATA_ENV 導入後、実際のワークスペースルートは `/home/jovyan/work/workspaces/sample`（`base.py` で `DATA_ENV` から算出）であり、テストが構築するパス `/home/jovyan/work/workspaces/ws-BBBB/...` はサンドボックスの `_WORKSPACE_ROOT`（`/home/jovyan/work/workspaces/sample`）配下ではない。そのため `_is_denied()` が `False`（許可）を返し、PermissionError が発生しない。

テスト6（相対パス `../ws-BBBB`）はカーネルの cwd からの相対解決で正しいパスになるため成功している。

関連ファイル:
- `jupyter-mcp/tests/integration/workspace-access-restriction.test.ts` 99行目, 125行目, 234行目: フォールバック値にDATA_ENVサブディレクトリが含まれていない
- `jupyter-server/extensions/custom_api/base.py` 16-18行目: WORKSPACE_ROOT_DIR の定義（Python モジュール変数のみ、環境変数としては未設定）

## 修正方針

テストコードのパス構築方法を修正する。カーネル内では `WORKSPACE_ROOT_DIR` 環境変数が利用できないため、カーネルの cwd（ワークスペース A のディレクトリ）から `os.path.dirname(os.getcwd())` で親ディレクトリ（= ワークスペースルート）を取得する。

この方法はサンドボックスコード自身が `os.path.dirname(workspace_dir)` でワークスペースルートを算出しているのと同じロジックであり、DATA_ENV の有無に依存しない。

### 影響範囲

テストファイル 1 ファイルのみ。要件定義・API仕様の変更は不要。

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-mcp/tests/integration/workspace-access-restriction.test.ts` | テスト1, 2, 7 のパス構築を `os.path.dirname(os.getcwd())` ベースに変更 |

### テスト計画

1. `scripts/test.sh --integration jupyter-mcp` で統合テストを実行し、テスト1, 2, 7 が成功することを確認
2. テスト3, 4, 5, 6 が引き続き成功することを確認（回帰テスト）
