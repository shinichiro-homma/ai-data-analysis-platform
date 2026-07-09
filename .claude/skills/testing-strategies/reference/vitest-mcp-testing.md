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
