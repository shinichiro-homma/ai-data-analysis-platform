# タスク詳細: Phase 23 jupyter-server 堅牢化

## 概要

jupyter-server の5つの構造的問題を解消する: (1) カーネル並行実行の出力混線、(2) async ハンドラ内の同期 I/O ブロック、(3) handlers.py 1515行モノリスの分割、(4) SQL コネクションプール化、(5) sandbox の os.rename/os.replace 抜け。不変条件 I3（async 内ブロッキング禁止）、I6（並行アクセスの直列化）の既知違反を解消し、Phase 11.2（CI 適応度関数）の前提条件を整える。

## 関連ドキュメント

- 要件定義: `docs/requirements/jupyter-server.md` の F2.1（コード実行）、F7.1（SQL実行）、NF2.1（シェルコマンド阻止）、NF1（パフォーマンス）
- 不変条件: `docs/design/invariants.md` の I3, I6
- リファクタ入力: `tmp/refactor-notes.md` §4（一時ファイル。必要情報は本計画に転記済み）

## 調査したファイル

- `jupyter-server/extensions/custom_api/kernel_executor.py`: execute() が毎回新規 client を生成し IOPub を購読。msg_id フィルタリングなし、ロック機構なし。並行実行で出力混線する
- `jupyter-server/extensions/custom_api/handlers.py`: 1515行、15クラス。ContentsCellsHandler.patch が約250行の if/elif。get_handlers() (1482-1514行) がルーティングの正
- `jupyter-server/extensions/custom_api/sql_handlers.py`: _create_sql_engine() (460-467行) がリクエスト毎に engine 生成・dispose。wait_for タイムアウト後もスレッドが残る可能性
- `jupyter-server/extensions/custom_api/workspace_sandbox.py`: os.rename/os.replace がパッチ対象外 (143-160行)。shutil は import 段階でブロック済み
- `jupyter-server/extensions/custom_api/code_validator.py`: BLOCKED_OS_FUNCTIONS (94-100行) に rename/replace なし
- `jupyter-server/extensions/custom_api/workspace_handlers.py`: async def だが中身は全て同期 I/O（open/read/write/json.load）
- `jupyter-server/extensions/custom_api/base.py`: BaseCustomHandler（共通基底）、resolve_workspace_dir、validate_timeout 等の共有ユーティリティ

## 検討した代替案

### 23.1 カーネル実行直列化

| 案 | 概要 | 利点 | 欠点 |
|----|------|------|------|
| A（採用） | カーネル ID ごとの asyncio.Lock 辞書 | シンプル、確実に直列化。msg_id フィルタ不要 | 並行実行不可（スループット低下） |
| B | msg_id フィルタリングで並行実行を許容 | スループット維持 | IOPub のブロードキャスト特性上、完全な分離は困難。status:idle の帰属判定が複雑。jupyter_client の内部実装に依存 |

採用理由: MCP 経由の実行はユーザー操作起点で高スループットが不要。直列化の単純さと確実性を優先。NF1（同時カーネル5台）は「別カーネルの並行」であり同一カーネル内の直列化とは矛盾しない。

### 23.2 同期 I/O オフロード

| 案 | 概要 | 利点 | 欠点 |
|----|------|------|------|
| A（採用） | run_in_executor で既存同期コードをオフロード | 変更最小限。既存ロジックをそのまま活用 | スレッドプール消費 |
| B | aiofiles 等で非同期 I/O に書き換え | イベントループ上で完結 | pandas/pyarrow の同期 API は回避不可。大幅な書き換えが必要 |

採用理由: preview の pd.read_csv / pq.ParquetFile、workspace の json.load 等は同期ライブラリ依存であり、非同期化のメリットが薄い。run_in_executor が最小変更。

### 23.3 handlers.py 分割

| 案 | 概要 | 利点 | 欠点 |
|----|------|------|------|
| A（採用） | kernel / cell_actions / contents / preview の4ファイルに分割 | 既存テストの粒度（test_cell_*.py）と一致。各ファイル300-400行 | get_handlers() の組み立てを変更する必要 |
| B | kernel / contents（cell含む） / preview の3ファイル | ファイル数が少ない | contents + cell で 900行超。分割効果が薄い |

採用理由: Phase 11.2 のファイルサイズ予算（目安500行）を満たすには4分割が必要。テストファイルの粒度とも整合する。

### 23.4 SQL コネクションプール化

| 案 | 概要 | 利点 | 欠点 |
|----|------|------|------|
| A（採用） | モジュールレベルで engine を遅延初期化し、リクエスト間で共有 | 接続再利用でオーバーヘッド削減。pool_pre_ping で接続断を自動検知 | DATABASE_URL 未設定時の初期化タイミングに注意 |
| B | FastAPI の Depends + async session | 現代的なパターン | jupyter-server は Tornado ベースであり FastAPI 依存を持ち込めない |

