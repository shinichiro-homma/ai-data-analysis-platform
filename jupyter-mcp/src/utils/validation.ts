/**
 * 入力検証のユーティリティ関数
 */

import type { WorkspaceStatus } from '../jupyter-client/types.js';
import { normalizeNotebookPath } from './path-validator.js';

// 共通関数・型を re-export
export {
  type ValidationResult,
  validateStringParameter,
  validateNumberParameter,
  validateFilename,
} from '@ai-data-analysis/mcp-shared';

// 以下、共通パッケージから import して使用
import { validateStringParameter, type ValidationResult } from '@ai-data-analysis/mcp-shared';

/**
 * notebook_path パラメータを検証し、正規化済みパスを返す
 *
 * notebook_path の文字列バリデーション + パストラバーサル対策の正規化を一括で行う。
 */
export function validateAndNormalizeNotebookPath(value: unknown): { path: string } | { error: string } {
  const validation = validateStringParameter(value, 'notebook_path', {
    required: true,
    maxLength: 500,
    allowEmpty: false,
  });
  if (!validation.isValid) {
    return { error: validation.errorMessage! };
  }
  try {
    return { path: normalizeNotebookPath(value as string) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * cell_index パラメータを検証し、数値を返す
 */
export function validateCellIndexParam(
  value: unknown,
  paramName: string = 'cell_index',
): { index: number } | { error: string } {
  const validation = validateCellIndex(value, paramName);
  if (!validation.isValid) {
    return { error: validation.errorMessage! };
  }
  return { index: value as number };
}

/**
 * cell_index パラメータのバリデーション
 *
 * @param value - 検証する値
 * @param paramName - パラメータ名（デフォルト: 'cell_index'）
 * @returns バリデーション結果
 */
export function validateCellIndex(value: unknown, paramName: string = 'cell_index'): ValidationResult {
  if (value === undefined || value === null) {
    return { isValid: false, errorMessage: `${paramName} パラメータは必須です` };
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return {
      isValid: false,
      errorMessage: `${paramName} パラメータは 0 以上の整数である必要があります`,
    };
  }
  return { isValid: true };
}

/**
 * workspace_id パラメータのバリデーション（パストラバーサル防止を含む）
 *
 * @param value - 検証する値
 * @returns バリデーション結果
 */
export function validateWorkspaceId(value: unknown): ValidationResult {
  const result = validateStringParameter(value, 'workspace_id', {
    required: true,
    maxLength: 50,
    allowEmpty: false,
  });

  if (!result.isValid) {
    return result;
  }

  const workspaceId = value as string;

  if (workspaceId.includes('/') || workspaceId.includes('\\')) {
    return {
      isValid: false,
      errorMessage: 'workspace_id にパス区切り文字を含めることはできません',
    };
  }

  if (workspaceId.includes('..')) {
    return {
      isValid: false,
      errorMessage: "workspace_id に '..' を含めることはできません",
    };
  }

  return { isValid: true };
}

/**
 * ワークスペースの有効なステータス値
 */
export const VALID_WORKSPACE_STATUSES: readonly WorkspaceStatus[] = [
  'not_started',
  'in_progress',
  'completed',
  'blocked',
] as const;

/**
 * ワークスペースメタデータ（summary, status）の共通バリデーション
 *
 * @returns エラーメッセージ。問題なければ null
 */
export function validateWorkspaceMetadata(summary: unknown, status: unknown): string | null {
  if (summary !== undefined) {
    const summaryValidation = validateStringParameter(summary, 'summary', {
      required: false,
      maxLength: 200,
      allowEmpty: true,
    });
    if (!summaryValidation.isValid) {
      return summaryValidation.errorMessage!;
    }
  }

  if (status !== undefined && !VALID_WORKSPACE_STATUSES.includes(status as WorkspaceStatus)) {
    return `status must be one of: ${VALID_WORKSPACE_STATUSES.join(', ')}`;
  }

  return null;
}

/**
 * SQL ツール共通パラメータ（session_id, sql）のバリデーション
 *
 * execute_sql と export_sql で共通する入力検証を一元化する。
 *
 * @returns エラーメッセージ。問題なければ null
 */
export function validateSqlToolCommonParams(sessionId: unknown, sql: unknown): string | null {
  const sessionIdValidation = validateStringParameter(sessionId, 'session_id', {
    required: true,
    maxLength: 200,
    allowEmpty: false,
  });
  if (!sessionIdValidation.isValid) {
    return sessionIdValidation.errorMessage!;
  }

  const sqlValidation = validateStringParameter(sql, 'sql', {
    required: true,
    maxLength: 1000000,
    allowEmpty: false,
  });
  if (!sqlValidation.isValid) {
    return sqlValidation.errorMessage!;
  }

  return null;
}
