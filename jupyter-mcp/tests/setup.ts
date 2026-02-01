import { jupyterClient } from '../src/jupyter-client/client.js';

/**
 * テスト用のノートブック名を生成
 */
export function generateTestNotebookName(testName: string): string {
  const timestamp = Date.now();
  const sanitized = testName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  return `test-${sanitized}-${timestamp}`;
}

/**
 * テスト後のクリーンアップ: ノートブックを削除
 */
export async function cleanupNotebook(notebookPath: string): Promise<void> {
  try {
    await jupyterClient.deleteContents(notebookPath);
    console.log(`[Cleanup] Deleted notebook: ${notebookPath}`);
  } catch (error) {
    // ノートブックが存在しない場合は無視
    if (error instanceof Error && error.message.includes('404')) {
      console.log(`[Cleanup] Notebook not found (already deleted): ${notebookPath}`);
    } else {
      console.error(`[Cleanup] Failed to delete notebook ${notebookPath}:`, error);
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
