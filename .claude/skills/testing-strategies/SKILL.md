# Testing Strategies

## 概要

このプロジェクトにおけるテスト実装のガイド。Vitest (TypeScript)、pytest (Python)、E2E テストの3つのフレームワークを横断的にカバーする。テスト実装時はこのドキュメントのパターンとテンプレートに従うこと。

## テストフレームワーク一覧

| フレームワーク | 対象コンポーネント | 用途 |
|---------------|-------------------|------|
| Vitest (TypeScript) | jupyter-mcp, document-mcp | MCP ツールのユニットテスト、結合テスト |
| pytest (Python) | document-server | REST API のユニットテスト、Router テスト |
| Vitest (E2E) | tests/e2e/ | docker-compose 上の全サービス横断テスト |

## テスト構造の原則

テスト構造・命名・カバレッジの原則は `.claude/rules/testing.md` に定義されている。
本スキルではフレームワーク固有のテンプレートと設定パターンのみを示す。

---

## Vitest (TypeScript MCP サーバー)

### プロジェクト構成

```
jupyter-mcp/
├── vitest.config.ts                # デフォルト設定（testTimeout: 30000）
├── vitest.config.unit.ts           # ユニットテスト（testTimeout: 5000, pool: forks）
├── vitest.config.integration.ts    # 結合テスト（testTimeout: 30000, singleFork: true）
├── tests/
│   ├── setup.ts                    # テストヘルパー（parseToolCallResult 等）
│   ├── unit/
│   │   ├── tools/                  # 各ツールのユニットテスト
│   │   │   ├── session-create.test.ts
│   │   │   ├── execute-code.test.ts
│   │   │   ├── workspace-create.test.ts
│   │   │   └── ...
│   │   ├── utils/                  # ユーティリティのテスト
│   │   │   ├── validation.test.ts
│   │   │   ├── errors.test.ts
│   │   │   └── ...
│   │   ├── image-store/
│   │   └── jupyter-client/
│   └── integration/
│       ├── execute-code.test.ts
│       ├── session.test.ts
│       └── ...

document-mcp/
├── vitest.config.ts                # ユニットテスト（testTimeout: 30000）
├── vitest.config.integration.ts    # 結合テスト（testTimeout: 30000, concurrent: false）
├── tests/
│   ├── setup.ts                    # テストヘルパー（parseToolCallResult）
│   ├── unit/
│   │   ├── tools/                  # 各ツールのユニットテスト
│   │   │   ├── table-detail.test.ts
│   │   │   ├── term-detail.test.ts
│   │   │   └── ...
│   │   └── document-client/        # HTTP クライアントのテスト
│   │       ├── client.test.ts
│   │       └── ...
│   └── integration/
│       ├── catalog-integration.test.ts
│       └── performance.test.ts
```

### テスト実行コマンド

テスト実行には `scripts/test.sh` を使うこと（`.claude/rules/scripts.md` 参照）。`npm test` や `npx vitest` を直接実行してはならない。

```bash
# 全テスト（リビルド付き）
scripts/test.sh --rebuild jupyter-mcp

# ユニットテストのみ
scripts/test.sh --unit jupyter-mcp

# 統合テストのみ（Docker環境必要）
scripts/test.sh --integration jupyter-mcp

# 型チェックのみ
scripts/test.sh --typecheck jupyter-mcp
```

### 基本テンプレート: MCP ツールテスト (jupyter-mcp パターン)

jupyter-mcp のツールテストでは、`jupyterClient` を `vi.mock()` でモックし、ツール実行関数を直接呼び出す。レスポンスは `result.content[0].text` の JSON 文字列として検証する。

