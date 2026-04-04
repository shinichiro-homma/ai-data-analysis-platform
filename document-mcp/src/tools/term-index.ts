/**
 * get_term_index ツール実装
 */

import { getDocumentClient } from '../document-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  createErrorResponseFromError,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateStringParameter } from '../utils/validation.js';

export async function executeTermIndex(args: Record<string, unknown>): Promise<McpResponse> {
  // query はオプショナル — 指定された場合のみバリデーション
  let query: string | undefined;
  if (args.query !== null && args.query !== undefined) {
    const validation = validateStringParameter(args.query, 'query', {
      required: false,
      maxLength: 200,
      allowEmpty: false,
    });
    if (!validation.isValid) {
      return createErrorResponse(validation.errorMessage, 'VALIDATION_ERROR');
    }
    query = validation.value || undefined;
  }

  try {
    const { terms, total } = await getDocumentClient().getTermIndex(query);

    return createSuccessResponse({
      terms,
      total,
    });
  } catch (error) {
    return createErrorResponseFromError(error);
  }
}
