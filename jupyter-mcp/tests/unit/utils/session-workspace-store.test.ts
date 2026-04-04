import { describe, test, expect, beforeEach } from 'vitest';
import { sessionWorkspaceStore } from '../../../src/utils/session-workspace-store.js';

describe('sessionWorkspaceStore', () => {
  beforeEach(() => {
    sessionWorkspaceStore.clear();
  });

  describe('set / get', () => {
    test('保存した紐付けを取得できる', () => {
      sessionWorkspaceStore.set('session-123', 'ws-abc123');
      expect(sessionWorkspaceStore.get('session-123')).toBe('ws-abc123');
    });

    test('存在しないIDはnullを返す', () => {
      expect(sessionWorkspaceStore.get('nonexistent')).toBeNull();
    });

    test('同じIDで上書きできる', () => {
      sessionWorkspaceStore.set('session-123', 'ws-old');
      sessionWorkspaceStore.set('session-123', 'ws-new');
      expect(sessionWorkspaceStore.get('session-123')).toBe('ws-new');
    });

    test('複数のIDを保存できる', () => {
      sessionWorkspaceStore.set('session-123', 'ws-abc123');
      sessionWorkspaceStore.set('kernel-456', 'ws-abc123');
      expect(sessionWorkspaceStore.get('session-123')).toBe('ws-abc123');
      expect(sessionWorkspaceStore.get('kernel-456')).toBe('ws-abc123');
    });
  });

  describe('delete', () => {
    test('紐付けを削除できる', () => {
      sessionWorkspaceStore.set('session-123', 'ws-abc123');
      sessionWorkspaceStore.delete('session-123');
      expect(sessionWorkspaceStore.get('session-123')).toBeNull();
    });

    test('存在しないIDの削除はエラーにならない', () => {
      expect(() => sessionWorkspaceStore.delete('nonexistent')).not.toThrow();
    });
  });

  describe('clear', () => {
    test('全紐付けをクリアできる', () => {
      sessionWorkspaceStore.set('session-123', 'ws-abc');
      sessionWorkspaceStore.set('kernel-456', 'ws-def');
      sessionWorkspaceStore.clear();
      expect(sessionWorkspaceStore.get('session-123')).toBeNull();
      expect(sessionWorkspaceStore.get('kernel-456')).toBeNull();
    });
  });
});
