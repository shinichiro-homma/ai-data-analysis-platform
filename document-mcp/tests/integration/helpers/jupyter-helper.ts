/**
 * jupyter-server REST API 呼び出しヘルパー
 *
 * document-mcp の結合テスト用。Node.js の fetch API を使用し、
 * axios を使わないことで vitest のシリアライゼーション問題を回避する。
 */

const JUPYTER_SERVER_URL = process.env.JUPYTER_SERVER_URL || 'http://localhost:8888';
const JUPYTER_TOKEN = process.env.JUPYTER_TOKEN || '';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ERROR_BODY_LENGTH = 500;

const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  ...(JUPYTER_TOKEN ? { Authorization: `Bearer ${JUPYTER_TOKEN}` } : {}),
};

/**
 * fetch + ステータスチェックの共通処理
 */
async function fetchWithCheck(path: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(`${JUPYTER_SERVER_URL}${path}`, {
    ...options,
    headers: { ...DEFAULT_HEADERS, ...options?.headers },
    signal: options?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, MAX_ERROR_BODY_LENGTH)}`);
  }
  return res;
}

/**
 * fetch + JSON パース
 */
async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetchWithCheck(path, options);
  return res.json() as Promise<T>;
}

/**
 * jupyter-server への接続確認
 */
export async function checkJupyterConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${JUPYTER_SERVER_URL}/health`, {
      headers: DEFAULT_HEADERS,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * ワークスペース作成
 */
export async function createWorkspace(name: string): Promise<{ workspace_id: string; path: string }> {
  const res = await fetchJson<{
    data: { workspace_id: string; path: string };
  }>('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return res.data;
}

/**
 * ワークスペース内でセッション作成
 */
export async function createSession(workspaceId: string): Promise<{ session_id: string; kernel_id: string }> {
  const res = await fetchJson<{
    data: { session_id: string; kernel_id: string };
  }>('/api/custom/sessions', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
  return {
    session_id: res.data.session_id,
    kernel_id: res.data.kernel_id,
  };
}

/**
 * コード実行レスポンス
 */
export interface ExecuteResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error: { ename: string; evalue: string } | null;
}

/**
 * コード実行
 */
export async function executeCode(kernelId: string, code: string, timeout: number = 30): Promise<ExecuteResult> {
  const json = await fetchJson<{
    data: {
      success: boolean;
      outputs: Array<{ type: string; text: string }>;
      error: { ename: string; evalue: string } | null;
    };
  }>(`/api/kernels/${kernelId}/execute`, {
    method: 'POST',
    body: JSON.stringify({ code, timeout }),
    signal: AbortSignal.timeout(timeout * 1000 + 5000),
  });
  const data = json.data;

  // outputs 配列から stdout/stderr を抽出
  const stdout = data.outputs
    .filter((o) => o.type === 'stdout')
    .map((o) => o.text)
    .join('');
  const stderr = data.outputs
    .filter((o) => o.type === 'stderr')
    .map((o) => o.text)
    .join('');

  return {
    success: data.success,
    stdout,
    stderr,
    error: data.error,
  };
}

/**
 * セッション削除（クリーンアップ用：エラーは警告のみ）
 */
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await fetchWithCheck(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  } catch (e) {
    console.warn(`セッション削除に失敗 (${sessionId}):`, e);
  }
}

/**
 * ワークスペースのファイル削除（クリーンアップ用：エラーは警告のみ）
 */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  try {
    await fetchWithCheck(`/api/custom/contents/${workspaceId}`, {
      method: 'DELETE',
    });
  } catch (e) {
    console.warn(`ワークスペース削除に失敗 (${workspaceId}):`, e);
  }
}
