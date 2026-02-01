/**
 * セッション管理の結合テスト
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import { jupyterClient } from '../../src/jupyter-client/client.js';
import {
  checkJupyterConnection,
  parseToolCallResult,
  cleanupSession,
} from '../setup.js';

describe('セッション管理の結合テスト', () => {
  // テストで作成したセッションIDを保持（クリーンアップ用）
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

  test('session_create で新しいセッションが作成される', async () => {
    // 1. セッション（カーネル）を作成
    const createResult = await handleToolCall('session_create', {
      name: 'python3',
    });

    // 2. 作成成功を確認
    const createData = parseToolCallResult(createResult);
    expect(createData.success).toBe(true);
    expect(createData.session_id).toBeDefined();
    expect(typeof createData.session_id).toBe('string');
    expect(createData.kernel_id).toBeDefined();
    expect(createData.status).toBeDefined();

    // クリーンアップ用にIDを記録
    createdSessionIds.push(createData.session_id as string);

    // 3. カーネル一覧を取得して存在確認
    const kernels = await jupyterClient.listKernels();
    const found = kernels.find((k) => k.id === createData.session_id);
    expect(found).toBeDefined();
    expect(found?.name).toBe('python3');
  });

  test('session_list で作成したセッションが表示される', async () => {
    // 1. セッションを作成
    const createResult = await handleToolCall('session_create', {
      name: 'python3',
    });
    const createData = parseToolCallResult(createResult);
    createdSessionIds.push(createData.session_id as string);

    // 2. セッション一覧を取得
    const listResult = await handleToolCall('session_list', {});

    // 3. 一覧に含まれていることを確認
    const listData = parseToolCallResult(listResult);
    expect(listData.success).toBe(true);
    expect(listData.sessions).toBeDefined();
    expect(Array.isArray(listData.sessions)).toBe(true);

    const sessions = listData.sessions as Array<{ session_id: string }>;
    const found = sessions.find((s) => s.session_id === createData.session_id);
    expect(found).toBeDefined();
  });

  test('session_delete でセッションが削除される', async () => {
    // 1. セッションを作成
    const createResult = await handleToolCall('session_create', {
      name: 'python3',
    });
    const createData = parseToolCallResult(createResult);
    const sessionId = createData.session_id as string;

    // 2. セッションを削除
    const deleteResult = await handleToolCall('session_delete', {
      session_id: sessionId,
    });

    // 3. 削除成功を確認
    const deleteData = parseToolCallResult(deleteResult);
    expect(deleteData.success).toBe(true);
    expect(deleteData.session_id).toBe(sessionId);

    // 4. カーネル一覧から消えていることを確認
    const kernels = await jupyterClient.listKernels();
    const found = kernels.find((k) => k.id === sessionId);
    expect(found).toBeUndefined();

    // 削除済みなのでクリーンアップリストから除外
    // （何もしない - afterEach で cleanupSession が失敗しても問題ない設計）
  });

  test('セッション作成→一覧確認→削除の一連フローが動作する', async () => {
    // 1. セッション作成
    const createResult = await handleToolCall('session_create', {
      name: 'python3',
    });
    const createData = parseToolCallResult(createResult);
    expect(createData.success).toBe(true);

    const sessionId = createData.session_id as string;
    expect(sessionId).toBeDefined();

    // クリーンアップ用に記録
    createdSessionIds.push(sessionId);

    // 2. 一覧で確認
    const listResult = await handleToolCall('session_list', {});
    const listData = parseToolCallResult(listResult);
    expect(listData.success).toBe(true);

    const sessions = listData.sessions as Array<{ session_id: string }>;
    const found = sessions.find((s) => s.session_id === sessionId);
    expect(found).toBeDefined();

    // 3. 削除
    const deleteResult = await handleToolCall('session_delete', {
      session_id: sessionId,
    });
    const deleteData = parseToolCallResult(deleteResult);
    expect(deleteData.success).toBe(true);

    // 4. 一覧から消えていることを確認
    const listAfterDelete = await handleToolCall('session_list', {});
    const listAfterData = parseToolCallResult(listAfterDelete);

    const sessionsAfter = listAfterData.sessions as Array<{ session_id: string }>;
    const foundAfter = sessionsAfter.find((s) => s.session_id === sessionId);
    expect(foundAfter).toBeUndefined();

    // 削除済みなのでクリーンアップリストから除外
    const index = createdSessionIds.indexOf(sessionId);
    if (index > -1) {
      createdSessionIds.splice(index, 1);
    }
  });

  describe('エラーケース', () => {
    test('存在しない session_id で削除するとエラーが返る', async () => {
      const fakeSessionId = 'non-existent-session-id-12345';

      const deleteResult = await handleToolCall('session_delete', {
        session_id: fakeSessionId,
      });

      const deleteData = parseToolCallResult(deleteResult);
      expect(deleteData.success).toBe(false);
      expect(deleteData.error).toBeDefined();

      // エラーコードを確認（KERNEL_NOT_FOUND or NOT_FOUND）
      const error = deleteData.error as { code?: string; message?: string };
      expect(error.code).toMatch(/NOT_FOUND|KERNEL_NOT_FOUND/);
    });

    test('session_delete に session_id を指定しないとエラーが返る', async () => {
      const deleteResult = await handleToolCall('session_delete', {});

      const deleteData = parseToolCallResult(deleteResult);
      expect(deleteData.success).toBe(false);
      expect(deleteData.error).toBeDefined();

      // バリデーションエラーを確認
      const error = deleteData.error as { code?: string; message?: string };
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.message).toContain('session_id');
    });
  });
});
