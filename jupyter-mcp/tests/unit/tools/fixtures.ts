/**
 * テスト共有フィクスチャ: mutatesNotebook: true な 12 ツール名の期待値。
 *
 * 重要: このリストは実装（src/tools/index.ts の toolRegistry / mutatesNotebook 宣言）から
 * 導出してはならない。実装側の分類ミス（宣言漏れ・誤分類）を検知するために、
 * テストは実装から独立してこの期待値を保持する必要がある。
 * そのため、このファイルは src 配下を import しないこと。
 */
export const MUTATING_TOOL_NAMES = [
  'execute_code',
  'notebook_add_cell',
  'notebook_edit_cell',
  'notebook_delete_cell',
  'notebook_execute_cell',
  'notebook_execute_batch',
  'notebook_reorder_cell',
  'notebook_merge_cells',
  'notebook_split_cell',
  'notebook_change_cell_type',
  'notebook_copy_cell',
  'notebook_clear_outputs',
];
