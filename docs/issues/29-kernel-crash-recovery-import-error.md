# Issue #29: test_kernel_crash_recovery.py が全テスト一括実行時に ImportError で失敗する

## 関連タスク

- タスク番号: なし

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`pytest tests/` で全テスト一括実行すると `test_kernel_crash_recovery.py` が collect 時に `ImportError` で失敗する。

```
ImportError: cannot import name 'register_kernel_workspace' from 'custom_api.session_handlers'
```

単独実行（`pytest tests/test_kernel_crash_recovery.py`）では 10/10 テストがパスする。

## 再現手順

1. `cd jupyter-server`
2. `pytest tests/` で全テスト一括実行

## 期待する動作

全テスト一括実行（`pytest tests/`）で `test_kernel_crash_recovery.py` が他テストの実行順序に関係なくパスする。

## 原因

### 根本原因

複数のテストファイルがモジュールレベルで `sys.modules` を操作しており、一括実行時にテスト間で干渉が発生する。

具体的には:

1. **`test_sql_handlers.py` が `custom_api` / `custom_api.base` を無条件上書き**（31行、46行）
   - `if name not in sys.modules` ガードがなく、他テストがロードした正規版を上書きする
2. **`test_kernel_crash_recovery.py` の `_load_module` がガード付きで既存エントリを返す**（45-46行）
   - `if name in sys.modules: return sys.modules[name]` により、他テストが登録したモック版がそのまま返される
   - モック版に `register_kernel_workspace` が存在しないため ImportError が発生

### sys.modules 操作の問題箇所

| ファイル | 行 | 対象キー | ガード | 問題 |
|---------|-----|---------|-------|------|
| `test_sql_handlers.py` | 31 | `custom_api` | **なし（無条件上書き）** | 他テストの正規版を破壊 |
| `test_sql_handlers.py` | 46 | `custom_api.base` | **なし（無条件上書き）** | 同上 |
| `test_sql_handlers.py` | 57 | `custom_api.sql_handlers` | **なし（無条件上書き）** | 同上 |
| `test_workspace_sandbox.py` | 55 | `custom_api.workspace_sandbox` | **なし（無条件上書き）** | 副次的問題 |
| `test_ipython_magic_disable.py` | 59 | `custom_api.workspace_sandbox` | **なし（無条件上書き）** | 副次的問題 |
| `test_kernel_crash_recovery.py` | 45-46 | 複数 | ガードあるが既存を信頼 | モック版が返される |

### 発生メカニズム

1. pytest が collect フェーズで全テストファイルのモジュールレベルコードを実行
2. `test_sql_handlers.py` が `custom_api` / `custom_api.base` を無条件でモックに上書き
3. `test_kernel_crash_recovery.py` の `_load_module` が `sys.modules` に既登録のエントリ（不完全なモック）を返す
4. `from custom_api.session_handlers import register_kernel_workspace` が失敗

## 修正方針

### アプローチ: `_load_module` を強制リロード方式に変更 + 無条件上書きにガード追加

テスト間の `sys.modules` 干渉を解消する。

#### 1. `test_kernel_crash_recovery.py` の `_load_module` を強制リロード方式に変更

`_load_module` が既存エントリを信頼してそのまま返すのではなく、常に正規ファイルからロードする方式に変更する。これにより他テストのモックに依存しなくなる。

```python
def _load_module(name: str, filename: str) -> _types.ModuleType:
    # 既存のエントリを削除して正規版を確実にロードする
    sys.modules.pop(name, None)
    path = _ext_dir / "custom_api" / filename
    spec = importlib.util.spec_from_file_location(name, path, submodule_search_locations=[])
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "custom_api"
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod
```

#### 2. `test_sql_handlers.py` 等の無条件上書きにガードを追加

`test_sql_handlers.py`、`test_workspace_sandbox.py`、`test_ipython_magic_disable.py` の `sys.modules` 無条件上書きに `if name not in sys.modules` ガードを追加し、他テストが先にロードしたモジュールを壊さないようにする。

### 影響範囲

- jupyter-server のテストコードのみ。プロダクションコード（`extensions/custom_api/`）の変更は不要
- 要件定義・API 仕様の変更は不要

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-server/tests/test_kernel_crash_recovery.py` | `_load_module` を強制リロード方式に変更（`sys.modules.pop` + 再ロード） |
| `jupyter-server/tests/test_sql_handlers.py` | `custom_api` / `custom_api.base` / `custom_api.sql_handlers` の無条件上書きにガード追加 |
| `jupyter-server/tests/test_workspace_sandbox.py` | `custom_api.workspace_sandbox` の無条件上書きにガード追加 |
| `jupyter-server/tests/test_ipython_magic_disable.py` | `custom_api.workspace_sandbox` の無条件上書きにガード追加 |

### テスト計画

1. 全テスト一括実行で `test_kernel_crash_recovery.py` がパスすることを確認: `scripts/test.sh --rebuild jupyter-server`
2. 各テストファイルの単独実行でも引き続きパスすることを確認
