/**
 * 入力検証のユーティリティ関数（共通）
 */

import path from 'node:path';

/** detail系ツールの一括取得上限 */
export const BULK_MAX_ITEMS = 50;

/**
 * バリデーション結果
 * 成功時に検証済みの値を型安全に返す
 */
export type ValidationResult<T = void> =
  (T extends void ? { isValid: true } : { isValid: true; value: T }) | { isValid: false; errorMessage: string };

/**
 * 文字列パラメータの共通バリデーション
 */
export function validateStringParameter(
  value: unknown,
  fieldName: string,
  options: {
    required?: boolean;
    maxLength?: number;
    allowEmpty?: boolean;
    allowNull?: boolean;
  } = {},
): ValidationResult<string> {
  const { required = false, maxLength = 100, allowEmpty = false, allowNull = true } = options;

  // null チェック
  if (value === null && !allowNull) {
    return {
      isValid: false,
      errorMessage: `${fieldName} パラメータが不正です`,
    };
  }

  // 必須チェック
  if (required && (value === null || value === undefined)) {
    return {
      isValid: false,
      errorMessage: `${fieldName} パラメータは必須です`,
    };
  }

  // 値が存在しない場合（かつ必須でない場合）は OK
  if (value === null || value === undefined) {
    return { isValid: true, value: '' };
  }

  // 型チェック
  if (typeof value !== 'string') {
    return {
      isValid: false,
      errorMessage: `${fieldName} パラメータは文字列である必要があります`,
    };
  }

  // 空文字列チェック（trim後）
  if (!allowEmpty && value.trim() === '') {
    return {
      isValid: false,
      errorMessage: `${fieldName} パラメータが空です`,
    };
  }

  // 長さチェック（DoS対策）
  if (value.length > maxLength) {
    return {
      isValid: false,
      errorMessage: `${fieldName} が長すぎます（最大${maxLength}文字）`,
    };
  }

  // NULLバイト攻撃対策
  if (value.includes('\0')) {
    return {
      isValid: false,
      errorMessage: `${fieldName} に不正な文字が含まれています`,
    };
  }

  return { isValid: true, value };
}

/**
 * 数値パラメータの共通バリデーション
 */
export function validateNumberParameter(
  value: unknown,
  fieldName: string,
  options: {
    required?: boolean;
    min?: number;
    max?: number;
    integer?: boolean;
  } = {},
): ValidationResult {
  const { required = false, min, max, integer = false } = options;

  if (value === undefined) {
    if (required) {
      return {
        isValid: false,
        errorMessage: `${fieldName} パラメータは必須です`,
      };
    }
    return { isValid: true };
  }

  if (typeof value !== 'number') {
    return {
      isValid: false,
      errorMessage: `${fieldName} パラメータは数値である必要があります`,
    };
  }

  if (integer && !Number.isInteger(value)) {
    return {
      isValid: false,
      errorMessage: `${fieldName} は整数である必要があります`,
    };
  }

  if (min !== undefined && value <= min) {
    return {
      isValid: false,
      errorMessage: `${fieldName} は ${min} より大きい値である必要があります`,
    };
  }

  if (max !== undefined && value > max) {
    return {
      isValid: false,
      errorMessage: `${fieldName} は最大 ${max} です`,
    };
  }

  return { isValid: true };
}

/**
 * ファイル名のバリデーション（パストラバーサル防止）
 *
 * パス区切り文字（/ \）や ".." を含むファイル名を拒否する。
 * path.basename による正規化チェックも行い、エッジケースを防ぐ。
 */
export function validateFilename(value: unknown, fieldName = 'filename'): ValidationResult {
  const result = validateStringParameter(value, fieldName, {
    required: true,
    maxLength: 255,
  });
  if (!result.isValid) {
    return result;
  }

  const filename = value as string;

  if (filename.includes('/') || filename.includes('\\')) {
    return {
      isValid: false,
      errorMessage: `${fieldName} にパス区切り文字を含めることはできません`,
    };
  }

  if (filename.includes('..')) {
    return {
      isValid: false,
      errorMessage: `${fieldName} に '..' を含めることはできません`,
    };
  }

  // path.basename による最終チェック（OS依存のエッジケース対策）
  if (path.basename(filename) !== filename) {
    return {
      isValid: false,
      errorMessage: `${fieldName} にパス区切り文字を含めることはできません`,
    };
  }

  return { isValid: true };
}

/**
 * 文字列配列パラメータの共通バリデーション
 * 成功時に検証済みの string[] を返す
 */
export function validateStringArrayParameter(
  value: unknown,
  fieldName: string,
  options: {
    required?: boolean;
    maxLength?: number;
    minItems?: number;
    maxItems?: number;
  } = {},
): ValidationResult<string[]> {
  const { required = false, maxLength = 128, minItems = 1, maxItems = 100 } = options;

  // 必須チェック
  if (required && (value === null || value === undefined)) {
    return {
      isValid: false,
      errorMessage: `${fieldName} パラメータは必須です`,
    };
  }

  // 値が存在しない場合（かつ必須でない場合）は OK
  if (value === null || value === undefined) {
    return { isValid: true, value: [] };
  }

  // 配列チェック
  if (!Array.isArray(value)) {
    return {
      isValid: false,
      errorMessage: `${fieldName} パラメータは配列である必要があります`,
    };
  }

  // 最小要素数チェック
  if (value.length < minItems) {
    return {
      isValid: false,
      errorMessage: `${fieldName} パラメータには${minItems}つ以上の要素が必要です`,
    };
  }

  // 最大要素数チェック（DoS対策）
  if (value.length > maxItems) {
    return {
      isValid: false,
      errorMessage: `${fieldName} パラメータの要素数が多すぎます（最大${maxItems}個）`,
    };
  }

  // 各要素のバリデーション（validateStringParameter に委譲）
  for (let i = 0; i < value.length; i++) {
    const elementResult = validateStringParameter(value[i], `${fieldName}[${i}]`, {
      required: true,
      maxLength,
      allowEmpty: false,
      allowNull: false,
    });
    if (!elementResult.isValid) {
      return elementResult;
    }
  }

  return { isValid: true, value: value as string[] };
}
