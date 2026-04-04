# Issue #19: execute-code-images テスト失敗

## 関連タスク

- タスク番号: なし

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`jupyter-mcp/tests/integration/execute-code-images.test.ts` の4テストのうち3テストが失敗する。

- matplotlib でグラフを描画するとexecute_code が `success: false` を返す
- グラフなしコード（`print("hello")`）は正常に動作する

## 再現手順

1. `docker-compose up -d` で jupyter-server を起動
2. `scripts/test.sh jupyter-mcp` でテスト実行
3. execute-code-images の3テスト（matplotlib使用）が失敗

## 期待する動作

matplotlib でグラフを描画した場合、`execute_code` のレスポンスに `images` 配列が `file_path` 付きで返り、`success: true` となること。

## 原因

2つの問題が連鎖している。

### 原因1: jupyter-server — ワークスペース解決の失敗

`handlers.py:236` の `_resolve_workspace_for_kernel` 関数が `(None, None)` を返す。

**ステップ1の失敗**: `session_manager.list_sessions()` でカーネルを検索するが、`session_handlers.py:175-177` で `notebook_path` なしの場合は Jupyter session_manager にセッションを登録しないため、見つからない。

**ステップ2の失敗**: `getattr(kernel, "cwd", None)` でカーネルの作業ディレクトリを取得しようとするが、`jupyter_client.KernelManager` にも `LocalProvisioner` にも `cwd` 属性が存在しない。`cwd` は `start_kernel()` 時に `subprocess.Popen` に渡されるだけで、オブジェクトに保存されない。

**結果**: `_save_display_image` で `output_dir=None` → 画像ファイルが保存されず `file_path: null` で返される。

### 原因2: jupyter-mcp — null file_path のハンドリング不足

`execute-code.ts:173-176` で `file_path` が `null` の場合のハンドリングが不足している。

## 修正方針

### 影響範囲

- jupyter-server: `handlers.py` （ワークスペース解決ロジック）
- jupyter-server: `session_handlers.py`（セッション作成時のマッピング登録）
- jupyter-mcp: `src/tools/execute-code.ts`（null ガード追加）
- jupyter-mcp: `src/resources/image-registry.ts`（null ガード追加）

### 修正アプローチ

#### A. jupyter-server: kernel_id → workspace_id マッピングの追加

`session_handlers.py` でセッション作成時に kernel_id → workspace_id のマッピングをモジュールレベル辞書に保存し、`_resolve_workspace_for_kernel` でそのマッピングを参照する。

**理由**: `cwd` 属性は jupyter_client の仕様上取得できないため、独自のマッピングが必要。

#### B. jupyter-mcp: null file_path のガード追加

`execute-code.ts` で `result.images` を処理する際、`file_path` が null の画像をフィルタリングまたは安全に処理する。

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-server/extensions/custom_api/session_handlers.py` | セッション作成時に `_kernel_workspace_map[kernel_id] = workspace_id` を登録 |
| `jupyter-server/extensions/custom_api/handlers.py` | `_resolve_workspace_for_kernel` に `_kernel_workspace_map` 参照ステップを追加 |
| `jupyter-mcp/src/tools/execute-code.ts` | `result.images` の null file_path フィルタリング追加 |

### テスト計画

1. `scripts/test.sh jupyter-mcp` で execute-code-images の4テストすべてが通ることを確認
2. 他の統合テスト（execute-code, image-resources 等）が回帰していないことを確認
3. notebook_path ありの session_create でも画像保存が動作することを確認
