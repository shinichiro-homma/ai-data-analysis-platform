/**
 * セッション/カーネルID → ノートブックパスのインメモリストア
 *
 * notebook_path なしの session_create → notebook_create → execute_code のフローで
 * Jupyter Session API にセッション情報がない場合のフォールバックとして使用する。
 *
 * MCP サーバー再起動時に紐付けが失われるが、カーネルも同時に失われるため実用上問題ない。
 */

import { BoundedMap } from './bounded-map.js';

export const sessionNotebookStore = new BoundedMap();
