/**
 * get_logic_index ツール実装
 */

import { getDocumentClient } from '../document-client/client.js';
import { createSuccessResponse, createErrorResponseFromError, type McpResponse } from '../utils/response-formatter.js';

export async function executeLogicIndex(_args: Record<string, unknown>): Promise<McpResponse> {
  try {
    const { logic, total } = await getDocumentClient().getLogicIndex();

    return createSuccessResponse({
      logic,
      total,
    });
  } catch (error) {
    return createErrorResponseFromError(error);
  }
}
