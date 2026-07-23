/**
 * JupyterLab AI同期プラグイン
 */
import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';

import { INotebookTracker } from '@jupyterlab/notebook';
import { IDocumentManager } from '@jupyterlab/docmanager';

import { WebSocketClient } from './websocket-client';
import { NotebookUpdater } from './notebook-updater';
import { LockManager } from './lock-manager';

/**
 * プラグイン本体
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-ai-sync:plugin',
  autoStart: true,
  requires: [INotebookTracker, IDocumentManager],
  activate: (app: JupyterFrontEnd, notebookTracker: INotebookTracker, docManager: IDocumentManager) => {
    console.log('[AI Sync] JupyterLab AI Sync extension is activated!');

    // NotebookUpdater を初期化（IDocumentManager を渡す）
    const updater = new NotebookUpdater(notebookTracker, docManager);

    // LockManager を初期化
    const lockManager = new LockManager(notebookTracker, app);
    updater.setLockManager(lockManager);

    // 保存完了フックを設定（自己エコー revert 防止）
    updater.setupSaveHook();

    // WebSocketクライアントを初期化
    const wsClient = new WebSocketClient(
      (event) => {
        updater.handleEvent(event);
      },
      () => {
        // WebSocket 切断時に全ノートブックのロックを解除
        lockManager.unlockAll();
      },
      () => {
        // WebSocket 接続/再接続時に再同期（resync は冪等）
        void updater.resync();
      },
    );

    // 接続を開始
    wsClient.connect();

    // シェル破棄時にリソースをクリーンアップ
    app.shell.disposed.connect(() => {
      wsClient.dispose();
      updater.dispose();
    });

    console.log('[AI Sync] WebSocket client initialized with LockManager');
  },
};

export default plugin;
