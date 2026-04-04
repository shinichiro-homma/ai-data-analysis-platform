/**
 * MCP ツールの登録とルーティング
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  type ToolEntry,
  registerTools as sharedRegisterTools,
  handleToolCall as sharedHandleToolCall,
} from '@ai-data-analysis/mcp-shared';
import { type McpToolResult } from '../utils/response-formatter.js';
import { VALID_WORKSPACE_STATUSES } from '../utils/validation.js';

/** workspace status フィールドの JSON Schema（ツール定義で共用） */
const WORKSPACE_STATUS_SCHEMA = {
  type: 'string' as const,
  enum: [...VALID_WORKSPACE_STATUSES],
};
import { executeWorkspaceCreate } from './workspace-create.js';
import { executeWorkspaceList } from './workspace-list.js';
import { executeWorkspaceUpdate } from './workspace-update.js';
import { executeWorkspaceSummarize } from './workspace-summarize.js';
import { executeNotebookCreate } from './notebook-create.js';
import { executeNotebookAddCell } from './notebook-add-cell.js';
import { executeNotebookListCells } from './notebook-list-cells.js';
import { executeNotebookEditCell } from './notebook-edit-cell.js';
import { executeNotebookDeleteCell } from './notebook-delete-cell.js';
import { executeSessionCreate } from './session-create.js';
import { executeSessionList } from './session-list.js';
import { executeSessionDelete } from './session-delete.js';
import { executeSessionConnect } from './session-connect.js';
import { executeExecuteCode } from './execute-code.js';
import { executeGetVariables } from './get-variables.js';
import { executeGetDataframeInfo } from './get-dataframe-info.js';
import { executeFileList } from './file-list.js';
import { executeAiEditStart } from './ai-edit-start.js';
import { executeAiEditEnd } from './ai-edit-end.js';
import { executeExecuteSql } from './execute-sql.js';
import { executeExportSql } from './export-sql.js';
import { executeGetImage } from './get-image.js';