採用理由: Tornado ベースのため、モジュールレベル engine が最も自然。pool_pre_ping=True で DB 再起動後の接続回復も担保。

### 23.5 sandbox ブロック追加

| 案 | 概要 | 利点 | 欠点 |
|----|------|------|------|
| A（採用） | BLOCKED_OS_FUNCTIONS に rename/replace/link/symlink を追加し、workspace_sandbox.py にもパッチ追加（ブラックリスト拡張） | 変更最小限、既存パターンを踏襲。rename/replace はワークスペース内なら許可するパス検査付きパッチで対応 | 将来の新たな危険関数の追加忘れリスクは残る |
| B | os モジュールのファイル操作をホワイトリスト方式に変更 | 今後の抜け漏れを構造的に防止 | 影響範囲が大きい。os モジュールの全関数を洗い出す必要があり、正当な関数のブロックによる regression リスクが高い |

採用理由: ホワイトリスト化は理想だが、os モジュールは関数数が多く影響範囲が大きい。まずブラックリスト拡張で既知の抜けを塞ぎ、ホワイトリスト化は将来の別タスクとする。rename/replace はワークスペース内操作を許可する必要があるため、sandbox パッチはパス検査付きとする。

ADR 要否: 不要。各項目とも既存の不変条件（I3, I6）の違反解消であり、新しい設計判断は含まない。

## 参考にする既存実装

- コピー元: handlers.py の既存ハンドラーパターン（BaseCustomHandler 継承、write_success/write_error_response）を分割先でも踏襲
- sql_handlers.py の run_in_executor パターン (640-647行) を preview/workspace のオフロードで参考にする（同種3箇所目のため共通ヘルパー化を検討）

## 異常系・不変条件

- **並行実行 (I6)**: 23.1 でカーネル単位ロックを導入。ロック取得待ちタイムアウト（実行タイムアウト + α）で無限待ちを防止
- **ブロッキング I/O (I3)**: 23.2 で run_in_executor へオフロード。ファイル不在時は executor 内で例外 → ハンドラーでキャッチしてエラー応答
- **DB 接続断 (I5)**: 23.4 で pool_pre_ping=True により自動再接続。DATABASE_URL 未設定時は起動時に明確なログ出力（engine=None）
- **sandbox 迂回 (I2)**: 23.5 でブラックリスト拡張（rename/replace/link/symlink 追加）。rename/replace はワークスペース内操作のみ許可するパス検査付きパッチ

## 実装計画

### 実装順序

23.1 → 23.2 → 23.3 → 23.4 → 23.5

- 23.1 のカーネルロックは独立して実装可能
- 23.2 の I/O オフロードは 23.3 の分割前に行い、分割時に正しいモジュールに配置する
- 23.3 の分割後に 23.4 (sql_handlers.py) と 23.5 (sandbox) を実施

### 23.1 カーネル単位の実行直列化ロック

**変更ファイル:**

| ファイル | 内容 |
|----------|------|
| `jupyter-server/extensions/custom_api/kernel_executor.py` | カーネル ID → asyncio.Lock の辞書を追加。execute() でロック取得後に実行 |

**手順:**

1. `kernel_executor.py` にモジュールレベルの `_kernel_locks: dict[str, asyncio.Lock] = {}` を追加し、`_get_kernel_lock(kernel_id)` ヘルパーを作成（辞書にない場合は新規 Lock を作成して返す）
2. `KernelExecutor.execute()` の冒頭で `async with _get_kernel_lock(kernel_id):` でラップ。タイムアウトは `asyncio.wait_for` で execute 全体を囲み、引数の timeout + 5秒とする
3. カーネル停止・削除時（shutdown_kernel 経路）に該当ロックを辞書から削除するクリーンアップを追加。restart_kernel ではロックを保持する（同一カーネル ID が維持されるため）
4. 並行実行テストを追加: 同一カーネルに `print("A")` と `print("B")` を asyncio.gather で並行送信し、各レスポンスの stdout が混線しないことを検証

検証: `scripts/test.sh jupyter-server` で既存テスト全パス + 新規テスト成功

### 23.2 async ハンドラ内の同期 I/O オフロード

**変更ファイル:**

| ファイル | 内容 |
|----------|------|
| `jupyter-server/extensions/custom_api/handlers.py` | ContentsPreviewHandler.get を async 化し、I/O を run_in_executor でオフロード |
| `jupyter-server/extensions/custom_api/workspace_handlers.py` | _read_workspace / get / put / post 内の同期 I/O を run_in_executor でオフロード |

**手順:**

