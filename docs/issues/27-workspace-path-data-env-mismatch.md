# Issue #27: ワークスペースパスに DATA_ENV サブディレクトリが反映されず統合テスト53件が失敗

## 関連タスク

- タスク番号: Workspace 2.6（jupyter-server 環境切り替え対応）

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

jupyter-mcp の統合テスト53件が全て失敗する。ワークスペース作成は成功するが、後続のノートブック作成・セッション作成等が HTTP 500 で失敗する。

エラーメッセージ:
```
HTTP 500: Internal Server Error (Unexpected error while saving file:
workspaces/ws-XXXX/notebook.ipynb
[Errno 2] No such file or directory: '/home/jovyan/work/workspaces/ws-XXXX/notebook.ipynb')
```

## 再現手順

1. `DATA_ENV=sample`（デフォルト）の状態で Docker 環境を起動
2. `scripts/test.sh --integration jupyter-mcp` を実行
3. workspace_create 以降の全テストが失敗する

## 期待する動作

ワークスペースAPIが返すパスが Jupyter Contents API のルートからの正しい相対パスとなり、後続操作が成功する。

## 原因

### 根本原因: DATA_ENV 導入時のパス不一致

タスク Workspace 2.6 で `DATA_ENV` 環境切り替えを導入した際、`WORKSPACE_ROOT_DIR` に `DATA_ENV` サブディレクトリが追加されたが、APIレスポンスの `path` フィールドにはそれが反映されなかった。

| 項目 | パス |
|------|------|
| `WORKSPACE_ROOT_DIR` | `/home/jovyan/work/workspaces/sample` |
| 実際のディレクトリ | `/home/jovyan/work/workspaces/sample/ws-XXXX/` |
| APIが返すパス | `workspaces/ws-XXXX`（`sample` が欠落） |
| Contents APIが解決するパス | `/home/jovyan/work/workspaces/ws-XXXX/`（存在しない） |

### Issue #25 との関係

Issue #25 は同じ症状だったが、「Docker 環境の接続失敗」と誤診断され環境問題としてクローズされた。実際はコードバグ。

## 修正方針

### アプローチ

`base.py` に Jupyter Contents API ルート（`/home/jovyan/work`）からの相対パスプレフィックスを算出する定数 `WORKSPACE_PATH_PREFIX` を追加し、ハードコードされた `workspaces/{workspace_id}` を全箇所で置換する。

```python
# base.py に追加
JUPYTER_ROOT_DIR = "/home/jovyan/work"
WORKSPACE_PATH_PREFIX = os.path.relpath(WORKSPACE_ROOT_DIR, JUPYTER_ROOT_DIR)
# DATA_ENV=sample の場合: "workspaces/sample"

def workspace_contents_path(workspace_id: str) -> str:
    """workspace_id から Contents API 用の相対パスを返す"""
    return f"{WORKSPACE_PATH_PREFIX}/{workspace_id}"
```

### 影響範囲

- `jupyter-server/extensions/custom_api/` の5ファイル
- パス生成ロジックのみ。APIインターフェースの変更は不要
- 要件定義・API仕様の変更は不要（仕様通りの動作に修正するだけ）

### 修正ファイル

| ファイル | 行番号 | 変更内容 |
|----------|--------|----------|
| `base.py` | L19以降 | `WORKSPACE_PATH_PREFIX` 定数と `workspace_contents_path()` 関数を追加 |
| `workspace_handlers.py` | L35-37 | `_format_workspace_info()` の `path`/`data_path`/`output_path` を `workspace_contents_path()` で生成 |
| `session_handlers.py` | L164, L168 | `workspace_prefix` と `full_notebook_path` を `workspace_contents_path()` で生成 |
| `handlers.py` | L250 | `re.match` パターンを `WORKSPACE_PATH_PREFIX` ベースに変更 |
| `handlers.py` | L285 | 戻り値のパスを `workspace_contents_path()` で生成 |
| `sql_handlers.py` | L325 | `file_path` を `workspace_contents_path()` で生成 |

### テスト計画

1. `scripts/test.sh --integration --rebuild jupyter-mcp` で53件の失敗が全て解消されることを確認
2. `DATA_ENV=sample`（デフォルト）で動作確認
3. 既存ユニットテスト（`test_base.py`）が引き続き通ることを確認
4. 解決できないエラーが見つかった場合は新規 Issue を起票する
