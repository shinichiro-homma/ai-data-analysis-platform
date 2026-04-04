/**
 * Issue #3 修正の統合テスト
 *
 * execute_code のセル自動追加が3つの原因（resolveNotebookPath の kernel.id 未検索、
 * パス二重化、notebook_path なしセッションの紐付け不足）で機能しない問題の修正を検証する。
 *
 * 注意: セルの実際の永続化は postAiEvent の clients 数に依存する。
 * ブラウザが接続されている場合（clients > 0）、セルは SharedModel 経由で追加され、
 * REST API フォールバックはスキップされる。このテストではパス解決の正しさを検証する。
 */

import { describe, test, expect, afterEach } from 'vitest';
import { executeSessionCreate } from '../../src/tools/session-create.js';
import { executeNotebookCreate } from '../../src/tools/notebook-create.js';
import { executeExecuteCode } from '../../src/tools/execute-code.js';
import { resolveNotebookPath } from '../../src/utils/session-resolver.js';
import { jupyterClient } from '../../src/jupyter-client/client.js';
import { sessionNotebookStore } from '../../src/utils/session-notebook-store.js';
import { resetCellTracker } from '../../src/utils/notebook-cell-tracker.js';
import { parseToolCallResult, cleanupWorkspace, checkJupyterConnection } from '../setup.js';
import { resolveWorkspacePath } from '../../src/utils/workspace-path-store.js';

