import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// JupyterLab・内部モジュールの DOM 依存をモック
vi.mock('@jupyterlab/notebook', () => ({
  INotebookTracker: Symbol('INotebookTracker'),
}));
vi.mock('@jupyterlab/cells', () => ({}));
vi.mock('@jupyter/ydoc', () => ({}));
vi.mock('@jupyterlab/docmanager', () => ({}));
vi.mock('@jupyterlab/services', () => ({
  ServerConnection: {
    makeSettings: () => ({ baseUrl: 'http://localhost:8888/' }),
    makeRequest: vi.fn(),
  },
}));
vi.mock('@jupyterlab/coreutils', () => ({
  URLExt: { join: (...parts: string[]) => parts.join('/') },
}));
// lock-manager.ts が LockIndicator (Widget 継承) を import するため、
// DOM 不要なテスト環境向けにモックして @lumino/dragdrop の DragEvent 依存を回避する
vi.mock('../../src/ui/lock-indicator', () => ({
  LockIndicator: class {},
}));
vi.mock('../../src/notebook-finder', () => ({
  findNotebookByPath: vi.fn(),
}));
vi.mock('../../src/path-utils', () => ({
  normalizeNotebookPath: vi.fn((path: string) => path),
}));

import { NotebookUpdater } from '../../src/notebook-updater';
import { findNotebookByPath } from '../../src/notebook-finder';

/** テスト用のモックノートブックパネルを作成 */
function createMockPanel(path: string) {
  return {
    context: { model: { dirty: false }, path },
    content: {
      model: { dirty: false },
      widgets: [
        {
          model: { type: 'code', executionCount: null, trusted: false },
          outputArea: { model: { clear: vi.fn() } },
        },
      ],
      activeCellIndex: 0,
      scrollToItem: vi.fn(),
    },
  };
}

describe('NotebookUpdater タイマー管理・dispose', () => {
  let updater: NotebookUpdater;
  let mockRevert: ReturnType<typeof vi.fn>;
  let mockDocManager: { contextForWidget: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    // node 環境では window が未定義のため、window.setTimeout / clearTimeout を使うソースコードのためにスタブ
    vi.stubGlobal('window', globalThis);

    mockRevert = vi.fn().mockResolvedValue(undefined);
    mockDocManager = {
      contextForWidget: vi.fn().mockReturnValue({ revert: mockRevert }),
    };

    updater = new NotebookUpdater({} as any, mockDocManager as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('cancelPendingRevert(path) が該当パスのタイマーを clearTimeout する', () => {
    // Arrange: notebook_changed で revert タイマーを作成
    const mockPanel = createMockPanel('/work/test.ipynb');
    vi.mocked(findNotebookByPath).mockReturnValue(mockPanel as any);

    updater.handleEvent({
      type: 'notebook_changed',
      notebook_path: '/work/test.ipynb',
      seq: 1,
    });

    // Act: pending revert をキャンセル
    updater.cancelPendingRevert('/work/test.ipynb');

    // Assert: タイマーを進めても revert が発火しない
    vi.advanceTimersByTime(500);
    expect(mockRevert).not.toHaveBeenCalled();
  });

  test('cancelPendingRevert で存在しないパスを指定してもエラーにならない', () => {
    // Act & Assert
    expect(() => {
      updater.cancelPendingRevert('/work/nonexistent.ipynb');
    }).not.toThrow();
  });

  test('dispose() が全タイマーをクリアし Map を空にする', () => {
    // Arrange: 複数パスの revert タイマーを作成
    const mockPanel1 = createMockPanel('/work/test1.ipynb');
    const mockPanel2 = createMockPanel('/work/test2.ipynb');
    vi.mocked(findNotebookByPath).mockImplementation((_tracker: any, path: string) => {
      if (path === '/work/test1.ipynb') return mockPanel1 as any;
      if (path === '/work/test2.ipynb') return mockPanel2 as any;
      return null;
    });

    updater.handleEvent({
      type: 'notebook_changed',
      notebook_path: '/work/test1.ipynb',
      seq: 1,
    });
    updater.handleEvent({
      type: 'notebook_changed',
      notebook_path: '/work/test2.ipynb',
      seq: 1,
    });

    // Act
    updater.dispose();

    // Assert: タイマーを進めても revert が発火しない
    vi.advanceTimersByTime(500);
    expect(mockRevert).not.toHaveBeenCalled();
  });

  test('cell_execute_start 処理で pending revert タイマーが取り消される', () => {
    // Arrange: notebook_changed で revert タイマーを作成
    const mockPanel = createMockPanel('/work/test.ipynb');
    vi.mocked(findNotebookByPath).mockReturnValue(mockPanel as any);

    updater.handleEvent({
      type: 'notebook_changed',
      notebook_path: '/work/test.ipynb',
      seq: 1,
    });

    // Act: cell_execute_start で ephemeral 更新（新実装では revert をキャンセルする）
    updater.handleEvent({
      type: 'cell_execute_start',
      notebook_path: '/work/test.ipynb',
      cell_index: 0,
    });

    // Assert: タイマーを進めても revert が発火しない
    vi.advanceTimersByTime(500);
    expect(mockRevert).not.toHaveBeenCalled();
  });

  test('パネルが閉じられたノートブックの revert はスキップされる', () => {
    // Arrange: notebook_changed 時はパネルが開いている
    const mockPanel = createMockPanel('/work/test.ipynb');
    vi.mocked(findNotebookByPath).mockReturnValue(mockPanel as any);

    updater.handleEvent({
      type: 'notebook_changed',
      notebook_path: '/work/test.ipynb',
      seq: 1,
    });

    // パネルが閉じられた（findNotebookByPath が null を返す状態）
    vi.mocked(findNotebookByPath).mockReturnValue(null);

    // Act: タイマーを進めて revert を発火させる
    vi.advanceTimersByTime(500);

    // Assert: パネルが見つからないため contextForWidget が呼ばれない
    expect(mockDocManager.contextForWidget).not.toHaveBeenCalled();
  });
});
