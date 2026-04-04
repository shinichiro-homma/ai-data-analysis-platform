/**
 * get_table_detail ツール実装
 */

import { getDocumentClient } from '../document-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  createErrorResponseFromError,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateStringArrayParameter, BULK_MAX_ITEMS } from '../utils/validation.js';

export async function executeTableDetail(args: Record<string, unknown>): Promise<McpResponse> {
  const tableNames = args.table_names;

  // バリデーション
  const validation = validateStringArrayParameter(tableNames, 'table_names', {
    required: true,
    maxLength: 128,
    minItems: 1,
    maxItems: BULK_MAX_ITEMS,
  });
  if (!validation.isValid) {
    return createErrorResponse(validation.errorMessage, 'VALIDATION_ERROR');
  }

  try {
    const result = await getDocumentClient().getTableDetails(validation.value);

    return createSuccessResponse({
      tables: result.tables,
      not_found: result.not_found,
    });
  } catch (error) {
    return createErrorResponseFromError(error);
  }
}
