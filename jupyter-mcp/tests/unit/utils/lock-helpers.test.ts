import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// jupyter-client（ロック API）をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    acquireLock: vi.fn(),
    renewLock: vi.fn(),
    releaseLock: vi.fn(),
  },
}));

// notebook_path 解決をモック
vi.mock('../../../src/utils/session-resolver.js', () => ({
  resolveNotebookPath: vi.fn(),
}));

// logger をモック（warn 呼び出しの検証用）
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';
import { NotebookLockedError } from '../../../src/jupyter-client/errors.js';
import { logger } from '../../../src/utils/logger.js';
import { withNotebookLock } from '../../../src/utils/lock-helpers.js';
import { getCurrentLockToken } from '../../../src/utils/lock-context.js';

const NOTEBOOK_PATH = 'workspaces/sample/ws-001/test.ipynb';
const LOCK_TOKEN = 'lock-token-abc';

const mockAcquire = vi.mocked(jupyterClient.acquireLock);
const mockRenew = vi.mocked(jupyterClient.renewLock);
const mockRelease = vi.mocked(jupyterClient.releaseLock);

/** ツール実行結果の簡易モック */
const okResult = { content: [{ type: 'text', text: 'ok' }] };

describe('withNotebookLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquire.mockResolvedValue({ lockToken: LOCK_TOKEN, expiresAt: Date.now() + 60000 });
    mockRenew.mockResolvedValue({ lockToken: LOCK_TOKEN, expiresAt: Date.now() + 60000 });
    mockRelease.mockResolvedValue(undefined);
  });

  describe('acquire → execute → release の順序', () => {
    test('ロック取得後にツールを実行し、完了後に解放する', async () => {
      const execute = vi.fn(async () => okResult);

      const result = await withNotebookLock({ notebook_path: NOTEBOOK_PATH }, execute);

      expect(result).toBe(okResult);
      expect(mockAcquire).toHaveBeenCalledTimes(1);
      expect(mockAcquire).toHaveBeenCalledWith(NOTEBOOK_PATH);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(mockRelease).toHaveBeenCalledTimes(1);
      expect(mockRelease).toHaveBeenCalledWith(NOTEBOOK_PATH, LOCK_TOKEN);

      // acquire は execute より前に呼ばれる
      expect(mockAcquire.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]);
      // release は execute より後に呼ばれる
      expect(execute.mock.invocationCallOrder[0]).toBeLessThan(mockRelease.mock.invocationCallOrder[0]);
    });

    test('ツール実行がエラーでも release が呼ばれる（try...finally）', async () => {
      const execute = vi.fn(async () => {
        throw new Error('tool failed');
      });

      await expect(withNotebookLock({ notebook_path: NOTEBOOK_PATH }, execute)).rejects.toThrow('tool failed');

      expect(mockAcquire).toHaveBeenCalledTimes(1);
      expect(mockRelease).toHaveBeenCalledTimes(1);
      expect(mockRelease).toHaveBeenCalledWith(NOTEBOOK_PATH, LOCK_TOKEN);
    });
  });

  describe('acquire が 423（NotebookLockedError）', () => {
    test('ツールを実行せず NOTEBOOK_LOCKED エラーレスポンスを返す', async () => {
      mockAcquire.mockRejectedValueOnce(new NotebookLockedError(NOTEBOOK_PATH));
      const execute = vi.fn(async () => okResult);

      const result = await withNotebookLock({ notebook_path: NOTEBOOK_PATH }, execute);

      // execute は呼ばれない
      expect(execute).not.toHaveBeenCalled();
      // release も呼ばれない（取得していないため）
      expect(mockRelease).not.toHaveBeenCalled();

      // NOTEBOOK_LOCKED エラーレスポンス
      const payload = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(payload.success).toBe(false);
      expect(payload.error.code).toBe('NOTEBOOK_LOCKED');
    });
  });

  describe('release 失敗の握りつぶし', () => {
    test('release が失敗しても warn ログのみでツール結果は返る', async () => {
      mockRelease.mockRejectedValueOnce(new Error('release failed'));
      const execute = vi.fn(async () => okResult);

      const result = await withNotebookLock({ notebook_path: NOTEBOOK_PATH }, execute);

      expect(result).toBe(okResult);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('ロックトークンの実行コンテキスト伝播（バグ 1）', () => {
    test('execute は現在のロックトークンが設定された AsyncLocalStorage コンテキスト内で実行される', async () => {
      let tokenDuringExecute: string | undefined;
      const execute = vi.fn(async () => {
        tokenDuringExecute = getCurrentLockToken();
        return okResult;
      });

      await withNotebookLock({ notebook_path: NOTEBOOK_PATH }, execute);

      expect(tokenDuringExecute).toBe(LOCK_TOKEN);
    });

    test('withNotebookLock の外ではロックトークンは設定されない', () => {
      expect(getCurrentLockToken()).toBeUndefined();
    });
  });

  describe('パス正規化（バグ 2）', () => {
    test('先頭スラッシュ付き notebook_path は正規化済みパスで acquire される', async () => {
      const execute = vi.fn(async () => okResult);

      await withNotebookLock({ notebook_path: '/workspaces/sample/ws-001/test.ipynb' }, execute);

      expect(mockAcquire).toHaveBeenCalledWith('workspaces/sample/ws-001/test.ipynb');
      expect(mockRelease).toHaveBeenCalledWith('workspaces/sample/ws-001/test.ipynb', LOCK_TOKEN);
    });

    test('正規化が失敗するパス（.ipynb 以外）はロックせず execute する', async () => {
      const execute = vi.fn(async () => okResult);

      const result = await withNotebookLock({ notebook_path: '/workspaces/sample/ws-001/data.csv' }, execute);

      expect(result).toBe(okResult);
      expect(mockAcquire).not.toHaveBeenCalled();
      expect(execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('notebook_path を解決できない場合', () => {
    test('ロックを取得せずにツールを実行する', async () => {
      const execute = vi.fn(async () => okResult);

      // notebook_path も session_id もない
      const result = await withNotebookLock({}, execute);

      expect(result).toBe(okResult);
      expect(mockAcquire).not.toHaveBeenCalled();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(mockRelease).not.toHaveBeenCalled();
    });
  });

  describe('renew タイマー', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('実行中に定期的に renew が呼ばれる', async () => {
      // execute を手動制御可能な Promise にする
      let resolveExecute: (v: typeof okResult) => void = () => {};
      const executePromise = new Promise<typeof okResult>((r) => {
        resolveExecute = r;
      });
      const execute = vi.fn(() => executePromise);

      const lockPromise = withNotebookLock({ notebook_path: NOTEBOOK_PATH }, execute);

      // acquire を解決してタイマーが張られるのを待つ
      await vi.advanceTimersByTimeAsync(0);

      // renew タイマー間隔（20 秒）を 2 回進める
      await vi.advanceTimersByTimeAsync(20000);
      await vi.advanceTimersByTimeAsync(20000);

      expect(mockRenew).toHaveBeenCalled();
      expect(mockRenew.mock.calls.length).toBeGreaterThanOrEqual(2);

      // execute を完了させて後処理
      resolveExecute(okResult);
      await lockPromise;
    });

    test('ツール完了後は renew タイマーが解除され追加で呼ばれない', async () => {
      const execute = vi.fn(async () => okResult);

      await withNotebookLock({ notebook_path: NOTEBOOK_PATH }, execute);

      const callsAfterCompletion = mockRenew.mock.calls.length;

      // 完了後にタイマーを大きく進めても renew は増えない
      await vi.advanceTimersByTimeAsync(60000);

      expect(mockRenew.mock.calls.length).toBe(callsAfterCompletion);
    });
  });
});
