import { describe, test, expect, vi, beforeEach } from 'vitest';
import { getEffectiveCellCount, setCellCount, resetCellTracker } from '../../../src/utils/notebook-cell-tracker.js';

const mockGetContentsWithTimeout = vi.fn();
vi.mock('../../../src/utils/notebook-helpers.js', () => ({
  getContentsWithTimeout: (...args: unknown[]) => mockGetContentsWithTimeout(...args),
}));

describe('notebook-cell-tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCellTracker();
  });

  describe('getEffectiveCellCount', () => {
    test('ディスク上のセル数のみ => ディスクの値を返す', async () => {
      mockGetContentsWithTimeout.mockResolvedValue({
        path: 'test.ipynb',
        type: 'notebook',
        content: {
          cells: [
            { cell_type: 'code', source: 'a' },
            { cell_type: 'code', source: 'b' },
          ],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      });

      const count = await getEffectiveCellCount('test.ipynb');
      expect(count).toBe(2);
    });

    test('メモリ上の値がディスクより大きい => メモリの値を返す', async () => {
      mockGetContentsWithTimeout.mockResolvedValue({
        path: 'test.ipynb',
        type: 'notebook',
        content: {
          cells: [{ cell_type: 'code', source: 'a' }],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      });

      setCellCount('test.ipynb', 5);

      const count = await getEffectiveCellCount('test.ipynb');
      expect(count).toBe(5);
    });

    test('ディスク読み取り失敗 => メモリの値を返す', async () => {
      mockGetContentsWithTimeout.mockRejectedValue(new Error('read error'));

      setCellCount('test.ipynb', 3);

      const count = await getEffectiveCellCount('test.ipynb');
      expect(count).toBe(3);
    });

    test('ディスク読み取り失敗かつメモリなし => 0を返す', async () => {
      mockGetContentsWithTimeout.mockRejectedValue(new Error('read error'));

      const count = await getEffectiveCellCount('test.ipynb');
      expect(count).toBe(0);
    });
  });

  describe('setCellCount', () => {
    test('セル数が設定される', async () => {
      mockGetContentsWithTimeout.mockRejectedValue(new Error('read error'));

      setCellCount('test.ipynb', 1);
      expect(await getEffectiveCellCount('test.ipynb')).toBe(1);

      setCellCount('test.ipynb', 2);
      expect(await getEffectiveCellCount('test.ipynb')).toBe(2);
    });

    test('ノートブックごとに独立して追跡される', async () => {
      mockGetContentsWithTimeout.mockRejectedValue(new Error('read error'));

      setCellCount('a.ipynb', 3);
      setCellCount('b.ipynb', 7);

      expect(await getEffectiveCellCount('a.ipynb')).toBe(3);
      expect(await getEffectiveCellCount('b.ipynb')).toBe(7);
    });
  });

  describe('resetCellTracker', () => {
    test('リセット後はメモリの値がクリアされる', async () => {
      mockGetContentsWithTimeout.mockRejectedValue(new Error('read error'));

      setCellCount('test.ipynb', 5);
      resetCellTracker();

      expect(await getEffectiveCellCount('test.ipynb')).toBe(0);
    });
  });
});
