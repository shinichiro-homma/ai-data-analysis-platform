/**
 * get_table_index ツール実装
 */

import { getDocumentClient } from '../document-client/client.js';
import { createSuccessResponse, createErrorResponseFromError, type McpResponse } from '../utils/response-formatter.js';

export async function executeTableIndex(_args: Record<string, unknown>): Promise<McpResponse> {
  try {
    const { tables, total } = await getDocumentClient().getTableIndex();

    return createSuccessResponse({
      tables,
      total,
    });
  } catch (error) {
    return createErrorResponseFromError(error);
  }
}
