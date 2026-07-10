## 結合テスト (TypeScript)

ユニットテストとは異なり、実際の Jupyter サーバー / document-server に接続して動作を検証する。

### 前提条件

- `docker compose up -d` でサービスが起動していること
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
