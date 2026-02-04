/**
 * get_image_resource ツールのテスト
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import {
  cleanupSession,
  checkJupyterConnection,
  parseToolCallResult,
} from '../setup.js';

describe('get_image_resource ツールのテスト', () => {
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
  });

  test('有効な resource_uri で画像データ（base64）を取得できる', async () => {
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

    const executeData = parseToolCallResult(executeResult);
    expect(executeData.success).toBe(true);
    expect(executeData.images).toBeDefined();

    const images = executeData.images as Array<{
      resource_uri: string;
      mime_type: string;
      description: string;
    }>;

    expect(images).toHaveLength(1);
    const resourceUri = images[0].resource_uri;

    // 3. get_image_resource で画像データを取得
    const getImageResult = await handleToolCall('get_image_resource', {
      resource_uri: resourceUri,
    });

    const imageData = parseToolCallResult(getImageResult);

    // 4. レスポンスの検証
    expect(imageData.success).toBe(true);
    expect(imageData.mime_type).toBe('image/png');
    expect(imageData.data).toBeDefined();
    expect(typeof imageData.data).toBe('string');

    // base64形式の確認（簡易チェック）
    expect(imageData.data.length).toBeGreaterThan(0);

    // width, height はオプショナルなので、存在する場合のみ数値であることを確認
    if (imageData.width !== undefined) {
      expect(typeof imageData.width).toBe('number');
    }
    if (imageData.height !== undefined) {
      expect(typeof imageData.height).toBe('number');
    }
  }, 30000);

  test('不正な resource_uri を指定するとエラーが返る', async () => {
    // 1. 不正なURI形式を指定
    const result = await handleToolCall('get_image_resource', {
      resource_uri: 'invalid-uri',
    });

    const data = parseToolCallResult(result);

    // 2. エラーレスポンスの検証
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    expect(data.error.code).toMatch(/INVALID_URI|NOT_FOUND/);
  });

  test('存在しない画像を指定すると NOT_FOUND エラーが返る', async () => {
    // 1. 存在しないが形式は正しいURIを指定
    const nonExistentUri = 'jupyter://sessions/non-existent-session/images/non-existent-image.png';

    const result = await handleToolCall('get_image_resource', {
      resource_uri: nonExistentUri,
    });

    const data = parseToolCallResult(result);

    // 2. NOT_FOUND エラーの検証
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe('NOT_FOUND');
    expect(data.error.message).toContain('見つかりません');
  });

  test('resource_uri が未指定の場合はバリデーションエラーが返る', async () => {
    // 1. resource_uri なしでツールを呼び出し
    const result = await handleToolCall('get_image_resource', {});

    const data = parseToolCallResult(result);

    // 2. バリデーションエラーの検証
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  test('複数の画像を連続して取得できる', async () => {
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

    const executeData = parseToolCallResult(executeResult);
    expect(executeData.success).toBe(true);

    const images = executeData.images as Array<{
      resource_uri: string;
      mime_type: string;
      description: string;
    }>;

    expect(images.length).toBeGreaterThanOrEqual(2);

    // 3. 各画像を取得
    for (const image of images) {
      const getImageResult = await handleToolCall('get_image_resource', {
        resource_uri: image.resource_uri,
      });

      const imageData = parseToolCallResult(getImageResult);

      // 4. 各画像のレスポンスを検証
      expect(imageData.success).toBe(true);
      expect(imageData.mime_type).toBe('image/png');
      expect(imageData.data).toBeDefined();
      expect(typeof imageData.data).toBe('string');
      expect(imageData.data.length).toBeGreaterThan(0);
    }
  }, 30000);
});
