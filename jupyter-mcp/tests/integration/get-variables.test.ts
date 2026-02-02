/**
 * get_variables ツールの結合テスト
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

describe('get_variables ツールの結合テスト', () => {
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

  describe('基本動作テスト', () => {
    // Note: 基本的な動作テストは get-variables-simple.test.ts に移動しました
    // （並列実行時の競合を避けるため）

    test('複数の変数型（int, float, str, bool, list）が正しく取得できる', async () => {
      // 1. セッション作成
      const createResult = await handleToolCall('session_create', {
        name: 'python3',
      });
      const createData = parseToolCallResult(createResult);
      expect(createData.success).toBe(true);

      const sessionId = createData.session_id as string;
      createdSessionIds.push(sessionId);

      // 2. 各種型の変数を定義
      await handleToolCall('execute_code', {
        session_id: sessionId,
        code: `
int_var = 42
float_var = 3.14
str_var = "hello"
bool_var = True
list_var = [1, 2, 3]
        `,
      });

      // 3. get_variables を呼び出し
      const getVariablesResult = await handleToolCall('get_variables', {
        session_id: sessionId,
      });

      // 4. 各変数の型を確認
      const getVariablesData = parseToolCallResult(getVariablesResult);
      expect(getVariablesData.success).toBe(true);

      const variables = getVariablesData.variables as Array<{
        name: string;
        type: string;
        value?: unknown;
      }>;

      const intVar = variables.find(v => v.name === 'int_var');
      expect(intVar?.type).toBe('int');
      expect(intVar?.value).toBe(42);

      const floatVar = variables.find(v => v.name === 'float_var');
      expect(floatVar?.type).toBe('float');
      expect(floatVar?.value).toBe(3.14);

      const strVar = variables.find(v => v.name === 'str_var');
      expect(strVar?.type).toBe('str');
      expect(strVar?.value).toBe('hello');

      const boolVar = variables.find(v => v.name === 'bool_var');
      expect(boolVar?.type).toBe('bool');
      expect(boolVar?.value).toBe(true);

      const listVar = variables.find(v => v.name === 'list_var');
      expect(listVar?.type).toBe('list');
      // list は value ではなく size が返る可能性がある
    }, 10000); // タイムアウトを10秒に設定
  });

  describe('エラーハンドリングテスト', () => {
    test('存在しないセッションの場合、エラーが返る', async () => {
      const fakeSessionId = 'non-existent-session-id-12345';

      // 存在しないセッションで get_variables を呼び出し
      const getVariablesResult = await handleToolCall('get_variables', {
        session_id: fakeSessionId,
      });

      // エラーが返る
      const getVariablesData = parseToolCallResult(getVariablesResult);
      expect(getVariablesData.success).toBe(false);
      expect(getVariablesData.error).toBeDefined();

      const error = getVariablesData.error as { code?: string };
      expect(error.code).toMatch(/NOT_FOUND|KERNEL_NOT_FOUND/);
    });

    test('session_id が空文字の場合、VALIDATION_ERROR が返る', async () => {
      const getVariablesResult = await handleToolCall('get_variables', {
        session_id: '',
      });

      const getVariablesData = parseToolCallResult(getVariablesResult);
      expect(getVariablesData.success).toBe(false);
      expect(getVariablesData.error).toBeDefined();

      const error = getVariablesData.error as { code?: string };
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    test('session_id が未指定の場合、VALIDATION_ERROR が返る', async () => {
      const getVariablesResult = await handleToolCall('get_variables', {});

      const getVariablesData = parseToolCallResult(getVariablesResult);
      expect(getVariablesData.success).toBe(false);
      expect(getVariablesData.error).toBeDefined();

      const error = getVariablesData.error as { code?: string };
      expect(error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('ワークフローテスト', () => {
    test('ノートブック作成 → セッション作成 → 変数定義 → get_variables', async () => {
      const notebookName = generateTestNotebookName('workflow-get-variables');
      const notebookPath = `${notebookName}.ipynb`;
      testNotebooks.push(notebookPath);

      // 1. ノートブック作成
      const createNotebookResult = await handleToolCall('notebook_create', {
        name: notebookName,
      });
      const createNotebookData = parseToolCallResult(createNotebookResult);
      expect(createNotebookData.success).toBe(true);

      // 2. セッション作成（ノートブックと紐付け）
      const createSessionResult = await handleToolCall('session_create', {
        name: 'python3',
        notebook_path: notebookPath,
      });
      const createSessionData = parseToolCallResult(createSessionResult);
      expect(createSessionData.success).toBe(true);

      const sessionId = createSessionData.session_id as string;
      createdSessionIds.push(sessionId);

      // 3. 複数の変数を定義
      await handleToolCall('execute_code', {
        session_id: sessionId,
        code: `
import pandas as pd
import numpy as np

x = 42
y = 3.14
name = "test"
data = pd.DataFrame({"A": [1, 2], "B": [3, 4]})
array = np.array([1, 2, 3, 4, 5])
        `,
      });

      // 4. get_variables を呼び出し
      const getVariablesResult = await handleToolCall('get_variables', {
        session_id: sessionId,
      });

      // 5. 変数一覧を確認
      const getVariablesData = parseToolCallResult(getVariablesResult);
      expect(getVariablesData.success).toBe(true);

      const variables = getVariablesData.variables as Array<{
        name: string;
        type: string;
        value?: unknown;
        size?: string;
      }>;

      // 定義した変数が含まれることを確認
      expect(variables.some(v => v.name === 'x')).toBe(true);
      expect(variables.some(v => v.name === 'y')).toBe(true);
      expect(variables.some(v => v.name === 'name')).toBe(true);
      expect(variables.some(v => v.name === 'data')).toBe(true);
      expect(variables.some(v => v.name === 'array')).toBe(true);

      // DataFrame の詳細を確認
      const dataVar = variables.find(v => v.name === 'data');
      expect(dataVar?.type).toBe('DataFrame');
      expect(dataVar?.size).toContain('rows');
    });
  });
});
