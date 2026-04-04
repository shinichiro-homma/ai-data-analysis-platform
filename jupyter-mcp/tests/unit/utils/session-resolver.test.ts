import { describe, test, expect, vi, beforeEach } from 'vitest';
import { resolveNotebookPath, resolveKernelId } from '../../../src/utils/session-resolver.js';
import { sessionNotebookStore } from '../../../src/utils/session-notebook-store.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    listSessions: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('resolveNotebookPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionNotebookStore.clear();
  });

  test('session.id で見つかる場合 => session.path を返す', async () => {
    vi.mocked(jupyterClient.listSessions).mockResolvedValue([
      {
        id: 'session-abc',
        path: 'workspaces/ws-123/test.ipynb',
        name: 'test.ipynb',
        type: 'notebook',
        kernel: { id: 'kernel-xyz', name: 'python3', status: 'idle' },
      },
    ]);

    const result = await resolveNotebookPath('session-abc');
    expect(result).toBe('workspaces/ws-123/test.ipynb');
  });

  test('session.kernel.id で見つかる場合 => session.path を返す（修正A）', async () => {
    vi.mocked(jupyterClient.listSessions).mockResolvedValue([
      {
        id: 'session-abc',
        path: 'workspaces/ws-123/test.ipynb',
        name: 'test.ipynb',
        type: 'notebook',
        kernel: { id: 'kernel-xyz', name: 'python3', status: 'idle' },
      },
    ]);

    const result = await resolveNotebookPath('kernel-xyz');
    expect(result).toBe('workspaces/ws-123/test.ipynb');
  });

  test('セッション一覧に存在しないがストアにある場合 => ストアの値を返す（修正C）', async () => {
    vi.mocked(jupyterClient.listSessions).mockResolvedValue([]);
    sessionNotebookStore.set('kernel-only-123', 'workspaces/ws-abc/notebook.ipynb');

    const result = await resolveNotebookPath('kernel-only-123');
    expect(result).toBe('workspaces/ws-abc/notebook.ipynb');
  });

  test('セッション一覧にもストアにもない場合 => null を返す', async () => {
    vi.mocked(jupyterClient.listSessions).mockResolvedValue([]);

    const result = await resolveNotebookPath('nonexistent');
    expect(result).toBeNull();
  });

  test('listSessions が失敗した場合 => ストアにフォールバック', async () => {
    vi.mocked(jupyterClient.listSessions).mockRejectedValue(new Error('Connection refused'));
    sessionNotebookStore.set('kernel-123', 'workspaces/ws-abc/fallback.ipynb');

    const result = await resolveNotebookPath('kernel-123');
    expect(result).toBe('workspaces/ws-abc/fallback.ipynb');
  });

  test('listSessions が失敗しストアにもない場合 => null を返す', async () => {
    vi.mocked(jupyterClient.listSessions).mockRejectedValue(new Error('Connection refused'));

    const result = await resolveNotebookPath('nonexistent');
    expect(result).toBeNull();
  });

  test('フォールバック優先順位: session.id > kernel.id > ストア', async () => {
    vi.mocked(jupyterClient.listSessions).mockResolvedValue([
      {
        id: 'session-abc',
        path: 'workspaces/ws-123/from-session.ipynb',
        name: 'from-session.ipynb',
        type: 'notebook',
        kernel: { id: 'kernel-xyz', name: 'python3', status: 'idle' },
      },
    ]);
    sessionNotebookStore.set('session-abc', 'workspaces/ws-123/from-store.ipynb');

    // session.id で見つかる → ストアよりも優先
    const result = await resolveNotebookPath('session-abc');
    expect(result).toBe('workspaces/ws-123/from-session.ipynb');
  });
});

describe('resolveKernelId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('session.id で見つかる場合 => session.kernel.id を返す', async () => {
    vi.mocked(jupyterClient.listSessions).mockResolvedValue([
      {
        id: 'session-abc',
        path: 'test.ipynb',
        name: 'test.ipynb',
        type: 'notebook',
        kernel: { id: 'kernel-xyz', name: 'python3', status: 'idle' },
      },
    ]);

    const result = await resolveKernelId('session-abc');
    expect(result).toBe('kernel-xyz');
  });

  test('セッション一覧に存在しない場合 => sessionId をそのまま返す', async () => {
    vi.mocked(jupyterClient.listSessions).mockResolvedValue([]);

    const result = await resolveKernelId('kernel-as-session');
    expect(result).toBe('kernel-as-session');
  });

  test('listSessions が失敗した場合 => sessionId をそのまま返す', async () => {
    vi.mocked(jupyterClient.listSessions).mockRejectedValue(new Error('Connection refused'));

    const result = await resolveKernelId('kernel-123');
    expect(result).toBe('kernel-123');
  });
});
