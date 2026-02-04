/**
 * ファイル操作の結合テスト
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import { jupyterClient } from '../../src/jupyter-client/client.js';
import {
  generateTestNotebookName,
  cleanupNotebook,
  checkJupyterConnection,
  parseToolCallResult,
} from '../setup.js';

describe('ファイル操作の結合テスト', () => {
  const testNotebooks: string[] = [];
  // file_list ツールはセッション検証するが、実際には使用しないためダミー値を使用
  const dummySessionId = 'test-session-for-file-list';

  beforeAll(async () => {
    // Jupyter サーバーの接続確認
    await checkJupyterConnection();
  });

  afterEach(async () => {
    // テスト後のクリーンアップ
    for (const notebookPath of testNotebooks) {
      await cleanupNotebook(notebookPath);
    }
    testNotebooks.length = 0;
  });

  test('ノートブック作成 → file_list で確認', async () => {
    const notebookName = generateTestNotebookName('file-list-workflow');
    const notebookPath = `${notebookName}.ipynb`;
    testNotebooks.push(notebookPath);

    // 1. ノートブック作成
    const createResult = await handleToolCall('notebook_create', {
      name: notebookName,
    });
    const createData = parseToolCallResult(createResult);
    expect(createData.success).toBe(true);

    // 2. file_list でルートディレクトリのファイル一覧を取得
    const fileListResult = await handleToolCall('file_list', {
      session_id: dummySessionId,
      path: '/',
    });
    const fileListData = parseToolCallResult(fileListResult);

    // 3. 作成したノートブックが一覧に含まれることを確認
    expect(fileListData.path).toBe('/');
    expect(Array.isArray(fileListData.contents)).toBe(true);

    const createdFile = (fileListData.contents as Array<{ name: string; type: string }>)
      .find(file => file.name === notebookPath);

    expect(createdFile).toBeDefined();

    // 4. type が "notebook" であることを確認
    expect(createdFile?.type).toBe('notebook');
  });

  test('ルートディレクトリのファイル一覧を取得（path 省略）', async () => {
    // 1. file_list(session_id, path=undefined) を呼び出し
    const fileListResult = await handleToolCall('file_list', {
      session_id: dummySessionId,
    });
    const fileListData = parseToolCallResult(fileListResult);

    // 2. contents 配列が返ることを確認
    expect(Array.isArray(fileListData.contents)).toBe(true);

    // 3. path が "/" であることを確認
    expect(fileListData.path).toBe('/');
  });

  test('ルートディレクトリのファイル一覧を取得（path="/"）', async () => {
    // 1. file_list(session_id, path="/") を呼び出し
    const fileListResult = await handleToolCall('file_list', {
      session_id: dummySessionId,
      path: '/',
    });
    const fileListData = parseToolCallResult(fileListResult);

    // 2. contents 配列が返ることを確認
    expect(Array.isArray(fileListData.contents)).toBe(true);
    expect(fileListData.path).toBe('/');
  });

  test('file_list のレスポンス形式を確認', async () => {
    const notebookName = generateTestNotebookName('response-format');
    const notebookPath = `${notebookName}.ipynb`;
    testNotebooks.push(notebookPath);

    // 1. ノートブック作成
    await handleToolCall('notebook_create', { name: notebookName });

    // 2. file_list 呼び出し
    const fileListResult = await handleToolCall('file_list', {
      session_id: dummySessionId,
      path: '/',
    });
    const fileListData = parseToolCallResult(fileListResult);

    // 3. 各ファイルエントリに name, type, size, modified_at が含まれることを確認
    expect(Array.isArray(fileListData.contents)).toBe(true);

    const createdFile = (fileListData.contents as Array<{
      name: string;
      type: string;
      size?: number;
      modified_at?: string;
    }>).find(file => file.name === notebookPath);

    expect(createdFile).toBeDefined();
    expect(createdFile?.name).toBe(notebookPath);
    expect(createdFile?.type).toBe('notebook');
    expect(typeof createdFile?.size).toBe('number');
    expect(typeof createdFile?.modified_at).toBe('string');

    // modified_at が有効な日付形式であることを確認
    if (createdFile?.modified_at) {
      const date = new Date(createdFile.modified_at);
      expect(date.toString()).not.toBe('Invalid Date');
    }
  });

  test('複数ノートブック作成 → file_list で全て確認', async () => {
    // 1. ノートブック A, B, C を作成
    const notebookA = generateTestNotebookName('multi-a');
    const notebookB = generateTestNotebookName('multi-b');
    const notebookC = generateTestNotebookName('multi-c');

    const pathA = `${notebookA}.ipynb`;
    const pathB = `${notebookB}.ipynb`;
    const pathC = `${notebookC}.ipynb`;

    testNotebooks.push(pathA, pathB, pathC);

    await handleToolCall('notebook_create', { name: notebookA });
    await handleToolCall('notebook_create', { name: notebookB });
    await handleToolCall('notebook_create', { name: notebookC });

    // 2. file_list でルートディレクトリを取得
    const fileListResult = await handleToolCall('file_list', {
      session_id: dummySessionId,
      path: '/',
    });
    const fileListData = parseToolCallResult(fileListResult);

    // 3. A, B, C すべてが一覧に含まれることを確認
    const fileNames = (fileListData.contents as Array<{ name: string }>)
      .map(file => file.name);

    expect(fileNames).toContain(pathA);
    expect(fileNames).toContain(pathB);
    expect(fileNames).toContain(pathC);
  });
});

describe('file_list エラーハンドリング', () => {
  const dummySessionId = 'test-session-for-error-handling';

  beforeAll(async () => {
    await checkJupyterConnection();
  });

  test('パストラバーサル攻撃を拒否', async () => {
    // file_list(session_id, path="../etc/passwd") を呼び出し
    const fileListResult = await handleToolCall('file_list', {
      session_id: dummySessionId,
      path: '../etc/passwd',
    });

    const fileListData = parseToolCallResult(fileListResult);

    // VALIDATION_ERROR エラーを確認
    expect(fileListData.success).toBe(false);
    expect(fileListData.error).toBeDefined();
    expect((fileListData.error as { code: string }).code).toBe('VALIDATION_ERROR');
    expect((fileListData.error as { message: string }).message).toContain('..');
  });

  test('存在しないパスを指定 → エラー', async () => {
    const nonExistentPath = 'nonexistent-directory-' + Date.now();

    // file_list(session_id, path="nonexistent-directory") を呼び出し
    const fileListResult = await handleToolCall('file_list', {
      session_id: dummySessionId,
      path: nonExistentPath,
    });

    const fileListData = parseToolCallResult(fileListResult);

    // エラーを確認（現在の実装では INTERNAL_ERROR として返される）
    // TODO: jupyter-client の listContents に context を渡して NOT_FOUND を返すように改善
    expect(fileListData.success).toBe(false);
    expect(fileListData.error).toBeDefined();
    expect((fileListData.error as { code: string }).code).toBe('INTERNAL_ERROR');
  });

  test('session_id が未指定 → VALIDATION_ERROR', async () => {
    // session_id=undefined を呼び出し
    const fileListResult = await handleToolCall('file_list', {
      session_id: '',
    });

    const fileListData = parseToolCallResult(fileListResult);

    // VALIDATION_ERROR エラーを確認
    expect(fileListData.success).toBe(false);
    expect(fileListData.error).toBeDefined();
    expect((fileListData.error as { code: string }).code).toBe('VALIDATION_ERROR');
    expect((fileListData.error as { message: string }).message).toMatch(/session_id/i);
  });
});
