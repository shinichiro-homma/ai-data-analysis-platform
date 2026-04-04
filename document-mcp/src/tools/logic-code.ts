/**
 * get_logic_code ツール実装
 */

import { getDocumentClient } from '../document-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  createErrorResponseFromError,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateStringParameter } from '../utils/validation.js';

export async function executeLogicCode(args: Record<string, unknown>): Promise<McpResponse> {
  const logicName = args.logic_name;

  // バリデーション
  const validation = validateStringParameter(logicName, 'logic_name', {
    required: true,
    maxLength: 128,
  });
  if (!validation.isValid) {
    return createErrorResponse(validation.errorMessage, 'VALIDATION_ERROR');
  }

  try {
    const result = await getDocumentClient().getLogicCode(validation.value);

    return createSuccessResponse({
      logic_name: result.logic_name,
      language: result.language,
      code: result.code,
    });
  } catch (error) {
    return createErrorResponseFromError(error);
  }
}