describe('Issue #3: execute_code のセル自動追加修正', () => {
  let workspaceId: string | undefined;
  let kernelId: string | undefined;

  afterEach(async () => {
    if (kernelId) {
      try {
        await jupyterClient.deleteKernel(kernelId);
      } catch {
        /* ignore */
      }
      kernelId = undefined;
    }
    if (workspaceId) {
      await cleanupWorkspace(workspaceId);
      workspaceId = undefined;
    }
    sessionNotebookStore.clear();
    resetCellTracker();
  });

  test('修正C: notebook_path なし session → notebook_create でストアに紐付けが保存される', async () => {
    await checkJupyterConnection();

    // 1. ワークスペース作成
    const wsResult = await jupyterClient.createWorkspace('issue3-test-store');
    workspaceId = wsResult.workspace_id;

    // 2. セッション作成（notebook_path なし）
    const sessionResult = parseToolCallResult(await executeSessionCreate({ workspace_id: workspaceId }));
    expect(sessionResult.success).toBe(true);
    const sessionId = sessionResult.session_id as string;
    kernelId = sessionResult.kernel_id as string;
    expect(sessionId).toBe(kernelId); // notebook_path なし → session_id === kernel_id

    // セッション作成時はストアに何も保存されない（notebook_path がないため）
    expect(sessionNotebookStore.get(sessionId)).toBeNull();

    // 3. ノートブック作成
    const nbResult = parseToolCallResult(
      await executeNotebookCreate({
        workspace_id: workspaceId,
        session_id: sessionId,
        name: 'test-store',
      }),
    );
    expect(nbResult.success).toBe(true);
    const notebookPath = nbResult.path as string;

    // ノートブック作成後、ストアに紐付けが保存されている
    expect(sessionNotebookStore.get(sessionId)).toBe(notebookPath);

    // 4. resolveNotebookPath がストア経由でパスを返す
    const resolvedPath = await resolveNotebookPath(sessionId);
    expect(resolvedPath).toBe(notebookPath);

    // 5. 解決されたパスで getContents が成功する
    const nb = await jupyterClient.getContents(resolvedPath!);
    expect(nb.type).toBe('notebook');

    // 6. 解決されたパスで operateCell（REST API フォールバック）が成功する
    await jupyterClient.operateCell(resolvedPath!, {
      action: 'add',
      cell: { cell_type: 'code', source: 'test_cell' },
    });
    const nbAfter = await jupyterClient.getContents(resolvedPath!);
    expect(nbAfter.content.cells.length).toBe(1);
    expect(nbAfter.content.cells[0].source).toBe('test_cell');
  }, 30000);

  test('修正C: session_create + notebook_path ありでストアに紐付けが保存される', async () => {
    await checkJupyterConnection();

    // 1. ワークスペース作成
    const wsResult = await jupyterClient.createWorkspace('issue3-test-store-nb');
    workspaceId = wsResult.workspace_id;

    // 2. ノートブック作成（先にファイルを作成）
    const wsPath = await resolveWorkspacePath(workspaceId);
    await jupyterClient.createNotebook(`${wsPath}/test-store-nb.ipynb`);

    // 3. セッション作成（notebook_path あり）
    const sessionResult = parseToolCallResult(
      await executeSessionCreate({
        workspace_id: workspaceId,
        notebook_path: 'test-store-nb.ipynb',
      }),
    );
    expect(sessionResult.success).toBe(true);

    const sessionId = sessionResult.session_id as string;
    kernelId = sessionResult.kernel_id as string;
    const returnedPath = sessionResult.notebook_path as string;

    // notebook_path あり → session_id !== kernel_id
    expect(sessionId).not.toBe(kernelId);

    // ストアに session_id → path と kernel_id → path の両方が保存されている
    expect(sessionNotebookStore.get(sessionId)).toBe(returnedPath);
    expect(sessionNotebookStore.get(kernelId)).toBe(returnedPath);
  }, 30000);

  test('修正A: kernel_id で resolveNotebookPath がセッションを見つけられる', async () => {
    await checkJupyterConnection();

    // 1. ワークスペース作成
    const wsResult = await jupyterClient.createWorkspace('issue3-test-kernel');
    workspaceId = wsResult.workspace_id;

    // 2. ノートブック作成
    const wsPath = await resolveWorkspacePath(workspaceId);
    await jupyterClient.createNotebook(`${wsPath}/test-kernel.ipynb`);

    // 3. セッション作成（notebook_path あり → Jupyter Session が作成される）
    const sessionResult = parseToolCallResult(
      await executeSessionCreate({
        workspace_id: workspaceId,
        notebook_path: 'test-kernel.ipynb',
      }),
    );
    expect(sessionResult.success).toBe(true);

    const sessionId = sessionResult.session_id as string;
    kernelId = sessionResult.kernel_id as string;
    expect(sessionId).not.toBe(kernelId);

    // 4. kernel_id で resolveNotebookPath を呼ぶ（修正A: kernel.id フォールバック検索）
    const resolvedPath = await resolveNotebookPath(kernelId);
    expect(resolvedPath).not.toBeNull();
    expect(resolvedPath).toContain('test-kernel.ipynb');

    // 5. kernel_id で execute_code が成功する
    const execResult = parseToolCallResult(
      await executeExecuteCode({
        session_id: kernelId,
        code: 'print("kernel resolve ok")',
      }),
    );
    expect(execResult.success).toBe(true);
    expect(execResult.stdout).toContain('kernel resolve ok');
  }, 30000);

  test('修正B: notebook_path にフルパスを渡してもパスが二重化しない', async () => {
    await checkJupyterConnection();

    // 1. ワークスペース作成
    const wsResult = await jupyterClient.createWorkspace('issue3-test-path-dup');
    workspaceId = wsResult.workspace_id;

    // 2. ノートブック作成
    const wsPath = await resolveWorkspacePath(workspaceId);
    const nbResult = await jupyterClient.createNotebook(`${wsPath}/test-path-dup.ipynb`);

    // 3. notebook_create のフルパスをそのまま notebook_path に渡す
    const nbPath = nbResult.path.startsWith('/') ? nbResult.path.slice(1) : nbResult.path;
    const sessionResult = parseToolCallResult(
      await executeSessionCreate({
        workspace_id: workspaceId,
        notebook_path: nbPath,
      }),
    );
    expect(sessionResult.success).toBe(true);

    // パスが二重化していないことを確認
    const returnedPath = sessionResult.notebook_path as string;
    expect(returnedPath).not.toContain(wsPath + '/workspaces/');
    expect(returnedPath).toBe(`${wsPath}/test-path-dup.ipynb`);

    kernelId = sessionResult.kernel_id as string;
  }, 30000);

  test('修正C + 実行: notebook_path なしフローで execute_code が成功する', async () => {
    await checkJupyterConnection();

    // 1. ワークスペース作成
    const wsResult = await jupyterClient.createWorkspace('issue3-test-exec');
    workspaceId = wsResult.workspace_id;

    // 2. セッション作成（notebook_path なし）
    const sessionResult = parseToolCallResult(await executeSessionCreate({ workspace_id: workspaceId }));
    expect(sessionResult.success).toBe(true);
    const sessionId = sessionResult.session_id as string;
    kernelId = sessionResult.kernel_id as string;

    // 3. ノートブック作成（ストアに紐付け保存）
    const nbResult = parseToolCallResult(
      await executeNotebookCreate({
        workspace_id: workspaceId,
        session_id: sessionId,
        name: 'test-exec',
      }),
    );
    expect(nbResult.success).toBe(true);

    // 4. execute_code が成功する（以前はここで resolveNotebookPath が null → セル追加スキップだった）
    const execResult = parseToolCallResult(
      await executeExecuteCode({
        session_id: sessionId,
        code: 'x = 42\nprint(x)',
      }),
    );
    expect(execResult.success).toBe(true);
    expect(execResult.stdout).toContain('42');

    // resolveNotebookPath がパスを返せるようになったことを確認（Issue #3 の根本原因の修正）
    const resolvedPath = await resolveNotebookPath(sessionId);
    expect(resolvedPath).not.toBeNull();
  }, 30000);
});
