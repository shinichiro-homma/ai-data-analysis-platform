import { describe, test, expect, beforeEach } from 'vitest';
import { sessionNotebookStore } from '../../../src/utils/session-notebook-store.js';

describe('sessionNotebookStore', () => {
  beforeEach(() => {
    sessionNotebookStore.clear();
  });

  describe('set / get', () => {
    test('保存した紐付けを取得できる', () => {
      sessionNotebookStore.set('session-123', 'workspaces/ws-abc/test.ipynb');
      expect(sessionNotebookStore.get('session-123')).toBe('workspaces/ws-abc/test.ipynb');
    });

    test('存在しないIDはnullを返す', () => {
      expect(sessionNotebookStore.get('nonexistent')).toBeNull();
    });

    test('同じIDで上書きできる', () => {
      sessionNotebookStore.set('session-123', 'workspaces/ws-abc/old.ipynb');
      sessionNotebookStore.set('session-123', 'workspaces/ws-abc/new.ipynb');
      expect(sessionNotebookStore.get('session-123')).toBe('workspaces/ws-abc/new.ipynb');
    });

    test('複数のIDを保存できる', () => {
      sessionNotebookStore.set('session-123', 'workspaces/ws-abc/a.ipynb');
      sessionNotebookStore.set('kernel-456', 'workspaces/ws-abc/a.ipynb');
      expect(sessionNotebookStore.get('session-123')).toBe('workspaces/ws-abc/a.ipynb');
      expect(sessionNotebookStore.get('kernel-456')).toBe('workspaces/ws-abc/a.ipynb');
    });
  });

  describe('delete', () => {
    test('紐付けを削除できる', () => {
      sessionNotebookStore.set('session-123', 'workspaces/ws-abc/test.ipynb');
      sessionNotebookStore.delete('session-123');
      expect(sessionNotebookStore.get('session-123')).toBeNull();
    });

    test('存在しないIDの削除はエラーにならない', () => {
      expect(() => sessionNotebookStore.delete('nonexistent')).not.toThrow();
    });
  });

  describe('clear', () => {
    test('全紐付けをクリアできる', () => {
      sessionNotebookStore.set('session-123', 'workspaces/ws-abc/a.ipynb');
      sessionNotebookStore.set('kernel-456', 'workspaces/ws-abc/b.ipynb');
      sessionNotebookStore.clear();
      expect(sessionNotebookStore.get('session-123')).toBeNull();
      expect(sessionNotebookStore.get('kernel-456')).toBeNull();
    });
  });
});
