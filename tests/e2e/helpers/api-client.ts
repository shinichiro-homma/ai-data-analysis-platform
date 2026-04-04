/**
 * E2E テスト用 API クライアント
 *
 * document-server / jupyter-server の REST API ラッパー。
 * Node.js の fetch API を使用し、外部ライブラリに依存しない。
 */

// --- 設定 ---

const DOCUMENT_SERVER_URL = process.env.DOCUMENT_SERVER_URL || 'http://localhost:3002';
const JUPYTER_SERVER_URL = process.env.JUPYTER_SERVER_URL || 'http://localhost:8888';
const JUPYTER_TOKEN = process.env.JUPYTER_TOKEN || '';
if (!JUPYTER_TOKEN) {
  console.warn('[api-client] JUPYTER_TOKEN is not set. Requests will be sent without authentication.');
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ERROR_BODY_LENGTH = 500;

const JUPYTER_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  ...(JUPYTER_TOKEN ? { Authorization: `Bearer ${JUPYTER_TOKEN}` } : {}),
};

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
};

// --- 共通ヘルパー ---

/**
 * fetch の共通ベース関数。URL 結合、ヘッダーマージ、タイムアウト設定を一元化。
 * checkStatus=true の場合、レスポンスが ok でなければエラーを投げる。
 */
