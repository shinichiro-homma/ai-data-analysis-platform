import { jupyterClient } from '../src/jupyter-client/client.js';
import { JupyterClientError } from '../src/jupyter-client/errors.js';

/**
 * MCPツール実行結果のレスポンス型
 */
export interface ToolCallResponse {
  success: boolean;
  path?: string;
  [key: string]: unknown;
}

/**
 * テスト用のノートブック名を生成
 */
export function generateTestNotebookName(testName: string): string {
  const timestamp = Date.now();
  const sanitized = testName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  return `test-${sanitized}-${timestamp}`;
}

/**
 * MCPツール実行結果をパースして型安全に取得
 */
export function parseToolCallResult(result: { content: Array<{ type: string; text: string }> }): ToolCallResponse {
  return JSON.parse(result.content[0].text) as ToolCallResponse;
}

/**
 * テスト後のクリーンアップ: ノートブックを削除
 */
export async function cleanupNotebook(notebookPath: string): Promise<void> {
  try {
    await jupyterClient.deleteContents(notebookPath);
    console.log(`[Cleanup] Deleted notebook: ${notebookPath}`);
  } catch (error) {
    // ノートブックが存在しない場合（404エラー）は無視
    if (error instanceof JupyterClientError && error.statusCode === 404) {
      console.log(`[Cleanup] Notebook not found (already deleted): ${notebookPath}`);
    } else {
      console.error(`[Cleanup] Failed to delete notebook ${notebookPath}:`, error);
    }
  }
}

/**
 * テスト後のクリーンアップ: セッション（カーネル）を削除
 */
export async function cleanupSession(sessionId: string): Promise<void> {
  try {
    await jupyterClient.deleteKernel(sessionId);
    console.log(`[Cleanup] Deleted session: ${sessionId}`);
  } catch (error) {
    // セッションが存在しない場合（404エラー）は無視
    if (error instanceof JupyterClientError && error.statusCode === 404) {
      console.log(`[Cleanup] Session not found (already deleted): ${sessionId}`);
    } else {
      console.error(`[Cleanup] Failed to delete session ${sessionId}:`, error);
    }
  }
}

/**
 * Jupyter サーバーの接続確認
 */
export async function checkJupyterConnection(): Promise<void> {
  try {
    await jupyterClient.getContents('');
  } catch (error) {
    throw new Error(
      `Jupyter server is not accessible. Please ensure:\n` +
      `1. docker-compose up -d is running\n` +
      `2. JUPYTER_SERVER_URL and JUPYTER_TOKEN are set correctly\n` +
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
