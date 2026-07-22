import { describe, test, expect } from 'vitest';
import {
  NotebookChangedEventSchema,
  CellExecuteStartEventSchema,
  CellExecuteEndEventSchema,
  LockAcquiredEventSchema,
  LockReleasedEventSchema,
  SyncStateResponseSchema,
} from '../../src/notebook-updater';

describe('イベント検証スキーマ', () => {
  describe('notebook_changed', () => {
    test('有効な notebook_changed イベントを受理する', () => {
      // Arrange
      const event = {
        type: 'notebook_changed',
        notebook_path: '/work/test.ipynb',
        seq: 1,
      };

      // Act
      const result = NotebookChangedEventSchema.safeParse(event);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('notebook_changed');
        expect(result.data.notebook_path).toBe('/work/test.ipynb');
        expect(result.data.seq).toBe(1);
      }
    });

    test('notebook_changed の seq 欠落を拒否する', () => {
      // Arrange
      const event = {
        type: 'notebook_changed',
        notebook_path: '/work/test.ipynb',
      };

      // Act
      const result = NotebookChangedEventSchema.safeParse(event);

      // Assert
      expect(result.success).toBe(false);
    });

    test('notebook_changed の seq が文字列のとき拒否する', () => {
      // Arrange
      const event = {
        type: 'notebook_changed',
        notebook_path: '/work/test.ipynb',
        seq: '1',
      };

      // Act
      const result = NotebookChangedEventSchema.safeParse(event);

      // Assert
      expect(result.success).toBe(false);
    });
  });

  describe('cell_execute_start', () => {
    test('有効な cell_execute_start イベントを受理する', () => {
      // Arrange
      const event = {
        type: 'cell_execute_start',
        notebook_path: '/work/test.ipynb',
        cell_index: 0,
      };

      // Act
      const result = CellExecuteStartEventSchema.safeParse(event);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('cell_execute_start');
        expect(result.data.notebook_path).toBe('/work/test.ipynb');
        expect(result.data.cell_index).toBe(0);
      }
    });

    test('cell_execute_start の cell_index 欠落を拒否する', () => {
      // Arrange
      const event = {
        type: 'cell_execute_start',
        notebook_path: '/work/test.ipynb',
      };

      // Act
      const result = CellExecuteStartEventSchema.safeParse(event);

      // Assert
      expect(result.success).toBe(false);
    });
  });

  describe('cell_execute_end', () => {
    test('有効な cell_execute_end イベントを受理する', () => {
      // Arrange
      const event = {
        type: 'cell_execute_end',
        notebook_path: '/work/test.ipynb',
        cell_index: 2,
        execution_count: 5,
        success: true,
      };

      // Act
      const result = CellExecuteEndEventSchema.safeParse(event);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('cell_execute_end');
        expect(result.data.notebook_path).toBe('/work/test.ipynb');
        expect(result.data.cell_index).toBe(2);
        expect(result.data.execution_count).toBe(5);
        expect(result.data.success).toBe(true);
      }
    });

    test('cell_execute_end の execution_count が文字列のとき拒否する', () => {
      // Arrange
      const event = {
        type: 'cell_execute_end',
        notebook_path: '/work/test.ipynb',
        cell_index: 2,
        execution_count: '5',
        success: true,
      };

      // Act
      const result = CellExecuteEndEventSchema.safeParse(event);

      // Assert
      expect(result.success).toBe(false);
    });
  });

  describe('lock_acquired', () => {
    test('有効な lock_acquired イベントを受理する', () => {
      // Arrange
      const event = {
        type: 'lock_acquired',
        notebook_path: '/work/test.ipynb',
      };

      // Act
      const result = LockAcquiredEventSchema.safeParse(event);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('lock_acquired');
        expect(result.data.notebook_path).toBe('/work/test.ipynb');
      }
    });
  });

  describe('lock_released', () => {
    test('有効な lock_released イベントを受理する', () => {
      // Arrange
      const event = {
        type: 'lock_released',
        notebook_path: '/work/test.ipynb',
      };

      // Act
      const result = LockReleasedEventSchema.safeParse(event);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('lock_released');
        expect(result.data.notebook_path).toBe('/work/test.ipynb');
      }
    });
  });

  describe('共通バリデーション', () => {
    test('notebook_path 欠落のイベントを拒否する', () => {
      // Arrange
      const event = {
        type: 'notebook_changed',
        seq: 1,
      };

      // Act
      const result = NotebookChangedEventSchema.safeParse(event);

      // Assert
      expect(result.success).toBe(false);
    });
  });

  describe('SyncStateResponse', () => {
    test('有効な SyncStateResponse を受理する', () => {
      // Arrange
      const response = {
        notebooks: { '/work/test.ipynb': 3 },
        locks: [
          {
            notebook_path: '/work/test.ipynb',
            expires_at: 1700000000,
          },
        ],
      };

      // Act
      const result = SyncStateResponseSchema.safeParse(response);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notebooks).toEqual({ '/work/test.ipynb': 3 });
        expect(result.data.locks).toHaveLength(1);
        expect(result.data.locks[0].notebook_path).toBe('/work/test.ipynb');
        expect(result.data.locks[0].expires_at).toBe(1700000000);
      }
    });

    test('SyncStateResponse の locks が不正な構造のとき拒否する', () => {
      // Arrange
      const response = {
        notebooks: { '/work/test.ipynb': 3 },
        locks: 'not-an-array',
      };

      // Act
      const result = SyncStateResponseSchema.safeParse(response);

      // Assert
      expect(result.success).toBe(false);
    });
  });

  describe('未知のイベント', () => {
    test('未知の type のイベントが渡されても例外を投げない', () => {
      // Arrange
      const event = {
        type: 'unknown_event_type',
        notebook_path: '/work/test.ipynb',
      };

      // Act & Assert - 各スキーマの safeParse は例外を投げずに結果を返す
      expect(() => NotebookChangedEventSchema.safeParse(event)).not.toThrow();
      expect(() => CellExecuteStartEventSchema.safeParse(event)).not.toThrow();
      expect(() => CellExecuteEndEventSchema.safeParse(event)).not.toThrow();
      expect(() => LockAcquiredEventSchema.safeParse(event)).not.toThrow();
      expect(() => LockReleasedEventSchema.safeParse(event)).not.toThrow();
    });
  });
});