async function baseFetch(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  options?: RequestInit,
  checkStatus = true,
): Promise<Response> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
    signal: options?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (checkStatus && !res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, MAX_ERROR_BODY_LENGTH)}`);
  }
  return res;
}

async function docFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await baseFetch(DOCUMENT_SERVER_URL, path, JSON_HEADERS, options);
  return res.json() as Promise<T>;
}

/** docFetch + { data: T } アンラップ。document-server のレスポンスは常にこの形式。 */
async function docFetchData<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await docFetch<{ data: T }>(path, options);
  return res.data;
}

async function jupyterFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await baseFetch(JUPYTER_SERVER_URL, path, JUPYTER_HEADERS, options);
  return res.json() as Promise<T>;
}

/** jupyterFetch + { data: T } アンラップ。jupyter-server のレスポンスは常にこの形式。 */
async function jupyterFetchData<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await jupyterFetch<{ data: T }>(path, options);
  return res.data;
}

/**
 * POST を送り、ステータスチェックなしでレスポンスを返す（エラー系テスト用）。
 * レスポンスが JSON でない場合も安全にハンドリングする。
 */
async function rawPost(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await baseFetch(
    baseUrl,
    path,
    headers,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    false,
  );
  const text = await res.text();
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    return { status: res.status, body: json };
  } catch {
    return { status: res.status, body: { _raw: text } };
  }
}

// --- 型定義 ---
// E2E テスト専用の型定義。サーバー側の型（jupyter-mcp/src/jupyter-client/types.ts 等）と
// 意図的に独立させている（例: ExecuteResult は stdout/stderr を文字列に変換済み）。
// サーバー側パッケージへの依存を避けるため、テスト用に別途定義している。

// Document Server

export interface TableIndexItem {
  table_name: string;
  display_name: string;
  summary: string;
  category: string;
}

export interface TableColumn {
  name: string;
  type: string;
  description: string;
  nullable: boolean;
  key_type?: string;
  domain?: Record<string, unknown>;
  notes?: string;
  examples?: unknown[];
}

export interface TableDetailItem {
  table_name: string;
  display_name: string;
  description: string;
  data_source?: { type: string; table: string };
  columns: TableColumn[];
  statistics?: {
    row_count: number;
    date_range?: { from: string; to: string };
    update_frequency?: string;
  };
  notes_table_level?: string[];
}

export interface TermIndexItem {
  name: string;
  summary: string;
}

export interface TermDetailItem {
  name: string;
  aliases: string[];
  definition: string;
  related_terms?: string[];
  values?: Array<{ label: string; description: string }>;
}

export interface LogicIndexItem {
  logic_name: string;
  summary: string;
  category: string;
}

export interface LogicMetaItem {
  logic_name: string;
  description: string;
  file_path: string;
  language: string;
  usage_type: string;
  input_tables: string[];
  output_description: string;
  usage_context?: string;
  related_logic?: string[];
  notes?: string;
}

export interface LogicCodeData {
  logic_name: string;
  language: string;
  code: string;
  description?: string;
}

// Jupyter Server

export interface Workspace {
  workspace_id: string;
  name: string;
  path: string;
  data_path: string;
  output_path: string;
  created_at: string;
}

export interface Session {
  kernel_id: string;
  workspace_id: string;
  session_id: string;
  status: string;
  created_at: string;
}

export interface ExecuteResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error: { type: string; message: string } | null;
  execution_time_ms: number;
}

export interface SqlExecuteResult {
  success: boolean;
  file_path: string;
  row_count: number;
  columns: string[];
  file_size_bytes: number;
  execution_time_ms: number;
  truncated?: boolean;
}

// --- Document Server API ---

export function getTableIndex(): Promise<{
  tables: TableIndexItem[];
  total: number;
}> {
  return docFetchData('/catalog/index');
}

export function getTableDetail(tableNames: string[]): Promise<{
  tables: TableDetailItem[];
  not_found: string[];
}> {
  return docFetchData('/catalog/tables', {
    method: 'POST',
    body: JSON.stringify({ table_names: tableNames }),
  });
}

export function getTermIndex(): Promise<{
  terms: TermIndexItem[];
  total: number;
}> {
  return docFetchData('/glossary/index');
}

export function getTermDetail(termNames: string[]): Promise<{
  terms: TermDetailItem[];
  not_found: string[];
}> {
  return docFetchData('/glossary/terms', {
    method: 'POST',
    body: JSON.stringify({ term_names: termNames }),
  });
}

export function getLogicIndex(): Promise<{
  logic: LogicIndexItem[];
  total: number;
}> {
  return docFetchData('/logic/index');
}

export function getLogicDetail(logicNames: string[]): Promise<{
  logic: LogicMetaItem[];
  not_found: string[];
}> {
  return docFetchData('/logic/meta', {
    method: 'POST',
    body: JSON.stringify({ logic_names: logicNames }),
  });
}

export function getLogicCode(logicName: string): Promise<LogicCodeData> {
  return docFetchData(`/logic/code/${encodeURIComponent(logicName)}`);
}

// --- Jupyter Server API ---

export function createWorkspace(name: string): Promise<Workspace> {
  return jupyterFetchData('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function createSession(workspaceId: string): Promise<Session> {
  return jupyterFetchData('/api/custom/sessions', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
}

export async function executeCode(kernelId: string, code: string, timeout: number = 30): Promise<ExecuteResult> {
  const data = await jupyterFetchData<{
    success: boolean;
    outputs: Array<{ type: string; text: string }>;
    error: { type: string; message: string } | null;
    execution_time_ms: number;
  }>(`/api/kernels/${encodeURIComponent(kernelId)}/execute`, {
    method: 'POST',
    body: JSON.stringify({ code, timeout }),
    signal: AbortSignal.timeout(timeout * 1000 + 5000),
  });

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
    execution_time_ms: data.execution_time_ms,
  };
}

export function executeSql(
  workspaceId: string,
  sql: string,
  filename: string,
  options?: { timeout?: number; max_rows?: number },
): Promise<SqlExecuteResult> {
  return jupyterFetchData('/api/sql/execute', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: workspaceId,
      sql,
      filename,
      ...options,
    }),
  });
}

/** クリーンアップ用の DELETE リクエスト。失敗時は警告のみで例外を投げない。 */
async function safeJupyterDelete(path: string, resourceLabel: string): Promise<void> {
  try {
    await baseFetch(JUPYTER_SERVER_URL, path, JUPYTER_HEADERS, {
      method: 'DELETE',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`${resourceLabel}の削除に失敗: ${message}`);
  }
}

export const deleteSession = (sessionId: string): Promise<void> =>
  safeJupyterDelete(`/api/sessions/${encodeURIComponent(sessionId)}`, `セッション (${sessionId})`);

export const deleteWorkspace = (workspaceId: string): Promise<void> =>
  safeJupyterDelete(`/api/custom/contents/${encodeURIComponent(workspaceId)}`, `ワークスペース (${workspaceId})`);

// --- サービス起動確認 ---

export async function checkServices(): Promise<{
  document: boolean;
  jupyter: boolean;
}> {
  const healthCheck = (baseUrl: string, headers: Record<string, string>): Promise<boolean> =>
    baseFetch(baseUrl, '/health', headers)
      .then(() => true)
      .catch(() => false);

  const [document, jupyter] = await Promise.all([
    healthCheck(DOCUMENT_SERVER_URL, JSON_HEADERS),
    healthCheck(JUPYTER_SERVER_URL, JUPYTER_HEADERS),
  ]);

  return { document, jupyter };
}

// --- エラーレスポンス検証用 ---

export const docPost = (path: string, body: unknown) => rawPost(DOCUMENT_SERVER_URL, path, JSON_HEADERS, body);

export const jupyterPost = (path: string, body: unknown) => rawPost(JUPYTER_SERVER_URL, path, JUPYTER_HEADERS, body);