```typescript
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeToolName } from '../../../src/tools/tool-name.js';
import type { SomeType } from '../../../src/jupyter-client/types.js';

// jupyterClient をモック（vi.mock はファイルトップレベルに配置）
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    someMethod: vi.fn(),
  },
}));

// モックをインポート（vi.mock 宣言の後に配置）
import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeToolName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('基本パラメータで正常に動作する', async () => {
      // Arrange
      const mockResult: SomeType = {
        /* ... */
      };
      vi.mocked(jupyterClient.someMethod).mockResolvedValue(mockResult);

      // Act
      const result = await executeToolName({ param: 'value' });

      // Assert
      expect(jupyterClient.someMethod).toHaveBeenCalledWith('value');
      expect(result.content[0].text).toContain('"success": true');
    });
  });

  describe('バリデーションエラー', () => {
    test('必須パラメータ未指定 => エラー', async () => {
      const result = await executeToolName({});

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('パラメータは必須です');
      expect(jupyterClient.someMethod).not.toHaveBeenCalled();
    });
  });

  describe('API エラー', () => {
    test('接続エラー => エラーレスポンス', async () => {
      vi.mocked(jupyterClient.someMethod).mockRejectedValue(
        new Error('Connection refused')
      );

      const result = await executeToolName({ param: 'value' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Connection refused');
    });
  });
});
```

### 基本テンプレート: MCP ツールテスト (document-mcp パターン)

document-mcp では `getDocumentClient()` ファクトリ関数をモックし、`parseToolCallResult()` ヘルパーでレスポンスをパースする。

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseToolCallResult } from '../../setup.js';

// getDocumentClient をモック（ファクトリ関数パターン）
const mockClient = {
  getTableIndex: vi.fn(),
  getTableDetails: vi.fn(),
};
vi.mock('../../../src/document-client/client.js', () => ({
  getDocumentClient: () => mockClient,
}));

import { executeTableDetail } from '../../../src/tools/table-detail.js';

describe('get_table_detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常系: 単一テーブル指定で詳細が取得できる', async () => {
    // Arrange
    mockClient.getTableDetails.mockResolvedValue({
      tables: [
        {
          table_name: 'test_table',
          display_name: 'テストテーブル',
          description: 'テスト用',
          data_source: { type: 'postgresql', table: 'test_table' },
          columns: [
            { name: 'id', type: 'integer', description: 'ID', nullable: false },
          ],
        },
      ],
      not_found: [],
    });

    // Act
    const result = await executeTableDetail({ table_names: ['test_table'] });
    const parsed = parseToolCallResult(result);

    // Assert
    expect(parsed.success).toBe(true);
    const tables = parsed.tables as Array<Record<string, unknown>>;
    expect(tables).toHaveLength(1);
    expect(tables[0].table_name).toBe('test_table');
    expect(parsed.not_found).toEqual([]);
  });

  it('異常系: table_names未指定でVALIDATION_ERRORが返る', async () => {
    const result = await executeTableDetail({});
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);
    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('table_names');
  });

  it('異常系: API接続エラー時にエラーレスポンスが返る', async () => {
    const error = new Error('document-server に接続できません。サーバーが起動しているか確認してください。');
    Object.assign(error, { code: 'CONNECTION_ERROR' });
    mockClient.getTableDetails.mockRejectedValue(error);

    const result = await executeTableDetail({ table_names: ['some_table'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);
    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('CONNECTION_ERROR');
  });
});
```

### モックパターン

#### 1. `vi.mock()` + `vi.mocked()` パターン (jupyter-mcp)

外部クライアントモジュールを丸ごとモックし、各テストで `vi.mocked()` を使って戻り値を設定する。

```typescript
// ファイルトップレベルでモジュール全体をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    createSessionInWorkspace: vi.fn(),
    executeCode: vi.fn(),
    getContents: vi.fn(),
    postAiEvent: vi.fn(),
    updateCellOutputs: vi.fn(),
    operateCell: vi.fn(),
  },
}));

// モック後にインポート
import { jupyterClient } from '../../../src/jupyter-client/client.js';

