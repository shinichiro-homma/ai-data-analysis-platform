import { describe, test, expect } from 'vitest';
import { INotebookTracker } from '@jupyterlab/notebook';
import { findNotebookByPath } from '../../src/notebook-finder';

/**
 * INotebookTracker の最小スタブを生成する
 */
function createTrackerStub(options: { currentWidgetPath?: string; otherWidgetPaths?: string[] }): INotebookTracker {
  const { currentWidgetPath, otherWidgetPaths = [] } = options;

  const currentWidget = currentWidgetPath ? { context: { path: currentWidgetPath } } : null;

  const otherWidgets = otherWidgetPaths.map((p) => ({
    context: { path: p },
  }));

  return {
    currentWidget,
    find: (fn: (w: { context: { path: string } }) => boolean) => {
      return otherWidgets.find(fn) || null;
    },
  } as unknown as INotebookTracker;
}

describe('findNotebookByPath', () => {
  describe('完全一致', () => {
    test('currentWidget のパスが完全一致 => currentWidget を返す', () => {
      const tracker = createTrackerStub({
        currentWidgetPath: 'path/to/nb.ipynb',
      });

      const result = findNotebookByPath(tracker, 'path/to/nb.ipynb');

      expect(result).not.toBeNull();
      expect(result!.context.path).toBe('path/to/nb.ipynb');
    });

    test('currentWidget 不一致・find() が一致 => 該当ウィジェットを返す', () => {
      const tracker = createTrackerStub({
        currentWidgetPath: 'other/nb.ipynb',
        otherWidgetPaths: ['path/to/nb.ipynb'],
      });

      const result = findNotebookByPath(tracker, 'path/to/nb.ipynb');

      expect(result).not.toBeNull();
      expect(result!.context.path).toBe('path/to/nb.ipynb');
    });

    test('先頭スラッシュ付きの検索パスが正規化されて一致する', () => {
      const tracker = createTrackerStub({
        currentWidgetPath: 'path/to/nb.ipynb',
      });

      const result = findNotebookByPath(tracker, '/path/to/nb.ipynb');

      expect(result).not.toBeNull();
      expect(result!.context.path).toBe('path/to/nb.ipynb');
    });
  });

  describe('サフィックス一致', () => {
    test('currentWidget: workspaces/ws-1/nb.ipynb に対し nb.ipynb で検索 => currentWidget を返す', () => {
      const tracker = createTrackerStub({
        currentWidgetPath: 'workspaces/ws-1/nb.ipynb',
      });

      const result = findNotebookByPath(tracker, 'nb.ipynb');

      expect(result).not.toBeNull();
      expect(result!.context.path).toBe('workspaces/ws-1/nb.ipynb');
    });

    test('find(): workspaces/ws-1/nb.ipynb に対し nb.ipynb で検索 => 該当ウィジェットを返す', () => {
      const tracker = createTrackerStub({
        currentWidgetPath: 'unrelated.ipynb',
        otherWidgetPaths: ['workspaces/ws-1/nb.ipynb'],
      });

      const result = findNotebookByPath(tracker, 'nb.ipynb');

      expect(result).not.toBeNull();
      expect(result!.context.path).toBe('workspaces/ws-1/nb.ipynb');
    });
  });

  describe('異常系', () => {
    test('どこにも一致しない => null を返す', () => {
      const tracker = createTrackerStub({
        currentWidgetPath: 'other/nb.ipynb',
        otherWidgetPaths: ['another/nb.ipynb'],
      });

      const result = findNotebookByPath(tracker, 'nonexistent.ipynb');

      expect(result).toBeNull();
    });

    test('サフィックス境界: b.ipynb で検索しても workspaces/ws-1/nb.ipynb に一致しない', () => {
      const tracker = createTrackerStub({
        currentWidgetPath: 'workspaces/ws-1/nb.ipynb',
      });

      const result = findNotebookByPath(tracker, 'b.ipynb');

      expect(result).toBeNull();
    });
  });
});
