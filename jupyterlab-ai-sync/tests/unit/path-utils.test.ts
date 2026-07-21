import { describe, test, expect } from 'vitest';
import { normalizeNotebookPath } from '../../src/path-utils';

describe('normalizeNotebookPath', () => {
  describe('正常系', () => {
    test('通常のパス path/to/nb.ipynb => そのまま返す', () => {
      const result = normalizeNotebookPath('path/to/nb.ipynb');
      expect(result).toBe('path/to/nb.ipynb');
    });

    test('先頭スラッシュ /path/to/nb.ipynb => スラッシュを除去', () => {
      const result = normalizeNotebookPath('/path/to/nb.ipynb');
      expect(result).toBe('path/to/nb.ipynb');
    });
  });

  describe('エッジケース', () => {
    test('先頭スラッシュ複数 //path/to/nb.ipynb => 1 つだけ除去して /path/to/nb.ipynb', () => {
      const result = normalizeNotebookPath('//path/to/nb.ipynb');
      expect(result).toBe('/path/to/nb.ipynb');
    });

    test('空文字列 => 空文字列のまま', () => {
      const result = normalizeNotebookPath('');
      expect(result).toBe('');
    });

    test('スラッシュのみ / => 空文字列', () => {
      const result = normalizeNotebookPath('/');
      expect(result).toBe('');
    });
  });
});
