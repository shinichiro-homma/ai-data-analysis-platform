/**
 * 入力検証のユーティリティ関数
 */

/**
 * 文字列パラメータのバリデーション結果
 */
export interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

/**
 * 文字列パラメータの共通バリデーション
 *
 * @param value - 検証する値
 * @param fieldName - フィールド名（エラーメッセージに使用）
 * @param options - バリデーションオプション
 * @returns バリデーション結果
 */
export function validateStringParameter(
  value: unknown,
  fieldName: string,
  options: {
    required?: boolean;
    maxLength?: number;
    allowEmpty?: boolean;
  } = {}
): ValidationResult {
  const { required = false, maxLength = 100, allowEmpty = false } = options;

  // 必須チェック
  if (required && !value) {
    return {
      isValid: false,
      errorMessage: `${fieldName} パラメータは必須です`,
    };
  }

  // 値が存在しない場合（かつ必須でない場合）は OK
  if (!value) {
    return { isValid: true };
  }

  // 型チェック
  if (typeof value !== "string") {
    return {
      isValid: false,
      errorMessage: `${fieldName} パラメータは文字列である必要があります`,
    };
  }

  // 空文字列チェック（trim後）
  if (!allowEmpty && value.trim() === "") {
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
  if (value.includes("\0")) {
    return {
      isValid: false,
      errorMessage: `${fieldName} に不正な文字が含まれています`,
    };
  }

  return { isValid: true };
}
