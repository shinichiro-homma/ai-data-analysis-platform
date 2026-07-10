/**
 * jupyter-mcp のツール登録型
 *
 * 共有型 `ToolEntry` に Jupyter 固有の必須フィールド `mutatesNotebook` を加える。
 * このフィールドはノートブックのセル内容を変更するツール（AI編集モードの自動制御・
 * ロック取得対象）を型レベルで宣言させ、新規ツール追加時の宣言漏れをコンパイル
 * エラーで検知するためのもの。
 *
 * index.ts に置くと各ツールファイルとの循環 import になるため独立モジュールとする。
 */

import type { ToolEntry } from '@ai-data-analysis/mcp-shared';
import type { McpToolResult } from '../utils/response-formatter.js';

export interface JupyterToolEntry extends ToolEntry<McpToolResult> {
  /**
   * ノートブックのセル内容を変更するツールか。
   * true のツールは AI編集モードの自動制御（emitAiEditStart/End）の対象となる。
   * カーネル再起動のようにセル内容を変更しない操作は false。
   */
  mutatesNotebook: boolean;
}
