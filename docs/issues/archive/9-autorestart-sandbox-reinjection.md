# Issue #9: autorestart パスで sandbox 再注入が発火しない

## 関連タスク

- タスク番号: 18.1 / 18.2（Phase 18 カーネルクラッシュリカバリー）

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`restart_dead_kernels = True` による dead カーネルの自動再起動時に、ワークスペースの sandbox（`generate_sandbox_code`）が再注入されない。復旧後のカーネルではワークスペース外ファイルへのアクセスが制限されず、セキュリティ上のギャップとなっている。

## 再現手順

1. ワークスペース A でセッションを作成
2. `execute_code` で `import os; os._exit(1)` を実行してカーネルをクラッシュさせる
3. `restart_dead_kernels` により autorestart が発生するのを待つ
4. 復旧後のカーネルで他ワークスペースのファイルにアクセスする
5. **期待**: `PermissionError: Access denied: another workspace`
6. **実際**: アクセスが成功する（sandbox 未注入）

## 期待する動作

autorestart パスでも `_wrap_restart_kernel` と同様に sandbox が再注入され、ワークスペース分離が維持されること（要件 F6.3 / AC6 / NF2.2 レイヤー3）。

## 原因

`_wrap_restart_kernel` は `MappingKernelManager` インスタンスの `restart_kernel` 属性を差し替える形でフックしている（`jupyter-server/extensions/custom_api/__init__.py:101`）。

一方、`restart_dead_kernels=True` 時の自動復旧は `jupyter_client` の `KernelRestarter`（`IOLoopKernelRestarter`）が担当し、poll ループで死亡検知した際に `KernelManager` 内部の起動処理を直接呼び出す。**公開 API の `MappingKernelManager.restart_kernel()` を経由しないため、差し替えた wrapper は発火しない**。

結果として:
- 明示的な `POST /api/kernels/{id}/restart`（`KernelRestartHandler`）→ `restart_kernel` 呼び出し → sandbox 再注入される
- `KernelRestarter` による autorestart → `restart_kernel` を経由しない → sandbox 再注入されない

### 関連コード

| ファイル | 役割 |
|---------|------|
| `jupyter-server/extensions/custom_api/__init__.py:40-84` | `_wrap_restart_kernel`（公開 restart のみフック） |
| `jupyter-server/extensions/custom_api/__init__.py:101` | インスタンス属性差し替え |
| `jupyter-server/extensions/custom_api/session_handlers.py:109-142` | 新規起動時 sandbox 注入と `register_kernel_workspace` |
| `jupyter-server/extensions/custom_api/workspace_sandbox.py` | `generate_sandbox_code` 本体 |
| `jupyter-server/jupyter_config/jupyter_server_config.py:67` | `restart_dead_kernels = True` |

## 修正方針

### 採用案: `KernelRestarter.add_callback('restart')` に再注入コールバックを登録

各カーネル起動後に `km._kernels[kernel_id]._restarter.add_callback(cb, event='restart')` で autorestart イベントをフックし、sandbox を再注入する。

**実装手順:**

1. `custom_api/__init__.py` に新規関数 `_register_autorestart_callback(kernel_manager, kernel_id)` を追加
   - `km._kernels[kernel_id]._restarter` を取得
   - `get_kernel_workspace(kernel_id)` で workspace_id を確認（紐付け済みカーネルのみ対象）
   - `add_callback(on_autorestart, event='restart')` でコールバック登録
   - コールバック内で `asyncio.ensure_future()` により既存 `_wrap_restart_kernel` と同様の sandbox 再注入ロジックを非同期スケジュール（IOPub 待機 + `KernelExecutor.execute(sandbox_code)`）
2. `_wrap_start_kernel` / `_wrap_restart_kernel` の成功直後に `_register_autorestart_callback` を呼び出す
   - 新規起動：`MappingKernelManager.start_kernel` をインスタンスラップ（既存 `_wrap_shutdown_kernel` と同じパターン）
   - 明示 restart：既存 `_wrap_restart_kernel` の末尾に追加（restart 後に `_restarter` が新しいオブジェクトに差し替わる可能性を考慮し、再注入直後に再登録する）
3. 二重注入防止：明示 restart でもコールバックが発火する可能性があるため、`on_autorestart` コールバック内で「直前の明示 restart から一定時間内はスキップする」フラグは設けず、**冪等性は sandbox 注入コードそのものの性質に委ねる**（既存 `generate_sandbox_code` は上書き注入で安全）

**不採用案:**

- 候補B（`MappingKernelManager.start_kernel` のラップのみ）: 新規起動と再起動の区別が必要。`KernelRestarter` 経由の起動が `start_kernel` を経由するかバージョン依存。
- 候補C（`MappingKernelManager` サブクラス + `post_start_kernel` hook）: 設定ファイルで `kernel_manager_class` 差し替えが必要で変更範囲が広い。culler 等既存設定との互換性要確認。
- 候補D（IOPub 監視）: 常時タスクが必要でオーバーヘッド大、重複注入防止ロジックが複雑。

### 影響範囲

- jupyter-server のカーネルクラッシュリカバリ機能のみ
- 要件定義の更新が必要：`docs/requirements/jupyter-server.md` NF3 に「autorestart 経路でも sandbox 再注入される」ことを明示
- API 仕様の変更なし

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-server/extensions/custom_api/__init__.py` | `_register_autorestart_callback` 追加、`_wrap_start_kernel` 追加（or 既存 `_wrap_shutdown_kernel` 拡張）、`_wrap_restart_kernel` からの呼び出し |
| `jupyter-server/tests/test_kernel_crash_recovery.py` | autorestart 経由の結合テスト追加（`_restarter.add_callback` が登録されていることの検証、カーネルクラッシュ→autorestart→sandbox 有効性の end-to-end 確認） |
| `docs/requirements/jupyter-server.md` | NF3 に autorestart 経路での sandbox 再注入を明記 |

### テスト計画

1. **ユニットテスト（新規）**: `_register_autorestart_callback` がカーネル起動後に `_restarter.callbacks['restart']` に登録されていることを確認
2. **結合テスト（新規）**: Docker 環境で
   - ワークスペース作成 → execute_code で `os._exit(1)` → `restart_dead_kernels` による復旧を待機
   - 復旧後のカーネルで他ワークスペースファイルへのアクセスが `PermissionError` になること
   - 既存 Task 18.2 の test.skip（test 3 相当）を unskip する
3. **既存テスト**: `test_kernel_crash_recovery.py` 全件パス（明示 restart 経由の sandbox 再注入が壊れていないこと）
4. **回帰テスト**: 新規起動時に重複注入されない（session_handlers.py 側の注入と競合しない）ことを確認
