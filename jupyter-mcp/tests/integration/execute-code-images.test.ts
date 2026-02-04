/**
 * execute_code の画像出力テスト
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import {
  generateTestNotebookName,
  cleanupNotebook,
  cleanupSession,
  checkJupyterConnection,
  parseToolCallResult,
} from '../setup.js';

describe('execute_code の画像出力テスト', () => {
  const testNotebooks: string[] = [];
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    // Jupyter サーバーの接続確認
    await checkJupyterConnection();
  });

  afterEach(async () => {
    // テスト後のクリーンアップ
    for (const sessionId of createdSessionIds) {
      await cleanupSession(sessionId);
    }
    createdSessionIds.length = 0;

    for (const notebookPath of testNotebooks) {
      await cleanupNotebook(notebookPath);
    }
    testNotebooks.length = 0;
  });

  test('matplotlib でグラフを描画すると images 配列が返る', async () => {
    // 1. セッション作成
    const createResult = await handleToolCall('session_create', {
      name: 'python3',
    });
    const createData = parseToolCallResult(createResult);
    expect(createData.success).toBe(true);

    const sessionId = createData.session_id as string;
    createdSessionIds.push(sessionId);

    // 2. matplotlib でグラフを描画
    const code = `
import matplotlib.pyplot as plt
plt.figure(figsize=(8, 6))
plt.plot([1, 2, 3, 4], [1, 4, 2, 3])
plt.title('Test Plot')
plt.show()
`.trim();

    const executeResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code,
    });

    // 3. images 配列を確認
    const executeData = parseToolCallResult(executeResult);
    expect(executeData.success).toBe(true);
    expect(executeData.images).toBeDefined();
    expect(Array.isArray(executeData.images)).toBe(true);

    const images = executeData.images as Array<{
      resource_uri: string;
      mime_type: string;
      description: string;
    }>;

    expect(images).toHaveLength(1);

    const image = images[0];
    expect(image.resource_uri).toMatch(/^jupyter:\/\/sessions\/.+\/images\/.+\.png$/);
    expect(image.mime_type).toBe('image/png');
    expect(image.description).toContain('matplotlib');
  }, 30000); // matplotlib のインポートに時間がかかる場合があるため、タイムアウトを延長

  test('複数のグラフを描画すると複数の画像が返る', async () => {
    // 1. セッション作成
    const createResult = await handleToolCall('session_create', {
      name: 'python3',
    });
    const createData = parseToolCallResult(createResult);
    expect(createData.success).toBe(true);

    const sessionId = createData.session_id as string;
    createdSessionIds.push(sessionId);

    // 2. 複数のグラフを描画
    const code = `
import matplotlib.pyplot as plt

# グラフ1
plt.figure()
plt.plot([1, 2, 3])
plt.title('Graph 1')
plt.show()

# グラフ2
plt.figure()
plt.plot([3, 2, 1])
plt.title('Graph 2')
plt.show()
`.trim();

    const executeResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code,
    });

    // 3. images 配列を確認
    const executeData = parseToolCallResult(executeResult);
    expect(executeData.success).toBe(true);
    expect(executeData.images).toBeDefined();

    const images = executeData.images as Array<{
      resource_uri: string;
      mime_type: string;
      description: string;
    }>;

    expect(images.length).toBeGreaterThanOrEqual(2);

    // 各画像の resource_uri が異なることを確認
    const uris = images.map(img => img.resource_uri);
    const uniqueUris = new Set(uris);
    expect(uniqueUris.size).toBe(uris.length);
  }, 30000);

  test('グラフなしのコードでは images が空配列', async () => {
    // 1. セッション作成
    const createResult = await handleToolCall('session_create', {
      name: 'python3',
    });
    const createData = parseToolCallResult(createResult);
    expect(createData.success).toBe(true);

    const sessionId = createData.session_id as string;
    createdSessionIds.push(sessionId);

    // 2. グラフなしのコードを実行
    const executeResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: 'print("hello")',
    });

    // 3. images が空配列であることを確認
    const executeData = parseToolCallResult(executeResult);
    expect(executeData.success).toBe(true);
    expect(executeData.images).toBeDefined();
    expect(Array.isArray(executeData.images)).toBe(true);
    expect(executeData.images).toHaveLength(0);
  });

  test('画像の description に連番が付与される', async () => {
    // 1. セッション作成
    const createResult = await handleToolCall('session_create', {
      name: 'python3',
    });
    const createData = parseToolCallResult(createResult);
    expect(createData.success).toBe(true);

    const sessionId = createData.session_id as string;
    createdSessionIds.push(sessionId);

    // 2. 最初のグラフ
    const code1 = `
import matplotlib.pyplot as plt
plt.figure()
plt.plot([1, 2, 3])
plt.show()
`.trim();

    const executeResult1 = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: code1,
    });

    const executeData1 = parseToolCallResult(executeResult1);
    expect(executeData1.success).toBe(true);

    const images1 = executeData1.images as Array<{ description: string }>;
    expect(images1).toHaveLength(1);
    expect(images1[0].description).toContain('[1]');

    // 3. 2つ目のグラフ
    const code2 = `
plt.figure()
plt.plot([3, 2, 1])
plt.show()
`.trim();

    const executeResult2 = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: code2,
    });

    const executeData2 = parseToolCallResult(executeResult2);
    expect(executeData2.success).toBe(true);

    const images2 = executeData2.images as Array<{ description: string }>;
    expect(images2).toHaveLength(1);
    expect(images2[0].description).toContain('[2]');
  }, 30000);
});