// テスト内で戻り値を設定
vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);
vi.mocked(jupyterClient.executeCode).mockRejectedValue(new Error('Connection refused'));
```

#### 2. ファクトリ関数モックパターン (document-mcp)

ファクトリ関数がモックオブジェクトを返すようにする。

```typescript
const mockClient = {
  getTableIndex: vi.fn(),
  getTableDetails: vi.fn(),
};
vi.mock('../../../src/document-client/client.js', () => ({
  getDocumentClient: () => mockClient,
}));
```

#### 3. 複数モジュールのモック

依存関係が複数ある場合は、各モジュールを個別にモックする。

```typescript
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: { executeCode: vi.fn(), getContents: vi.fn() },
}));

vi.mock('../../../src/utils/session-resolver.js', () => ({
  resolveSession: vi.fn(),
  resolveKernelId: vi.fn(),
  resolveNotebookPath: vi.fn(),
}));

vi.mock('../../../src/image-store/index.js', () => ({
  imageStore: { store: vi.fn() },
}));
```

#### 4. axios モック (HTTP クライアントテスト)

```typescript
vi.mock('axios', () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
  };
  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
      isAxiosError: vi.fn((error: unknown) => {
        return typeof error === 'object' && error !== null && 'isAxiosError' in error;
      }),
    },
  };
});
```

### エラーケーステスト

このプロジェクトで必ずカバーすべきエラーケースの一覧。

#### バリデーションエラー

```typescript
describe('バリデーションエラー', () => {
  test('必須パラメータ未指定 => エラー', async () => {
    const result = await executeToolName({});
    expect(result.content[0].text).toContain('"success": false');
    expect(result.content[0].text).toContain('パラメータは必須です');
    expect(jupyterClient.someMethod).not.toHaveBeenCalled();
  });

  test('空文字列 => エラー', async () => {
    const result = await executeToolName({ param: '' });
    expect(result.content[0].text).toContain('"success": false');
  });

  test('文字列長超過 => エラー', async () => {
    const longValue = 'a'.repeat(201);
    const result = await executeToolName({ param: longValue });
    expect(result.content[0].text).toContain('長すぎます');
  });

  test('NULLバイト含有 => エラー', async () => {
    const result = await executeToolName({ param: 'test\0value' });
    expect(result.content[0].text).toContain('不正な文字が含まれています');
  });

  test('パストラバーサル ".." 含有 => エラー', async () => {
    const result = await executeToolName({ param: '../evil' });
    expect(result.content[0].text).toContain("..'");
  });

  test('数値パラメータが範囲外 => エラー', async () => {
    const result = await executeToolName({ timeout: 0 });
    expect(result.content[0].text).toContain('正の数である必要があります');
  });

  test('型が不正 => エラー', async () => {
    const result = await executeToolName({ timeout: '30' as any });
    expect(result.content[0].text).toContain('数値である必要があります');
  });

  // document-mcp パターン: 配列パラメータ
  test('配列でなく文字列を渡した場合 => VALIDATION_ERROR', async () => {
    const result = await executeToolName({ items: 'single_string' });
    const parsed = parseToolCallResult(result);
    expect(parsed.success).toBe(false);
    const err = parsed.error as { code: string };
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  test('空配列 => VALIDATION_ERROR', async () => {
    const result = await executeToolName({ items: [] });
    const parsed = parseToolCallResult(result);
    expect(parsed.success).toBe(false);
  });
});
```

#### API エラー・接続エラー

```typescript
describe('API エラー', () => {
  test('接続拒否 => エラーレスポンス', async () => {
    vi.mocked(jupyterClient.someMethod).mockRejectedValue(
      new Error('Connection refused')
    );
    const result = await executeToolName({ param: 'value' });
    expect(result.content[0].text).toContain('"success": false');
    expect(result.content[0].text).toContain('Connection refused');
  });

  test('リソース未発見 => エラーレスポンス', async () => {
    const error = Object.assign(new Error('Not found'), {
      code: 'NOT_FOUND',
    });
    vi.mocked(jupyterClient.someMethod).mockRejectedValue(error);
    const result = await executeToolName({ param: 'value' });
    expect(result.content[0].text).toContain('"success": false');
  });

  test('サーバー内部エラー => エラーレスポンス', async () => {
    const error = Object.assign(new Error('Internal server error'), {
      code: 'INTERNAL_ERROR',
    });
    vi.mocked(jupyterClient.someMethod).mockRejectedValue(error);
    const result = await executeToolName({ param: 'value' });
    expect(result.content[0].text).toContain('INTERNAL_ERROR');
  });
});
```

### parseToolCallResult ヘルパー

両コンポーネントで共通のヘルパー関数。MCP ツールのレスポンスは `{ content: [{ type: 'text', text: '<JSON string>' }] }` の形式であり、テスト時にパースが必要。

```typescript
// tests/setup.ts
export interface ToolCallResponse {
  success: boolean;
  [key: string]: unknown;
}

export function parseToolCallResult(
  result: { content: Array<{ type: string; text: string }> }
): ToolCallResponse {
  return JSON.parse(result.content[0].text) as ToolCallResponse;
}
```

### Vitest 設定の使い分け

| 設定ファイル | 用途 | testTimeout | 特記事項 |
|-------------|------|-------------|---------|
| `vitest.config.unit.ts` | ユニットテスト | 5000ms | `pool: 'forks'`、モック使用前提で短め |
| `vitest.config.integration.ts` | 結合テスト | 30000ms | `singleFork: true` / `concurrent: false` で直列実行 |
| `vitest.config.ts` | デフォルト | 30000ms | 全テスト実行用 |

---

## pytest (Python REST API サーバー)

### プロジェクト構成

```
document-server/
├── pyproject.toml                  # pytest 設定（testpaths, asyncio_mode）
├── src/
│   ├── main.py                     # FastAPI app
│   ├── models.py
│   ├── catalog_loader.py           # CatalogStore
│   └── routers/
│       ├── catalog.py
│       ├── glossary.py
│       ├── logic.py
│       └── admin.py
└── tests/
    ├── __init__.py
    ├── conftest.py                 # フィクスチャ定義（YAML テストデータ、TestClient 生成）
    ├── test_tables_api.py
    ├── test_terms_api.py
    ├── test_logic_api.py
    ├── test_models.py
    ├── test_catalog_loader.py
    └── test_health.py
```

### テスト実行コマンド

```bash
cd document-server
pytest                   # 全テスト実行
pytest -v                # 詳細表示
pytest --cov=src         # カバレッジレポート
pytest tests/test_tables_api.py  # 個別ファイル
```

### pytest 設定 (pyproject.toml)

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

### conftest.py パターン

テストデータは YAML 文字列としてインラインで定義し、`tmp_path` フィクスチャを使って一時ディレクトリに書き出す。`CatalogStore` にロードした後、FastAPI の `TestClient` を生成する。

```python
from __future__ import annotations
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from src.catalog_loader import CatalogStore
from src.main import app

# YAML テストデータをインラインで定義
SAMPLE_INDEX_YAML = """\
tables_index:
  - table_name: test_table
    display_name: テストテーブル
    summary: "テスト用テーブル"
    category: テスト系
"""

SAMPLE_TABLE_YAML = """\
table_name: test_table
display_name: テストテーブル
description: テスト用の説明文です。
data_source:
  type: postgresql
  table: test_table
columns:
  - name: id
    type: integer
    description: "主キー"
    nullable: false
"""

SAMPLE_TERM_INDEX_YAML = """\
terms_index:
  - name: "ロイヤルティランク"
    summary: "統合会員の購買実績に基づく顧客ロイヤルティランク"
"""

SAMPLE_TERM_YAML = """\
name: "ロイヤルティランク"
aliases: ["ロイヤルティランク", "Loyalty Rank"]
definition: "統合会員の購買実績に基づく顧客ロイヤルティランク。"
related_terms: ["統合会員ID"]
values:
  - label: "レギュラー"
    description: "基本ランク"
"""


def _create_data_dir(
    base: Path,
    index_yaml: str,
    table_yamls: dict[str, str],
    term_index_yaml: str,
    term_yamls: dict[str, str],
    logic_index_yaml: str | None = None,
    logic_meta_yamls: dict[str, str] | None = None,
    logic_code_files: dict[str, str] | None = None,
) -> Path:
    """テスト用の data/ ディレクトリ構造を作成する。"""
    catalog_dir = base / "catalog"
    tables_dir = catalog_dir / "tables"
    tables_dir.mkdir(parents=True)
    (catalog_dir / "index.yaml").write_text(index_yaml, encoding="utf-8")
    for name, content in table_yamls.items():
        (tables_dir / name).write_text(content, encoding="utf-8")

    glossary_dir = base / "glossary"
    terms_dir = glossary_dir / "terms"
    terms_dir.mkdir(parents=True)
    (glossary_dir / "index.yaml").write_text(term_index_yaml, encoding="utf-8")
    for name, content in term_yamls.items():
        (terms_dir / name).write_text(content, encoding="utf-8")

    # logic 省略...
    return base


@pytest.fixture()
def sample_data_dir(tmp_path: Path) -> Path:
    return _create_data_dir(
        tmp_path,
        index_yaml=SAMPLE_INDEX_YAML,
        table_yamls={"test_table.yaml": SAMPLE_TABLE_YAML},
        term_index_yaml=SAMPLE_TERM_INDEX_YAML,
        term_yamls={"ロイヤルティランク.yaml": SAMPLE_TERM_YAML},
    )


@pytest.fixture()
def catalog_store(sample_data_dir: Path) -> CatalogStore:
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    store.load_terms(sample_data_dir)
    store.load_logic(sample_data_dir)
    return store


@pytest.fixture()
def client(sample_data_dir: Path) -> TestClient:
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    store.load_terms(sample_data_dir)
    store.load_logic(sample_data_dir)
    app.state.catalog_store = store
    app.state.last_reload = "2024-01-01T00:00:00+00:00"
    return TestClient(app)
```

重要なポイント:
- `_create_data_dir()` ヘルパーで YAML ファイルの配置を一元管理
- `client` フィクスチャは `sample_data_dir` に依存し、`CatalogStore` をロード済みの状態で `TestClient` を提供
- `full_data_dir` のようなバリエーションフィクスチャで、異なるデータセットに対応

### Router テストテンプレート

```python
from __future__ import annotations
from fastapi.testclient import TestClient


def test_get_index(client: TestClient) -> None:
    resp = client.get("/catalog/index")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 1
    assert len(data["tables"]) == 1
    t = data["tables"][0]
    assert t["table_name"] == "test_table"
    assert t["display_name"] == "テストテーブル"


def test_get_details_single(client: TestClient) -> None:
    resp = client.post("/catalog/tables", json={"table_names": ["test_table"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["tables"]) == 1
    assert data["not_found"] == []
    t = data["tables"][0]
    assert t["table_name"] == "test_table"
    assert t["description"] == "テスト用の説明文です。"
    assert len(t["columns"]) == 2


def test_get_details_partial_not_found(client: TestClient) -> None:
    resp = client.post(
        "/catalog/tables", json={"table_names": ["test_table", "nonexistent"]}
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["tables"]) == 1
    assert data["not_found"] == ["nonexistent"]


def test_get_details_all_not_found(client: TestClient) -> None:
    resp = client.post(
        "/catalog/tables", json={"table_names": ["nonexistent"]}
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["tables"]) == 0
    assert data["not_found"] == ["nonexistent"]


def test_get_details_empty_names(client: TestClient) -> None:
    resp = client.post("/catalog/tables", json={"table_names": []})
    assert resp.status_code == 422


def test_not_found_error(client: TestClient) -> None:
    resp = client.get("/logic/code/nonexistent")
    assert resp.status_code == 404
    error = resp.json()["error"]
    assert error["code"] == "LOGIC_NOT_FOUND"
```

### フィクスチャパターン

| フィクスチャ | 説明 | 依存 |
|-------------|------|------|
| `sample_data_dir` | 基本テストデータを一時ディレクトリに配置 | `tmp_path` |
| `full_data_dir` | 全フィールド入りデータを配置 | `tmp_path` |
| `catalog_store` | データロード済みの `CatalogStore` | `sample_data_dir` |
| `client` | 基本データでの `TestClient` | `sample_data_dir` |
| `client_full` | 全フィールドデータでの `TestClient` | `full_data_dir` |

フィクスチャ間の依存を利用し、コード重複を防ぐ:

```python
@pytest.fixture()
def catalog_store(sample_data_dir: Path) -> CatalogStore:
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    store.load_terms(sample_data_dir)
    store.load_logic(sample_data_dir)
    return store

@pytest.fixture()
def client(sample_data_dir: Path) -> TestClient:
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    store.load_terms(sample_data_dir)
    store.load_logic(sample_data_dir)
    app.state.catalog_store = store
    app.state.last_reload = "2024-01-01T00:00:00+00:00"
    return TestClient(app)
```

### 特殊ケーステスト（ファイル不在時の動作検証）

conftest のヘルパーを直接使って、特殊なテストデータ配置を行うパターン。

```python
from .conftest import _create_data_dir, SAMPLE_INDEX_YAML, SAMPLE_TABLE_YAML, ...

def test_code_file_missing(tmp_path: Path) -> None:
    """メタはあるがコードファイルがない場合。"""
    data_dir = _create_data_dir(
        tmp_path,
        index_yaml=SAMPLE_INDEX_YAML,
        table_yamls={"test_table.yaml": SAMPLE_TABLE_YAML},
        term_index_yaml=SAMPLE_TERM_INDEX_YAML,
        term_yamls=_COMMON_TERM_YAMLS,
        logic_index_yaml=SAMPLE_LOGIC_INDEX_YAML,
        logic_meta_yamls={"member_id_remapping.yaml": SAMPLE_LOGIC_META_REMAPPING_YAML},
        logic_code_files={},  # コードファイルなし
    )
    store = CatalogStore()
    store.load_tables(data_dir)
    store.load_terms(data_dir)
    store.load_logic(data_dir)
    app.state.catalog_store = store
    app.state.last_reload = "2024-01-01T00:00:00+00:00"
    test_client = TestClient(app)

    resp = test_client.get("/logic/code/member_id_remapping")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "LOGIC_CODE_NOT_FOUND"
```

---

## E2E テスト

### 構成

```
tests/e2e/
├── vitest.config.ts                # testTimeout: 60000, concurrent: false
├── helpers/
│   └── api-client.ts               # REST API ラッパー（fetch ベース、外部ライブラリ非依存）
├── e2e-workflow.test.ts             # 業務シナリオの完全フロー検証
└── performance.test.ts              # API 応答時間テスト（NF1: 200ms 以内）
```

E2E テストは docker-compose で起動した全サービスに対して実行する。

### テスト実行コマンド

```bash
# 前提: 全サービス起動
docker-compose up -d

# E2E テスト実行
cd tests/e2e
npx vitest --config vitest.config.ts
```

### API クライアントヘルパー

`tests/e2e/helpers/api-client.ts` は Node.js の `fetch` API のみを使い、外部ライブラリに依存しない。サーバー側パッケージの型定義とも独立した E2E 専用の型定義を持つ。

```typescript
// 設定（環境変数から読み込み）
const DOCUMENT_SERVER_URL = process.env.DOCUMENT_SERVER_URL || 'http://localhost:3002';
const JUPYTER_SERVER_URL = process.env.JUPYTER_SERVER_URL || 'http://localhost:8888';
const JUPYTER_TOKEN = process.env.JUPYTER_TOKEN || '';
const DEFAULT_TIMEOUT_MS = 10_000;

// 共通ベース関数
async function baseFetch(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  options?: RequestInit,
  checkStatus = true,
): Promise<Response> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
    signal: options?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (checkStatus && !res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  return res;
}

// サービス起動確認
export async function checkServices(): Promise<{ document: boolean; jupyter: boolean }> {
  const healthCheck = (url: string, headers?: Record<string, string>) =>
    fetch(`${url}/health`, {
      ...(headers ? { headers } : {}),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })
      .then((r) => r.ok)
      .catch(() => false);

  const [documentOk, jupyterOk] = await Promise.all([
    healthCheck(DOCUMENT_SERVER_URL),
    healthCheck(JUPYTER_SERVER_URL, JUPYTER_HEADERS),
  ]);
  return { document: documentOk, jupyter: jupyterOk };
}

// 各 API は docFetch / jupyterFetch でラップ
export async function getTableIndex() { /* ... */ }
export async function getTableDetail(tableNames: string[]) { /* ... */ }
export async function createWorkspace(name: string) { /* ... */ }
export async function createSession(workspaceId: string) { /* ... */ }
export async function executeCode(kernelId: string, code: string, timeout?: number) { /* ... */ }
export async function deleteSession(sessionId: string) { /* ... */ }
export async function deleteWorkspace(workspaceId: string) { /* ... */ }
```

### E2E テストパターン

#### サービス起動確認 + 条件付きスキップ

```typescript
let servicesAvailable = false;

beforeAll(async () => {
  const status = await checkServices();
  servicesAvailable = status.document && status.jupyter;
  if (!servicesAvailable) {
    console.warn('サービスに接続できません。E2E テストをスキップします。');
  }
});

it('テストケース', async () => {
  if (!servicesAvailable) return;
  // テスト本体
});
```

#### リソースクリーンアップ

```typescript
let currentSessionId: string | null = null;
let currentWorkspaceId: string | null = null;

afterEach(async () => {
  if (currentSessionId) {
    await deleteSession(currentSessionId);
    currentSessionId = null;
  }
  if (currentWorkspaceId) {
    await deleteWorkspace(currentWorkspaceId);
    currentWorkspaceId = null;
  }
});
```

#### セットアップヘルパー

```typescript
async function setupJupyterEnv(testName: string) {
  const wsName = `e2e-${testName}-${Date.now()}`;
  const ws = await createWorkspace(wsName);
  currentWorkspaceId = ws.workspace_id;

  const session = await createSession(ws.workspace_id);
  currentSessionId = session.session_id;

  return {
    workspaceId: ws.workspace_id,
    kernelId: session.kernel_id,
    sessionId: session.session_id,
  };
}
```

#### シナリオベースのテスト

E2E テストは業務シナリオに基づいた `describe` ブロックで構成する。

```typescript
describe('シナリオ 1: カタログ駆動の SQL 分析', () => {
  it('テーブルカタログからカラム情報を取得できる', async () => {
    if (!servicesAvailable) return;

    const index = await getTableIndex();
    expect(index.total).toBeGreaterThanOrEqual(2);

    const detail = await getTableDetail(['id_pos_transactions']);
    expect(detail.tables).toHaveLength(1);
    expect(detail.tables[0].columns.length).toBeGreaterThan(0);
  });

  it('カタログ情報を使って Jupyter でコードを実行できる', async () => {
    if (!servicesAvailable) return;

    const { kernelId } = await setupJupyterEnv('scenario1');
    const result = await executeCode(kernelId, 'print("hello")');
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('hello');
  });
});
```

#### パフォーマンステスト

```typescript
const THRESHOLD_MS = 200;
const WARMUP_RUNS = 1;
const MEASURE_RUNS = 4;

async function measureEndpoint(
  name: string,
  fn: () => Promise<unknown>,
  thresholdMs: number,
): Promise<void> {
  // ウォームアップ
  for (let i = 0; i < WARMUP_RUNS; i++) await fn();

  // 計測
  const times: number[] = [];
  for (let i = 0; i < MEASURE_RUNS; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  // 全回が閾値以内であることを検証
  for (let i = 0; i < times.length; i++) {
    expect(times[i], `${name} の ${i + 1} 回目: ${times[i].toFixed(1)}ms`).toBeLessThan(thresholdMs);
  }
}

it('GET /catalog/index が 200ms 以内で応答する', async () => {
  await measureEndpoint('GET /catalog/index', () => getTableIndex(), THRESHOLD_MS);
});
```

---

## 結合テスト (TypeScript)

ユニットテストとは異なり、実際の Jupyter サーバー / document-server に接続して動作を検証する。

### 前提条件

- `docker-compose up -d` でサービスが起動していること
- 環境変数 `JUPYTER_SERVER_URL`, `JUPYTER_TOKEN` が設定されていること（`.env` ファイル経由）

### テスト構造

```typescript
import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import { checkJupyterConnection, parseToolCallResult, cleanupSession } from '../setup.js';

describe('コード実行の結合テスト', () => {
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    await checkJupyterConnection();
  });

  afterEach(async () => {
    for (const sessionId of createdSessionIds) {
      await cleanupSession(sessionId);
    }
    createdSessionIds.length = 0;
  });

  test('print("hello") の実行結果が返る', async () => {
    // 1. セッション作成
    const createResult = await handleToolCall('session_create', { name: 'python3' });
    const createData = parseToolCallResult(createResult);
    expect(createData.success).toBe(true);
    createdSessionIds.push(createData.session_id as string);

    // 2. コード実行
    const execResult = await handleToolCall('execute_code', {
      session_id: createData.session_id,
      code: 'print("hello")',
    });
    const execData = parseToolCallResult(execResult);

    // 3. 検証
    expect(execData.success).toBe(true);
    expect(execData.stdout).toBe('hello\n');
  });
});
```

---

---

## チェックリスト

テスト作成時に以下を確認すること。

### 構造

- [ ] `describe` で機能単位をグルーピングしているか
- [ ] `正常系`、`バリデーションエラー`、`API エラー` のカテゴリに分けているか
- [ ] テスト名が日本語で意図を明示しているか（例: `正常系: 単一テーブル指定で詳細が取得できる`）
- [ ] Arrange-Act-Assert パターンに従っているか

### カバレッジ

- [ ] 基本的な成功パターンをテストしているか
- [ ] オプションパラメータあり/なしの両方をテストしているか
- [ ] 必須パラメータ未指定のバリデーションをテストしているか
- [ ] 空文字列のバリデーションをテストしているか
- [ ] 文字列長超過のバリデーションをテストしているか
- [ ] NULLバイト含有のバリデーションをテストしているか（該当する場合）
- [ ] パストラバーサル（`..`）のバリデーションをテストしているか（パス系パラメータの場合）
- [ ] API 接続エラー時の動作をテストしているか
- [ ] リソース未発見時の動作をテストしているか
- [ ] 部分成功（一部 not_found）のケースをテストしているか（一括取得 API の場合）

### モック

- [ ] `vi.mock()` はファイルトップレベルに配置しているか
- [ ] `beforeEach` で `vi.clearAllMocks()` を呼んでいるか
- [ ] モックは振る舞いレベルで行い、実装詳細に依存していないか
- [ ] 外部 API 呼び出しが `not.toHaveBeenCalled()` でガードされているか（バリデーションエラー時）

### クリーンアップ

- [ ] 結合テストで作成したリソース（セッション、ワークスペース、ノートブック）を `afterEach` で削除しているか
- [ ] E2E テストでクリーンアップ用の状態変数を管理しているか
- [ ] クリーンアップの失敗は無視して他テストに影響させない設計か

### E2E テスト固有

- [ ] `checkServices()` でサービス起動確認を行っているか
- [ ] サービス未起動時にテストをスキップする仕組みがあるか
- [ ] タイムアウト値が適切に設定されているか（E2E: 60s、結合: 30s、ユニット: 5s）
