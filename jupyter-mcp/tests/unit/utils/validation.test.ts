import { describe, test, expect } from 'vitest';
import { validateStringParameter } from '../../../src/utils/validation.js';

describe('validateStringParameter', () => {
  describe('基本的なバリデーション', () => {
    test('有効な文字列 => isValid: true', () => {
      const result = validateStringParameter('valid-string', 'test');
      expect(result.isValid).toBe(true);
      expect(result.errorMessage).toBeUndefined();
    });

    test('空文字列（デフォルト設定） => isValid: false', () => {
      const result = validateStringParameter('', 'test');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('test パラメータが空です');
    });

    test('空白のみの文字列 => isValid: false', () => {
      const result = validateStringParameter('   ', 'test');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('test パラメータが空です');
    });
  });

  describe('required オプション', () => {
    test('必須フィールドが未指定 => isValid: false', () => {
      const result = validateStringParameter(undefined, 'test', { required: true });
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('test パラメータは必須です');
    });

    test('必須フィールドに null => isValid: false', () => {
      const result = validateStringParameter(null, 'test', { required: true });
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('test パラメータは必須です');
    });

    test('必須でないフィールドが未指定 => isValid: true', () => {
      const result = validateStringParameter(undefined, 'test', { required: false });
      expect(result.isValid).toBe(true);
    });
  });

  describe('allowNull オプション', () => {
    test('allowNull: false で null => isValid: false', () => {
      const result = validateStringParameter(null, 'test', { allowNull: false });
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('test パラメータが不正です');
    });

    test('allowNull: true で null => isValid: true', () => {
      const result = validateStringParameter(null, 'test', { allowNull: true });
      expect(result.isValid).toBe(true);
    });
  });

  describe('allowEmpty オプション', () => {
    test('allowEmpty: true で空文字列 => isValid: true', () => {
      const result = validateStringParameter('', 'test', { allowEmpty: true });
      expect(result.isValid).toBe(true);
    });

    test('allowEmpty: false で空文字列 => isValid: false', () => {
      const result = validateStringParameter('', 'test', { allowEmpty: false });
      expect(result.isValid).toBe(false);
    });
  });

  describe('maxLength オプション', () => {
    test('長さが制限内 => isValid: true', () => {
      const result = validateStringParameter('short', 'test', { maxLength: 10 });
      expect(result.isValid).toBe(true);
    });

    test('長さが制限を超える => isValid: false', () => {
      const longString = 'a'.repeat(101);
      const result = validateStringParameter(longString, 'test', { maxLength: 100 });
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('test が長すぎます（最大100文字）');
    });

    test('デフォルト制限（100文字）を超える => isValid: false', () => {
      const longString = 'a'.repeat(101);
      const result = validateStringParameter(longString, 'test');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('最大100文字');
    });
  });

  describe('型チェック', () => {
    test('数値 => isValid: false', () => {
      const result = validateStringParameter(123 as any, 'test');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('test パラメータは文字列である必要があります');
    });

    test('オブジェクト => isValid: false', () => {
      const result = validateStringParameter({} as any, 'test');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('test パラメータは文字列である必要があります');
    });

    test('配列 => isValid: false', () => {
      const result = validateStringParameter([] as any, 'test');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('test パラメータは文字列である必要があります');
    });
  });

  describe('セキュリティチェック', () => {
    test('NULLバイトを含む文字列 => isValid: false', () => {
      const result = validateStringParameter('test\0string', 'test');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('test に不正な文字が含まれています');
    });

    test('NULLバイトなし => isValid: true', () => {
      const result = validateStringParameter('test-string', 'test');
      expect(result.isValid).toBe(true);
    });
  });
});
