/**
 * JupyterLab AI同期プラグイン
 */
import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';

import { INotebookTracker } from '@jupyterlab/notebook';

import { WebSocketClient } from './websocket-client';
import { NotebookUpdater } from './notebook-updater';
import { LockManager } from './lock-manager';

/**
 * プラグイン本体
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-ai-sync:plugin',
  autoStart: true,
  requires: [INotebookTracker],
  activate: (app: JupyterFrontEnd, notebookTracker: INotebookTracker) => {
    console.log('[AI Sync] JupyterLab AI Sync extension is activated!');

    // NotebookUpdater を初期化
    const updater = new NotebookUpdater(notebookTracker);

    // LockManager を初期化
    const lockManager = new LockManager(notebookTracker, app);
    updater.setLockManager(lockManager);

    // WebSocketクライアントを初期化
    const wsClient = new WebSocketClient(
      (event) => {
        updater.handleEvent(event);
      },
      () => {
        // WebSocket 切断時に全ノートブックのロックを解除
        lockManager.unlockAll();
      },
    );

    // 接続を開始
    wsClient.connect();

    console.log('[AI Sync] WebSocket client initialized with LockManager');
  },
};

export default plugin;
