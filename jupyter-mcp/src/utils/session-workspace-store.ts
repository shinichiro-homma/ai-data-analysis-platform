/**
 * セッション/カーネルID → ワークスペースIDのインメモリストア
 *
 * notebook_path なしの session_create 後に export_sql / execute_sql が
 * ワークスペースIDを特定できない問題（Issue #53）の修正として追加。
 *
 * session_create で workspace_id を常に保存し、notebookPath からの
 * ワークスペース特定に失敗した場合のフォールバックとして使用する。
 */

import { BoundedMap } from './bounded-map.js';

export const sessionWorkspaceStore = new BoundedMap();