const toolRegistry: ToolEntry<McpToolResult>[] = [
  {
    definition: {
      name: 'workspace_create',
      description:
        'Creates a new workspace (isolated working directory). This is the FIRST step to start data analysis. Each chat gets an independent directory with data/ for datasets and output/ for results and charts. After creation, call session_create to start a session.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Workspace name (max 100 characters)',
          },
          summary: {
            type: 'string',
            description: 'Workspace summary describing the analysis content (max 200 characters)',
          },
          status: {
            ...WORKSPACE_STATUS_SCHEMA,
            description: 'Workspace status (default: not_started)',
          },
        },
        required: ['name'],
      },
    },
    execute: executeWorkspaceCreate,
  },
  {
    definition: {
      name: 'workspace_update',
      description:
        'Updates workspace metadata (summary and/or status). Use to record analysis progress and current state. At least one of summary or status must be specified.',
      inputSchema: {
        type: 'object',
        properties: {
          workspace_id: {
            type: 'string',
            description: 'Workspace ID',
          },
          summary: {
            type: 'string',
            description: 'Updated summary of the analysis (max 200 characters)',
          },
          status: {
            ...WORKSPACE_STATUS_SCHEMA,
            description: 'Updated workspace status',
          },
        },
        required: ['workspace_id'],
      },
    },
    execute: executeWorkspaceUpdate,
  },
  {
    definition: {
      name: 'workspace_list',
      description:
        'Retrieves the list of existing workspaces. Workspaces persist on disk and can be rediscovered after MCP restart.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    execute: executeWorkspaceList,
  },
  {
    definition: {
      name: 'workspace_summarize',
      description:
        'Generates a verification report for the workspace. Only use when explicitly requested by the user. Returns a summary template, verification criteria (A-F), and report creation instructions.',
      inputSchema: {
        type: 'object',
        properties: {
          workspace_id: {
            type: 'string',
            description: 'Workspace ID',
          },
        },
        required: ['workspace_id'],
      },
    },
    execute: executeWorkspaceSummarize,
  },
  {
    definition: {
      name: 'notebook_create',
      description: 'Creates a new notebook within the workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          workspace_id: {
            type: 'string',
            description: 'Workspace ID',
          },
          session_id: {
            type: 'string',
            description: 'Session ID',
          },
          name: {
            type: 'string',
            description: 'Notebook name (.ipynb extension not required)',
          },
        },
        required: ['workspace_id', 'session_id', 'name'],
      },
    },
    execute: executeNotebookCreate,
  },
  {
    definition: {
      name: 'notebook_add_cell',
      description: 'Adds a cell (code or markdown) to the notebook.',
      inputSchema: {
        type: 'object',
        properties: {
          notebook_path: {
            type: 'string',
            description: 'Notebook path (e.g., analysis.ipynb)',
          },
          cell_type: {
            type: 'string',
            enum: ['code', 'markdown'],
            description: 'Cell type (code or markdown)',
          },
          source: {
            type: 'string',
            description: 'Cell content',
          },
          position: {
            type: 'number',
            description: 'Insert position (0-indexed, appends to end if omitted)',
          },
        },
        required: ['notebook_path', 'cell_type', 'source'],
      },
    },
    execute: executeNotebookAddCell,
  },
  {
    definition: {
      name: 'notebook_list_cells',
      description: 'Retrieves the list of cells in a notebook with their index, type, source, and outputs.',
      inputSchema: {
        type: 'object',
        properties: {
          notebook_path: {
            type: 'string',
            description: 'Notebook path (e.g., analysis.ipynb)',
          },
        },
        required: ['notebook_path'],
      },
    },
    execute: executeNotebookListCells,
  },
  {
    definition: {
      name: 'notebook_edit_cell',
      description: 'Edits the source code of an existing cell in a notebook.',
      inputSchema: {
        type: 'object',
        properties: {
          notebook_path: {
            type: 'string',
            description: 'Notebook path (e.g., analysis.ipynb)',
          },
          cell_index: {
            type: 'number',
            description: 'Cell index to edit (0-indexed)',
          },
          source: {
            type: 'string',
            description: 'New source code for the cell',
          },
        },
        required: ['notebook_path', 'cell_index', 'source'],
      },
    },
    execute: executeNotebookEditCell,
  },
  {
    definition: {
      name: 'notebook_delete_cell',
      description: 'Deletes a cell from a notebook at the specified index.',
      inputSchema: {
        type: 'object',
        properties: {
          notebook_path: {
            type: 'string',
            description: 'Notebook path (e.g., analysis.ipynb)',
          },
          cell_index: {
            type: 'number',
            description: 'Cell index to delete (0-indexed)',
          },
        },
        required: ['notebook_path', 'cell_index'],
      },
    },
    execute: executeNotebookDeleteCell,
  },
  {
    definition: {
      name: 'session_create',
      description:
        'Creates a new session (kernel) to start data analysis. Specify workspace_id to launch a Python/SQL kernel in the workspace. REQUIRED before executing any code or SQL. MUST be called after workspace_create. The returned browser_url allows opening the notebook in a browser.',
      inputSchema: {
        type: 'object',
        properties: {
          workspace_id: {
            type: 'string',
            description: "Workspace ID. The kernel's working directory is set to the workspace",
          },
          notebook_path: {
            type: 'string',
            description:
              'Notebook path (relative to workspace). When specified, users opening this notebook share the same kernel',
          },
        },
        required: ['workspace_id'],
      },
    },
    execute: executeSessionCreate,
  },
  {
    definition: {
      name: 'session_list',
      description: 'Retrieves the list of active analysis sessions.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    execute: executeSessionList,
  },
  {
    definition: {
      name: 'session_delete',
      description: 'Terminates an analysis session and releases resources.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID to terminate',
          },
        },
        required: ['session_id'],
      },
    },
    execute: executeSessionDelete,
  },
  {
    definition: {
      name: 'session_connect',
      description:
        'Connects to an existing session. Use to share/reconnect to a kernel the user has open in the browser. Enables reconnection after MCP restart or connecting to user-initiated sessions. Use to reuse existing sessions rather than creating new ones.',
      inputSchema: {
        type: 'object',
        properties: {
          notebook_path: {
            type: 'string',
            description: 'Path of the notebook to connect to (e.g., analysis.ipynb)',
          },
          kernel_id: {
            type: 'string',
            description: 'Kernel ID to connect to. Can be used instead of notebook_path',
          },
        },
        required: [],
      },
    },
    execute: executeSessionConnect,
  },
  {
    definition: {
      name: 'execute_code',
      description:
        "Executes Python code for data analysis, aggregation, and visualization. pandas, matplotlib, etc. are available. Returns execution results and chart images. Automatically adds a notebook cell if none exists. CSVs saved by execute_sql can be loaded via pd.read_csv('data/filename.csv'). Use get_image to view chart images. [Security] Shell commands (!command, subprocess, os.system, ctypes) are blocked by AST inspection + sandbox.",
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID',
          },
          code: {
            type: 'string',
            description: 'Python code to execute. Shell commands (!command, subprocess, os.system, ctypes) are blocked',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in seconds (default: 30, max: 300)',
          },
          cell_index: {
            type: 'number',
            description:
              'Cell index to execute (use cell_index from notebook_add_cell return value. Auto-detected if omitted)',
          },
        },
        required: ['session_id'],
      },
    },
    execute: executeExecuteCode,
  },
  {
    definition: {
      name: 'get_variables',
      description:
        'Retrieves the list of variables defined in the session. Returns variable name, type, and approximate size.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID',
          },
        },
        required: ['session_id'],
      },
    },
    execute: executeGetVariables,
  },
  {
    definition: {
      name: 'get_dataframe_info',
      description:
        'Retrieves detailed DataFrame variable info (columns, head rows, statistics). Use after creating a DataFrame with execute_code to understand structure, types, and distribution. Check variable names with get_variables first.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID',
          },
          variable_name: {
            type: 'string',
            description: 'DataFrame variable name',
          },
          include_head: {
            type: 'boolean',
            description: 'Include head rows (default: true)',
          },
          head_rows: {
            type: 'number',
            description: 'Number of head rows to retrieve (default: 5)',
          },
        },
        required: ['session_id', 'variable_name'],
      },
    },
    execute: executeGetDataframeInfo,
  },
  {
    definition: {
      name: 'file_list',
      description:
        'Retrieves the file list within the specified workspace. Use to verify notebook creation or list data files.',
      inputSchema: {
        type: 'object',
        properties: {
          workspace_id: {
            type: 'string',
            description: 'Workspace ID',
          },
          path: {
            type: 'string',
            description: 'Relative directory path within workspace (defaults to workspace root)',
          },
        },
        required: ['workspace_id'],
      },
    },
    execute: executeFileList,
  },
  {
    definition: {
      name: 'ai_edit_start',
      description:
        'Starts AI edit mode and locks the notebook (read-only). Disables user keyboard input and cell editing until AI operations are complete.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID (session created with notebook_path)',
          },
        },
        required: ['session_id'],
      },
    },
    execute: executeAiEditStart,
  },
  {
    definition: {
      name: 'ai_edit_end',
      description:
        'Ends AI edit mode and unlocks the notebook. Call after editing is complete to allow user editing again. Releases the lock started by ai_edit_start.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID (session created with notebook_path)',
          },
        },
        required: ['session_id'],
      },
    },
    execute: executeAiEditEnd,
  },
  {
    definition: {
      name: 'execute_sql',
      description: `Executes a SQL query and saves results as CSV in the workspace's data/ directory. Queries are auto-saved as .sql files in data/queries/.\n\n[REQUIRED] Before writing SQL:\n(1) Call get_table_detail to inspect table structure. Use key_type/domain in the response to identify JOIN keys\n(2) Call get_logic_index to check for reusable existing logic (SQL templates, etc.)\n\nJOIN rule: JOIN columns that share the same key_type. domain.master_table/master_column indicates FK references.\n\nResponse (SELECT):\n{\n  "file_path": "CSV path (loadable via pd.read_csv)",\n  "row_count": "number of rows",\n  "columns": "array of column names",\n  "truncated": "whether max_rows truncation occurred",\n  "query_file_path": "path to saved SQL file"\n}`,
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID',
          },
          sql: {
            type: 'string',
            description:
              'SQL query. Dangerous operations (DELETE, ALTER, GRANT, REVOKE, VACUUM, ANALYZE, non-TEMP CREATE TABLE, CREATE/DROP INDEX) are rejected',
          },
          filename: {
            type: 'string',
            description: "Output filename in data/ directory (e.g., 'transactions.csv')",
          },
          timeout: {
            type: 'number',
            description: 'Timeout in seconds (default: 30, max: 300)',
          },
          max_rows: {
            type: 'number',
            description: 'Maximum rows to retrieve (default: 100000)',
          },
        },
        required: ['session_id', 'sql', 'filename'],
      },
    },
    execute: executeExecuteSql,
  },
  {
    definition: {
      name: 'export_sql',
      description: `Executes a SQL query and exports results as Parquet/CSV to the workspace's data/ directory. No row limit, streaming processing — ideal for dataset creation. Default format is Parquet; use CSV only when specified.\n\n[REQUIRED] Before writing SQL:\n(1) Call get_table_detail to inspect table structure\n(2) Call get_logic_index to check for reusable existing logic\n\nResponse:\n{\n  "file_path": "export file path (loadable via pd.read_parquet in execute_code)",\n  "row_count": "number of exported rows",\n  "file_size_bytes": "file size"\n}`,
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID',
          },
          sql: {
            type: 'string',
            description:
              'SELECT query to export. Dangerous operations (DELETE, ALTER, GRANT, REVOKE, etc.) are rejected',
          },
          filename: {
            type: 'string',
            description: "Output file path in data/ directory (e.g., 'purchase_history.parquet')",
          },
          format: {
            type: 'string',
            enum: ['parquet', 'csv'],
            description: 'Output format (default: parquet). Use csv only when user specifies',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in seconds (default: 300, max: 600)',
          },
        },
        required: ['session_id', 'sql', 'filename'],
      },
    },
    execute: executeExportSql,
  },
  {
    definition: {
      name: 'get_image',
      description:
        "Retrieves image data generated by execute_code as MCP image content type. Specify the file_path from execute_code's images[].file_path. Enables AI vision analysis of charts and graphs.",
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Image file path (use images[].file_path value from execute_code response)',
          },
        },
        required: ['file_path'],
      },
    },
    execute: executeGetImage,
  },
];

/**
 * ツール定義一覧を返す
 */
export function registerTools(): Tool[] {
  return sharedRegisterTools(toolRegistry);
}

/**
 * ツール名から実装関数へルーティング
 */
export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  return sharedHandleToolCall(toolRegistry, name, args) as Promise<McpToolResult>;
}
