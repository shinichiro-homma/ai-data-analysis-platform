/**
 * get_dataframe_info ツール実装
 */

import { jupyterClient } from "../jupyter-client/client.js";
import { DataFrameVariable } from "../jupyter-client/types.js";
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from "../utils/response-formatter.js";
import { validateStringParameter } from "../utils/validation.js";
import { resolveKernelId } from "../utils/session-resolver.js";

interface GetDataframeInfoArgs {
  session_id: string;
  variable_name: string;
  include_head?: boolean;
  head_rows?: number;
}

/**
 * DataFrame 変数の詳細情報を取得する
 */
export async function executeGetDataframeInfo(
  args: Record<string, unknown>
): Promise<McpResponse> {
  const {
    session_id,
    variable_name,
    include_head = true,
    head_rows = 5,
  } = args as Partial<GetDataframeInfoArgs>;

  // 入力検証: session_id
  const sessionIdValidation = validateStringParameter(session_id, "session_id", {
    required: true,
    maxLength: 200,
    allowEmpty: false,
  });

  if (!sessionIdValidation.isValid) {
    return createErrorResponse(
      sessionIdValidation.errorMessage!,
      "VALIDATION_ERROR"
    );
  }

  // 入力検証: variable_name
  const variableNameValidation = validateStringParameter(
    variable_name,
    "variable_name",
    {
      required: true,
      maxLength: 100,
      allowEmpty: false,
    }
  );

  if (!variableNameValidation.isValid) {
    return createErrorResponse(
      variableNameValidation.errorMessage!,
      "VALIDATION_ERROR"
    );
  }

  // 検証後、session_id と variable_name は必ず string
  const validatedSessionId = session_id as string;
  const validatedVariableName = variable_name as string;

  try {
    // session_id を kernel_id に解決
    const kernelId = await resolveKernelId(validatedSessionId);

    // 変数詳細を取得
    const variable = await jupyterClient.getVariable(
      kernelId,
      validatedVariableName
    );

    // DataFrame でない場合はエラー
    if (variable.type !== "DataFrame") {
      return createErrorResponse(
        `Variable '${validatedVariableName}' is not a DataFrame (type: ${variable.type})`,
        "INVALID_VARIABLE_TYPE"
      );
    }

    // DataFrameVariable として扱う
    const dfVariable = variable as DataFrameVariable;

    // レスポンスを整形
    const response: {
      success: boolean;
      name: string;
      shape: [number, number];
      columns: string[];
      dtypes: Record<string, string>;
      head?: Record<string, unknown>[];
      describe: Record<
        string,
        {
          count?: number;
          mean?: number;
          std?: number;
          min?: number;
          max?: number;
        }
      >;
      memory_bytes?: number;
    } = {
      success: true,
      name: dfVariable.name,
      shape: dfVariable.shape,
      columns: dfVariable.columns.map((col) => col.name),
      dtypes: Object.fromEntries(
        dfVariable.columns.map((col) => [col.name, col.dtype])
      ),
      describe: dfVariable.describe,
      memory_bytes: dfVariable.memory_bytes,
    };

    // include_head が true の場合のみ head を含める
    if (include_head && dfVariable.head) {
      // head_rows で行数を制限
      const limitedHead = dfVariable.head.slice(
        0,
        Math.min(head_rows as number, dfVariable.head.length)
      );
      response.head = limitedHead;
    }

    return createSuccessResponse(response);
  } catch (error) {
    return createErrorResponse(
      extractErrorMessage(error),
      extractErrorCode(error)
    );
  }
}
