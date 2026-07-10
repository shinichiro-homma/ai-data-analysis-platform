import { jupyterClient } from '../src/jupyter-client/client.js';
import { JupyterClientError } from '../src/jupyter-client/errors.js';
import { getCachedWorkspacePath } from '../src/utils/workspace-path-store.js';

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
 * success: false の場合、エラー詳細をコンソールに出力する
 */
export function parseToolCallResult(result: { content: Array<{ type: string; text: string }> }): ToolCallResponse {
  const parsed = JSON.parse(result.content[0].text) as ToolCallResponse;
  if (!parsed.success) {
    const error = parsed.error as { code?: string; message?: string } | undefined;
    const errorDetail = error ? `code=${error.code}, message=${error.message}` : JSON.stringify(parsed);
    console.error(`[parseToolCallResult] Tool returned success=false: ${errorDetail}`);
  }
  return parsed;
}

/**
 * ツール実行結果の success を検証するヘルパー
 * success: false の場合、エラー詳細を含むメッセージで失敗する
 */
export function expectSuccess(data: ToolCallResponse, context?: string): void {
  if (!data.success) {
    const error = data.error as { code?: string; message?: string } | undefined;
    const prefix = context ? `[${context}] ` : '';
    const errorDetail = error
      ? `code=${error.code}, message=${error.message}`
      : `raw response: ${JSON.stringify(data)}`;
    throw new Error(`${prefix}Tool call failed: ${errorDetail}`);
  }
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
 * テスト後のクリーンアップ: ワークスペースを削除
 * ワークスペース内のファイルを先に削除してからディレクトリを削除する（リトライ付き）
 */
export async function cleanupWorkspace(workspaceId: string): Promise<void> {
  const workspacePath = getCachedWorkspacePath(workspaceId) ?? `workspaces/${workspaceId}`;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // ワークスペース内のファイル一覧を取得して個別に削除
      try {
        const contents = await jupyterClient.listContents(workspacePath);
        for (const entry of contents.contents) {
          try {
            await jupyterClient.deleteContents(`${workspacePath}/${entry.name}`);
          } catch {
            // 個別ファイル削除失敗は無視
          }
        }
      } catch {
        // listContents 失敗は無視（ワークスペースが存在しない場合など）
      }

      // ワークスペースディレクトリ自体を削除
      await jupyterClient.deleteContents(workspacePath);
      console.log(`[Cleanup] Deleted workspace: ${workspaceId}`);
      return;
    } catch (error) {
      // ワークスペースが存在しない場合（404エラー）は無視
      if (error instanceof JupyterClientError && error.statusCode === 404) {
        console.log(`[Cleanup] Workspace not found (already deleted): ${workspaceId}`);
        return;
      }

      if (attempt < maxRetries) {
        // リトライ前に待機（指数バックオフ）
        await new Promise((r) => setTimeout(r, 300 * attempt));
      } else {
        // 最終試行失敗はサイレントに無視（テスト残骸が残っても問題ない）
        console.log(
          `[Cleanup] Could not fully delete workspace ${workspaceId} after ${maxRetries} attempts (test residue left)`,
        );
      }
    }
  }
}

/**
 * Jupyter サーバーの接続確認（標準API + カスタムエンドポイント）
 */
export async function checkJupyterConnection(): Promise<void> {
  // 1. 標準 Jupyter API の疎通確認
  try {
    await jupyterClient.listContents('/');
  } catch (error) {
    throw new Error(
      `Jupyter server is not accessible. Please ensure:\n` +
        `1. docker-compose up -d is running\n` +
        `2. JUPYTER_SERVER_URL and JUPYTER_TOKEN are set correctly\n` +
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  // 2. カスタムエンドポイント（/api/workspaces）の疎通確認
  try {
    await jupyterClient.listWorkspaces();
  } catch (error) {
    throw new Error(
      `Jupyter server custom API (/api/workspaces) is not accessible.\n` +
        `The Docker image may be outdated. Run: scripts/check-freshness.sh --rebuild\n` +
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
