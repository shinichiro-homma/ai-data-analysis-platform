import { describe, test, expect } from 'vitest';
import { normalizePath, normalizeNotebookPath, validateNotebookPath } from '../../../src/utils/path-validator.js';
import { ValidationError } from '../../../src/utils/errors.js';

describe('normalizePath', () => {
  describe('正常系', () => {
    test('通常のパス => 正規化されたパス', () => {
      const result = normalizePath('path/to/file.ipynb');
      expect(result).toBe('path/to/file.ipynb');
    });

    test('先頭にスラッシュ => スラッシュを除去', () => {
      const result = normalizePath('/path/to/file.ipynb');
      expect(result).toBe('path/to/file.ipynb');
    });

    test('複数のスラッシュ => 全て除去', () => {
      const result = normalizePath('///path/to/file.ipynb');
      expect(result).toBe('path/to/file.ipynb');
    });
  });

  describe('空パスの処理', () => {
    test('空文字列（allowEmpty: false） => エラー', () => {
      expect(() => normalizePath('')).toThrow(ValidationError);
      expect(() => normalizePath('')).toThrow('パスが空です');
    });

    test('空文字列（allowEmpty: true） => "/"', () => {
      const result = normalizePath('', { allowEmpty: true });
      expect(result).toBe('/');
    });

    test('空文字列（allowRoot: true） => "/"', () => {
      const result = normalizePath('', { allowRoot: true });
      expect(result).toBe('/');
    });

    test('スラッシュのみ（allowRoot: false） => エラー', () => {
      expect(() => normalizePath('/')).toThrow(ValidationError);
      expect(() => normalizePath('/')).toThrow('パスが空です');
    });

    test('スラッシュのみ（allowRoot: true） => "/"', () => {
      const result = normalizePath('/', { allowRoot: true });
      expect(result).toBe('/');
    });

    test('空白のみ => エラー', () => {
      expect(() => normalizePath('   ')).toThrow(ValidationError);
    });
  });

  describe('セキュリティチェック', () => {
    test('パストラバーサル（..を含む） => エラー', () => {
      expect(() => normalizePath('../etc/passwd')).toThrow(ValidationError);
      expect(() => normalizePath('../etc/passwd')).toThrow("パスに '..' を含めることはできません");
    });

    test('パストラバーサル（中間に..） => エラー', () => {
      expect(() => normalizePath('path/../file.ipynb')).toThrow(ValidationError);
    });

    test('NULLバイト => エラー', () => {
      expect(() => normalizePath('path\0file.ipynb')).toThrow(ValidationError);
      expect(() => normalizePath('path\0file.ipynb')).toThrow('パスに不正な文字が含まれています');
    });

    test('長すぎるパス（デフォルト500文字超） => エラー', () => {
      const longPath = 'a'.repeat(501);
      expect(() => normalizePath(longPath)).toThrow(ValidationError);
      expect(() => normalizePath(longPath)).toThrow('パスが長すぎます（最大500文字）');
    });

    test('カスタム最大長を超える => エラー', () => {
      const longPath = 'a'.repeat(101);
      expect(() => normalizePath(longPath, { maxLength: 100 })).toThrow(ValidationError);
    });
  });
});

describe('normalizeNotebookPath', () => {
  test('通常のパス => 正規化されたパス', () => {
    const result = normalizeNotebookPath('notebooks/test.ipynb');
    expect(result).toBe('notebooks/test.ipynb');
  });

  test('先頭にスラッシュ => スラッシュを除去', () => {
    const result = normalizeNotebookPath('/notebooks/test.ipynb');
    expect(result).toBe('notebooks/test.ipynb');
  });

  test('空文字列 => エラー', () => {
    expect(() => normalizeNotebookPath('')).toThrow(ValidationError);
  });

  test('パストラバーサル => エラー', () => {
    expect(() => normalizeNotebookPath('../test.ipynb')).toThrow(ValidationError);
  });
});

describe('validateNotebookPath (deprecated)', () => {
  describe('正常系', () => {
    test('有効なノートブックパス => エラーなし', () => {
      expect(() => validateNotebookPath('notebook.ipynb')).not.toThrow();
    });

    test('サブディレクトリのパス => エラーなし', () => {
      expect(() => validateNotebookPath('path/to/notebook.ipynb')).not.toThrow();
    });
  });

  describe('異常系', () => {
    test('空文字列 => エラー', () => {
      expect(() => validateNotebookPath('')).toThrow('パスが空です');
    });

    test('空白のみ => エラー', () => {
      expect(() => validateNotebookPath('   ')).toThrow('パスが空です');
    });

    test('パストラバーサル => エラー', () => {
      expect(() => validateNotebookPath('../notebook.ipynb')).toThrow("パスに '..' を含めることはできません");
    });

    test('絶対パス => エラー', () => {
      expect(() => validateNotebookPath('/notebook.ipynb')).toThrow('絶対パスは使用できません');
    });

    test('NULLバイト => エラー', () => {
      expect(() => validateNotebookPath('test\0.ipynb')).toThrow('パスに不正な文字が含まれています');
    });

    test('.ipynb拡張子がない => エラー', () => {
      expect(() => validateNotebookPath('notebook.txt')).toThrow("ノートブックパスは '.ipynb' で終わる必要があります");
    });

    test('長すぎるパス（255文字超） => エラー', () => {
      const longPath = 'a'.repeat(256) + '.ipynb';
      expect(() => validateNotebookPath(longPath)).toThrow('パスが長すぎます（最大255文字）');
    });
  });
});
