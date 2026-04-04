import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeExecuteCode } from '../../../src/tools/execute-code.js';
import type { ExecuteResult } from '../../../src/jupyter-client/types.js';

// jupyterClient と resolveKernelId をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    executeCode: vi.fn(),
    getContents: vi.fn(),
    postAiEvent: vi.fn(),
    updateCellOutputs: vi.fn(),
    operateCell: vi.fn(),
  },
}));

vi.mock('../../../src/utils/session-resolver.js', () => ({
  resolveSession: vi.fn(),
  resolveKernelId: vi.fn(),
  resolveNotebookPath: vi.fn(),
}));

vi.mock('../../../src/image-store/index.js', () => ({
  toImageReference: vi.fn((img: { file_path: string; mime_type: string; description: string }) => ({
    file_path: img.file_path,
    mime_type: img.mime_type,
    description: img.description,
  })),
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';
import { resolveSession, resolveKernelId, resolveNotebookPath } from '../../../src/utils/session-resolver.js';
import { resetCellTracker } from '../../../src/utils/notebook-cell-tracker.js';

describe('executeExecuteCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCellTracker();
    // デフォルトではnotebook_pathは取得できない（kernel_idのみで作成されたセッション）
    vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: null });
    vi.mocked(resolveKernelId).mockResolvedValue('kernel-123');
    vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: null });
    vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });
    vi.mocked(jupyterClient.updateCellOutputs).mockResolvedValue(undefined);
  });

  describe('正常系', () => {
    test('コード実行成功 => 結果返却', async () => {
      const mockResult: ExecuteResult = {
        success: true,
        outputs: [{ type: 'stdout', text: 'Hello, World!\n' }],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 100,
      };

      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("Hello, World!")',
      });

      expect(resolveSession).toHaveBeenCalledWith('session-123');
      expect(jupyterClient.executeCode).toHaveBeenCalledWith('kernel-123', {
        code: 'print("Hello, World!")',
        timeout: 30,
      });
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('Hello, World!');
    });

    test('カスタムタイムアウト指定 => タイムアウト適用', async () => {
      const mockResult: ExecuteResult = {
        success: true,
        outputs: [],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 1000,
      };

      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      await executeExecuteCode({
        session_id: 'session-123',
        code: 'import time; time.sleep(1)',
        timeout: 60,
      });

      expect(jupyterClient.executeCode).toHaveBeenCalledWith('kernel-123', {
        code: 'import time; time.sleep(1)',
        timeout: 60,
      });
    });

    test('空のコード => 正常実行', async () => {
      const mockResult: ExecuteResult = {
        success: true,
        outputs: [],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 10,
      };

      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: '',
      });

      expect(result.content[0].text).toContain('"success": true');
    });
  });

  describe('バリデーションエラー', () => {
    test('session_id が未指定 => エラー', async () => {
      const result = await executeExecuteCode({
        code: 'print("test")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('session_id パラメータは必須です');
      expect(jupyterClient.executeCode).not.toHaveBeenCalled();
    });

    test('session_id が空文字列 => エラー', async () => {
      const result = await executeExecuteCode({
        session_id: '',
        code: 'print("test")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('session_id パラメータが空です');
    });

    test('session_id が長すぎる => エラー', async () => {
      const longSessionId = 'a'.repeat(201);
      const result = await executeExecuteCode({
        session_id: longSessionId,
        code: 'print("test")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('session_id が長すぎます（最大200文字）');
    });

    test('code がNULLバイト含む => エラー', async () => {
      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("test\0")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('code に不正な文字が含まれています');
    });

    test('timeout が0以下 => エラー', async () => {
      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("test")',
        timeout: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('timeout は 0 より大きい値である必要があります');
    });

    test('timeout が300秒超 => エラー', async () => {
      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("test")',
        timeout: 301,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('timeout は最大 300 です');
    });

    test('timeout が数値でない => エラー', async () => {
      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("test")',
        timeout: '30' as any,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('timeout パラメータは数値である必要があります');
    });
  });

  describe('イベント配信', () => {
    test('notebook_path付きセッション => イベント配信される', async () => {
      vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'test.ipynb' });
      vi.mocked(jupyterClient.getContents).mockResolvedValue({
        path: 'test.ipynb',
        type: 'notebook',
        content: {
          cells: [{ cell_type: 'code', source: 'print("Hello!")' }],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      });

      const mockResult: ExecuteResult = {
        success: true,
        outputs: [{ type: 'stdout', text: 'Hello!\n' }],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 100,
      };

      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("Hello!")',
      });

      // cell_execute_start が配信される
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_execute_start',
        notebook_path: 'test.ipynb',
        cell_index: 0,
      });

      // cell_output が配信される（stdout）
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_output',
        notebook_path: 'test.ipynb',
        cell_index: 0,
        output: {
          output_type: 'stream',
          name: 'stdout',
          text: 'Hello!\n',
        },
      });

      // cell_execute_end が配信される
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_execute_end',
        notebook_path: 'test.ipynb',
        cell_index: 0,
        execution_count: 1,
        success: true,
      });
    });

    test('notebook_pathなし => イベント配信スキップ', async () => {
      vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: null });

      const mockResult: ExecuteResult = {
        success: true,
        outputs: [{ type: 'stdout', text: 'Hello!\n' }],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 100,
      };

      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("Hello!")',
      });

      // イベント配信されない
      expect(jupyterClient.postAiEvent).not.toHaveBeenCalled();
      // execute_code 自体は成功
      expect(result.content[0].text).toContain('"success": true');
    });

    test('画像出力 => レスポンスに file_path ベースの ImageReference が含まれる', async () => {
      vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'test.ipynb' });
      vi.mocked(jupyterClient.getContents).mockResolvedValue({
        path: 'test.ipynb',
        type: 'notebook',
        content: {
          cells: [{ cell_type: 'code', source: 'plt.plot([1,2,3])' }],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      });

      const mockResult: ExecuteResult = {
        success: true,
        outputs: [],
        result: null,
        execution_count: 1,
        images: [
          {
            file_path: 'workspaces/ws-001/output/exec-1-img-001.png',
            mime_type: 'image/png',
            description: 'matplotlib output [1]',
          },
        ],
        execution_time_ms: 100,
      };

      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'plt.plot([1,2,3])',
      });

      // レスポンスに file_path ベースの ImageReference が含まれる
      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.images).toHaveLength(1);
      expect(responseData.images[0]).toEqual({
        file_path: 'workspaces/ws-001/output/exec-1-img-001.png',
        mime_type: 'image/png',
        description: 'matplotlib output [1]',
      });

      // 画像の display_data イベントは配信されない（jupyter-server の WebSocket 経由で配信されるため）
      expect(jupyterClient.postAiEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cell_output',
          output: expect.objectContaining({ output_type: 'display_data' }),
        }),
      );
    });

    test('エラー出力 => error イベント配信', async () => {
      vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'test.ipynb' });
      vi.mocked(jupyterClient.getContents).mockResolvedValue({
        path: 'test.ipynb',
        type: 'notebook',
        content: {
          cells: [{ cell_type: 'code', source: '1/0' }],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      });

      const mockResult: ExecuteResult = {
        success: false,
        outputs: [],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 50,
        error: {
          type: 'ZeroDivisionError',
          message: 'division by zero',
          traceback: ['Traceback...', 'ZeroDivisionError: division by zero'],
        },
      };

      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      await executeExecuteCode({
        session_id: 'session-123',
        code: '1/0',
      });

      // cell_output が配信される（error）
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_output',
        notebook_path: 'test.ipynb',
        cell_index: 0,
        output: {
          output_type: 'error',
          ename: 'ZeroDivisionError',
          evalue: 'division by zero',
          traceback: ['Traceback...', 'ZeroDivisionError: division by zero'],
        },
      });

      // cell_execute_end も配信される（success: false）
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_execute_end',
        notebook_path: 'test.ipynb',
        cell_index: 0,
        execution_count: 1,
        success: false,
      });
    });

    test('式の評価結果 => execute_result イベント配信', async () => {
      vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'test.ipynb' });
      vi.mocked(jupyterClient.getContents).mockResolvedValue({
        path: 'test.ipynb',
        type: 'notebook',
        content: {
          cells: [{ cell_type: 'code', source: '1+1' }],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      });

      const mockResult: ExecuteResult = {
        success: true,
        outputs: [],
        result: 2,
        execution_count: 1,
        images: [],
        execution_time_ms: 10,
      };

      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      await executeExecuteCode({
        session_id: 'session-123',
        code: '1+1',
      });

      // cell_output が配信される（execute_result）
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_output',
        notebook_path: 'test.ipynb',
        cell_index: 0,
        output: {
          output_type: 'execute_result',
          execution_count: 1,
          data: { 'text/plain': '2' },
          metadata: {},
        },
      });
    });
  });

  describe('セル自動追加', () => {
    test('セルが0個の場合 => コードセルが自動追加される', async () => {
      vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'test.ipynb' });
      vi.mocked(jupyterClient.getContents).mockResolvedValue({
        path: 'test.ipynb',
        type: 'notebook',
        content: {
          cells: [],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      });
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);

      const mockResult: ExecuteResult = {
        success: true,
        outputs: [{ type: 'stdout', text: 'hello\n' }],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 100,
      };
      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("hello")',
      });

      // cell_added イベントが配信される
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_added',
        notebook_path: 'test.ipynb',
        cell: { cell_type: 'code', source: 'print("hello")' },
        index: -1,
      });

      // ブラウザ未接続 → REST API でディスクに書き込み
      expect(jupyterClient.operateCell).toHaveBeenCalledWith('test.ipynb', {
        action: 'add',
        cell: { cell_type: 'code', source: 'print("hello")' },
      });

      // cellIndex=0 でイベント配信される
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_execute_start',
        notebook_path: 'test.ipynb',
        cell_index: 0,
      });

      expect(result.content[0].text).toContain('"success": true');
    });

    test('末尾セルのソースが一致しない場合 => セルが自動追加される', async () => {
      vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'test.ipynb' });
      vi.mocked(jupyterClient.getContents).mockResolvedValue({
        path: 'test.ipynb',
        type: 'notebook',
        content: {
          cells: [{ cell_type: 'code', source: 'print("old code")' }],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      });
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);

      const mockResult: ExecuteResult = {
        success: true,
        outputs: [{ type: 'stdout', text: 'new\n' }],
        result: null,
        execution_count: 2,
        images: [],
        execution_time_ms: 50,
      };
      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("new code")',
      });

      // cell_added イベントが配信される
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_added',
        notebook_path: 'test.ipynb',
        cell: { cell_type: 'code', source: 'print("new code")' },
        index: -1,
      });

      // cellIndex=1（追加された2番目のセル）でイベント配信
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_execute_start',
        notebook_path: 'test.ipynb',
        cell_index: 1,
      });
    });

    test('末尾セルのソースが一致する場合 => セルは追加されない', async () => {
      vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'test.ipynb' });
      vi.mocked(jupyterClient.getContents).mockResolvedValue({
        path: 'test.ipynb',
        type: 'notebook',
        content: {
          cells: [{ cell_type: 'code', source: 'print("hello")' }],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      });

      const mockResult: ExecuteResult = {
        success: true,
        outputs: [{ type: 'stdout', text: 'hello\n' }],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 50,
      };
      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("hello")',
      });

      // cell_added イベントは配信されない
      expect(jupyterClient.postAiEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'cell_added' }));

      // operateCell は呼ばれない
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();

      // cellIndex=0 で既存セルを使用
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_execute_start',
        notebook_path: 'test.ipynb',
        cell_index: 0,
      });
    });

    test('セル自動追加失敗時 => コード実行は正常に完了する', async () => {
      vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'test.ipynb' });
      vi.mocked(jupyterClient.getContents).mockResolvedValue({
        path: 'test.ipynb',
        type: 'notebook',
        content: {
          cells: [],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      });
      // postAiEvent の cell_added 呼び出しでエラー
      vi.mocked(jupyterClient.postAiEvent).mockRejectedValueOnce(new Error('Event broadcast failed'));

      const mockResult: ExecuteResult = {
        success: true,
        outputs: [{ type: 'stdout', text: 'hello\n' }],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 100,
      };
      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("hello")',
      });

      // コード実行自体は成功（cellIndex=-1 でイベント配信はスキップされる）
      expect(result.content[0].text).toContain('"success": true');
      expect(jupyterClient.executeCode).toHaveBeenCalled();
    });

    test('ブラウザ接続ありの場合でも operateCell が呼ばれる（永続化保証）', async () => {
      vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'test.ipynb' });
      vi.mocked(jupyterClient.getContents).mockResolvedValue({
        path: 'test.ipynb',
        type: 'notebook',
        content: {
          cells: [],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      });
      // ブラウザが接続中（clients > 0）
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 1 });
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);

      const mockResult: ExecuteResult = {
        success: true,
        outputs: [{ type: 'stdout', text: 'hello\n' }],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 100,
      };
      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("hello")',
      });

      // cell_added イベントは配信される
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'cell_added' }));

      // ブラウザ接続ありでも operateCell が呼ばれる（永続化保証）
      expect(jupyterClient.operateCell).toHaveBeenCalledWith('test.ipynb', {
        action: 'add',
        cell: {
          cell_type: 'code',
          source: 'print("hello")',
        },
        index: undefined,
      });
    });
  });

  describe('cell_index パラメータ', () => {
    test('cell_index 指定時 => resolveOrCreateCell をスキップして指定インデックスを使用', async () => {
      vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'test.ipynb' });

      const mockResult: ExecuteResult = {
        success: true,
        outputs: [{ type: 'stdout', text: 'hello\n' }],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 50,
      };
      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("hello")',
        cell_index: 3,
      });

      // getContents は呼ばれない（resolveOrCreateCell がスキップされる）
      expect(jupyterClient.getContents).not.toHaveBeenCalled();

      // 指定された cellIndex=3 でイベント配信される
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_execute_start',
        notebook_path: 'test.ipynb',
        cell_index: 3,
      });
    });

    test('cell_index 未指定 => resolveOrCreateCell が使用される', async () => {
      vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'test.ipynb' });
      vi.mocked(jupyterClient.getContents).mockResolvedValue({
        path: 'test.ipynb',
        type: 'notebook',
        content: {
          cells: [{ cell_type: 'code', source: 'print("hello")' }],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      });

      const mockResult: ExecuteResult = {
        success: true,
        outputs: [{ type: 'stdout', text: 'hello\n' }],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 50,
      };
      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("hello")',
      });

      // getContents が呼ばれる（resolveOrCreateCell が実行される）
      expect(jupyterClient.getContents).toHaveBeenCalledWith('test.ipynb');
    });
  });

  describe('逆順検索', () => {
    test('末尾でないセルのソースが一致する場合 => そのセルのインデックスを使用', async () => {
      vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'test.ipynb' });
      vi.mocked(jupyterClient.getContents).mockResolvedValue({
        path: 'test.ipynb',
        type: 'notebook',
        content: {
          cells: [
            { cell_type: 'code', source: 'import pandas' },
            { cell_type: 'code', source: 'print("hello")' },
            { cell_type: 'code', source: 'df.head()' },
          ],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      });

      const mockResult: ExecuteResult = {
        success: true,
        outputs: [{ type: 'stdout', text: 'hello\n' }],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 50,
      };
      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      await executeExecuteCode({
        session_id: 'session-123',
        code: 'import pandas',
      });

      // セルは追加されない（index 0 で一致）
      expect(jupyterClient.postAiEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'cell_added' }));

      // cellIndex=0 でイベント配信される
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_execute_start',
        notebook_path: 'test.ipynb',
        cell_index: 0,
      });
    });
  });

  describe('実行エラー', () => {
    test('コード実行でエラー => エラー情報返却', async () => {
      const mockResult: ExecuteResult = {
        success: false,
        outputs: [],
        result: null,
        error: {
          type: 'NameError',
          message: "name 'x' is not defined",
          traceback: ['Traceback (most recent call last):', '  ...', "NameError: name 'x' is not defined"],
        },
        execution_count: 1,
        images: [],
        execution_time_ms: 50,
      };

      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print(x)',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain("name 'x' is not defined");
    });

    test('セッション解決失敗 => エラー', async () => {
      vi.mocked(resolveSession).mockRejectedValue(new Error('Session not found'));

      const result = await executeExecuteCode({
        session_id: 'nonexistent',
        code: 'print("test")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Session not found');
      expect(jupyterClient.executeCode).not.toHaveBeenCalled();
    });

    test('API呼び出し失敗 => エラー', async () => {
      vi.mocked(jupyterClient.executeCode).mockRejectedValue(new Error('Connection timeout'));

      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("test")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Connection timeout');
    });
  });
});