1. `handlers.py` の `ContentsPreviewHandler.get` を `async def get` に変更。CSV 行数カウント・pd.read_csv・pq.ParquetFile の読み込みを `await loop.run_in_executor(None, _preview_sync, ...)` でオフロード（同期処理をプライベート関数に切り出す）
2. `workspace_handlers.py` の以下4メソッドの同期 I/O を run_in_executor でオフロード:
   - `WorkspacesHandler.get`: `_read_workspace` 内の open/json.load を `_read_workspace_sync` として切り出し
   - `WorkspacesHandler.post`: open/json.dump/mkdir を同期ヘルパーに切り出し
   - `WorkspaceHandler.put`: open/json.load/json.dump を同期ヘルパーに切り出し
   - `WorkspaceSummarizeHandler.post`: read_text を同期ヘルパーに切り出し
3. 既存テスト（`scripts/test.sh jupyter-server`）が全パスすることを確認

検証: `scripts/test.sh jupyter-server` 全パス

### 23.3 handlers.py の分割

**変更ファイル:**

| ファイル | 内容 |
|----------|------|
| `jupyter-server/extensions/custom_api/kernel_handlers.py` | HealthHandler, KernelsHandler, KernelHandler, KernelInterruptHandler, KernelRestartHandler, KernelExecuteHandler, KernelVariablesHandler, KernelVariableHandler を移動 |
| `jupyter-server/extensions/custom_api/cell_handlers.py` | ContentsCellsHandler, ContentsCellExecuteHandler, ContentsCellsClearAllOutputsHandler, ContentsCellExecuteBatchHandler を移動 |
| `jupyter-server/extensions/custom_api/contents_handlers.py` | ContentsListHandler, ContentsHandler を移動 |
| `jupyter-server/extensions/custom_api/preview_handlers.py` | ContentsPreviewHandler + _serialize_value/_df_to_records ヘルパーを移動 |
| `jupyter-server/extensions/custom_api/handlers.py` | get_handlers() のみ残し、各モジュールから import して組み立て。共通ヘルパー（_find_available_path 等）は適切なモジュールに移動 |
| `jupyter-server/tests/test_kernel_crash_recovery.py` | `_handlers_path` のパスを `kernel_handlers.py` に更新（read_text でソース検証している箇所） |
| `jupyter-server/tests/test_cell_*.py`（4ファイル） | importlib による handlers.py 直接ロード箇所を確認し、必要に応じて新モジュールのインポートに更新 |

**手順:**

1. 各ハンドラーモジュールを作成し、対応するクラスとヘルパー関数を移動。import は base.py と kernel_executor.py から
2. handlers.py は get_handlers() と共通ヘルパーのみ残す（_find_available_path は contents_handlers.py へ移動）
3. get_handlers() を更新: 各モジュールからクラスを import してルーティングテーブルを組み立て
4. `__init__.py` の import パスが変わらないことを確認（get_handlers は handlers.py に残る）
5. `test_kernel_crash_recovery.py` の `_handlers_path.read_text()` のパスを `kernel_handlers.py` に更新
6. `test_cell_*.py`（4ファイル）の importlib によるモジュールロード箇所を確認し、handlers.py からの読み込みを新モジュールに更新

検証: `scripts/test.sh jupyter-server` 全パス。`wc -l handlers.py` が 500 行以下

### 23.4 SQL コネクションプール化

**変更ファイル:**

| ファイル | 内容 |
|----------|------|
| `jupyter-server/extensions/custom_api/sql_handlers.py` | _create_sql_engine() をモジュールレベル遅延初期化に変更。リクエスト毎の engine 生成・dispose を廃止 |

**手順:**

1. モジュールレベルで `_engine: Engine | None = None` を宣言。`_get_engine(database_url)` を作成: 初回呼び出し時に `create_engine(database_url, pool_pre_ping=True, pool_size=5, max_overflow=2, connect_args={"connect_timeout": 5})` で engine を生成しキャッシュ。DATABASE_URL が変わったら再作成
2. `_execute_sql_sync` / `_execute_non_select_sync` / `_export_sql_sync` の `engine = _create_sql_engine(...)` + `finally: engine.dispose()` を `engine = _get_engine(...)` に置き換え（dispose 削除）
3. DATABASE_URL 未設定時は engine=None のまま、実行時に明確なエラーメッセージを返す
4. 既存テスト `test_sql_handlers.py` を確認し、_create_sql_engine のモック箇所があれば _get_engine に更新

検証: `scripts/test.sh jupyter-server` 全パス

### 23.5 sandbox の os.rename/os.replace ブロック追加

**変更ファイル:**

| ファイル | 内容 |
|----------|------|
| `jupyter-server/extensions/custom_api/code_validator.py` | BLOCKED_OS_FUNCTIONS に rename, replace, link, symlink を追加 |
| `jupyter-server/extensions/custom_api/workspace_sandbox.py` | os.rename, os.replace, os.link, os.symlink をパッチ対象に追加 |
| `jupyter-server/tests/test_code_validator.py` | os.rename/os.replace のブロックテストを追加 |
| `jupyter-server/tests/test_workspace_sandbox.py` | os.rename/os.replace のブロックテストを追加 |

**手順:**

1. `code_validator.py` の `BLOCKED_OS_FUNCTIONS` に `"rename"`, `"replace"`, `"link"`, `"symlink"` を追加
2. `workspace_sandbox.py` に `_sandbox_rename`, `_sandbox_replace` パッチを追加: 引数のパスがワークスペース外を参照する場合は PermissionError を発生させる（ワークスペース内の rename は許可）
3. `os.link`, `os.symlink` は `_blocked()` でブロック（正当な用途がない）
4. `test_code_validator.py` に `test_blocked_os_rename`, `test_blocked_os_replace` を追加
5. `test_workspace_sandbox.py` に `test_rename_blocked`, `test_replace_blocked`, `test_link_blocked`, `test_symlink_blocked` を追加

検証: `scripts/test.sh jupyter-server` 全パス。`grep -c "rename\|replace\|link\|symlink" jupyter-server/extensions/custom_api/code_validator.py` で追加を確認

### 技術的な考慮事項

- **23.1**: asyncio.Lock はイベントループ内でのみ有効。Tornado の IOLoop と asyncio の統合は jupyter-server では既に行われている（async def ハンドラーが動作している）
- **23.3**: 分割時に循環 import が発生しないよう、共通ヘルパーは base.py または独立モジュールに配置する。_find_available_path は contents_handlers.py 内でのみ使用されるため移動可能
- **23.4**: pool_pre_ping=True は接続利用前に SELECT 1 を実行するオーバーヘッドがあるが、read-only ロール接続では許容範囲
- **23.5**: ブラックリスト追加方式のため、os.path.* や os.getcwd() 等の既存コードへの影響はない。rename/replace のパッチはパス検査付きとし、ワークスペース内の正当な操作は許可する

## リスクと検知方法

- **23.1 ロックのデッドロック**: カーネル実行のタイムアウトが asyncio.wait_for で設定されるため、ロック待ちが無限に続くことはない。テストで並行実行のタイムアウトを検証する
- **23.3 分割時の import 漏れ**: get_handlers() のルーティングテーブルが正。既存の統合テスト（test_cell_*.py）が全エンドポイントを叩くため、漏れがあればテスト失敗で検知
- **23.4 接続プールの枯渇**: pool_size=5, max_overflow=2 で最大7接続。同時 SQL リクエストがこれを超えるとブロック。現状の利用パターン（MCP 経由の逐次実行）では問題なし
- **23.5 正当な os 関数のブロック**: ブラックリスト追加方式のため、既存コードへの影響は限定的。テストで sandbox 内の正常動作（ファイル読み書き・ワークスペース内 rename）も検証

## 完了条件

- [ ] `scripts/test.sh jupyter-server` が全パスする
- [ ] 同一カーネルへの並行 execute で出力が混線しないテストが存在し成功する（23.1）
- [ ] ContentsPreviewHandler.get が async def であり、I/O が run_in_executor でオフロードされている（23.2。`grep -n "async def get" preview_handlers.py` で確認）
- [ ] handlers.py が 500 行以下である（23.3。`wc -l jupyter-server/extensions/custom_api/handlers.py` で確認）
- [ ] sql_handlers.py にリクエスト毎の engine.dispose() が存在しない（23.4。`grep -n "engine.dispose" sql_handlers.py` で 0 件）
- [ ] `os.rename` が code_validator.py の BLOCKED_OS_FUNCTIONS に含まれ、workspace_sandbox.py でパッチされている（23.5。grep で確認）
- [ ] 異常系: カーネル実行のロック待ちタイムアウト時に適切なエラーが返る（23.1）
- [ ] 異常系: DATABASE_URL 未設定時に SQL 実行が明確なエラーメッセージを返す（23.4）

## テスト計画

- **23.1**: `test_kernel_executor.py`（新規）に並行実行テスト。asyncio.gather で2つの execute を送信し stdout を検証
- **23.2**: 既存統合テストでカバー。追加のユニットテストは不要（run_in_executor は透過的）
- **23.3**: 既存テスト（test_cell_*.py）で全エンドポイントの疎通を検証。新規テスト不要
- **23.4**: `test_sql_handlers.py` に _get_engine のキャッシュ動作テストを追加
- **23.5**: `test_code_validator.py` と `test_workspace_sandbox.py` に os.rename/os.replace のブロックテストを追加

---

## レビューステータス

- [x] 計画レビュー完了
- [ ] 実装完了
- [ ] テスト完了
