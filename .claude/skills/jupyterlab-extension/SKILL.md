---
name: jupyterlab-extension
description: JupyterLab 4.xフロントエンド拡張（jupyterlab-ai-sync）を開発する際のAPI・ビルドシステム・注意点を扱う。
---

# JupyterLab 4.x Extension Development

JupyterLab 4.x フロントエンド拡張の開発パターン。本プロジェクトの `jupyterlab-ai-sync` で確立されたパターンを基に、JupyterLab 固有の API・ビルドシステム・注意点をまとめる。

## プラグイン定義

```typescript
import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { INotebookTracker } from '@jupyterlab/notebook';

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'extension-name:plugin',
  autoStart: true,                    // 自動起動
  requires: [INotebookTracker],       // DI でサービスを注入
  activate: (app: JupyterFrontEnd, notebookTracker: INotebookTracker) => {
    // 初期化処理
  }
};

export default plugin;
```

### エントリーポイント（index.ts）

```typescript
import plugin from './plugin';
export default plugin;
```

## ノートブック操作

### セルの挿入

JupyterLab 4.x では `sharedModel.insertCell()` を使用する。

```typescript
import { ISharedCodeCell } from '@jupyter/ydoc';

const sharedModel = notebookModel.sharedModel;
sharedModel.insertCell(index, {
  cell_type: 'code',  // 'code' | 'markdown'
  source: 'print("hello")',
  metadata: {}
});
```

### デフォルト空セル問題（重要）

JupyterLab は空のノートブックを開くとデフォルトで空のコードセルを1つ追加する。この空セルは SharedModel にのみ存在し（ディスク上には存在しない）、外部クライアントのセルインデックスとブラウザのインデックスがずれる原因になる。

**対処法:** 最初のセル追加時にデフォルト空セルを検出して置換する。

```typescript
if (sharedModel.cells.length === 1) {
  const existingCell = sharedModel.getCell(0);
  if (existingCell && existingCell.source.trim() === '' && existingCell.cell_type === 'code') {
    sharedModel.deleteCell(0);
    sharedModel.insertCell(0, { cell_type, source, metadata: {} });
    return;  // 通常の挿入処理をスキップ
  }
}
```

### セル出力の追加

```typescript
import { IOutput, IMimeBundle } from '@jupyterlab/nbformat';
import { CodeCell } from '@jupyterlab/cells';

const codeCellWidget = notebook.widgets[cellIndex] as CodeCell;
const outputArea = codeCellWidget.outputArea;

// OutputArea.model に直接追加（これがUI更新をトリガーする）
// JupyterLab 4.x では outputArea.model は SharedModel と双方向同期しているため、
// add() だけで SharedModel も自動的に更新される。明示的な setOutputs() は不要。
outputArea.model.add(output);
```

### execution_count の二重更新（重要）

execution_count は **セルウィジェット** と **SharedModel** の両方に設定する必要がある。一方だけではファイル保存時に不整合が生じる。

```typescript
// 1. セルウィジェット経由
codeCellWidget.model.executionCount = executionCount;

// 2. SharedModel にも反映（ファイル保存時の整合性維持のため）
const sharedCodeCell = model.sharedModel.getCell(cellIndex) as ISharedCodeCell;
sharedCodeCell.execution_count = executionCount;
```

### セルのアクティブ化とスクロール

```typescript
notebook.activeCellIndex = cellIndex;
notebook.scrollToItem(cellIndex);
```

### 出力のクリア

```typescript
codeCellWidget.outputArea.model.clear();
codeCellWidget.model.executionCount = null;  // [*] 表示（実行中）
codeCellWidget.model.trusted = true;         // リッチ出力を表示するために必要
```

## ノートブック検索

`INotebookTracker` で開いているノートブックを検索する。

```typescript
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';

function findNotebookByPath(
  notebookTracker: INotebookTracker,
  path: string
): NotebookPanel | null {
  // まず currentWidget をチェック（高速）
  const current = notebookTracker.currentWidget;
  if (current && current.context.path === path) {
    return current;
  }
  // フォールバック: find() で全ノートブックを探索
  return notebookTracker.find(w => w.context.path === path) || null;
}
```

**注意:** `context.path` と比較する際はパス正規化が必須（先頭スラッシュ除去、末尾 `.ipynb` 確認など）。

## ロック制御

### セルエディタの read-only 化

```typescript
const widgets = notebook.widgets;
for (const widget of widgets) {
  const editor = widget.editor;
  if (editor) {
    editor.setOption('readOnly', true);
  }
}
```

### 新規セル追加時の自動 read-only 適用

ロック中に新しいセルが追加された場合も read-only にするため、SharedModel の changed シグナルを監視する。

```typescript
const sharedModel = model.sharedModel;
const callback = () => {
  for (const widget of notebook.widgets) {
    const editor = widget.editor;
    if (editor && !editor.getOption('readOnly')) {
      editor.setOption('readOnly', true);
    }
  }
};
sharedModel.changed.connect(callback);

// アンロック時に切断
sharedModel.changed.disconnect(callback);
```

## ツールバーへのウィジェット追加

```typescript
import { Widget } from '@lumino/widgets';

class LockIndicator extends Widget {
  constructor() {
    super();
    this.addClass('jp-ai-lock-indicator');
    this.node.innerHTML = `<div class="jp-ai-lock-banner">...</div>`;
  }
}

// ツールバーに追加
notebookPanel.toolbar.addItem('ai-lock-indicator', indicator);

// 削除時
indicator.dispose();
```

## WebSocket クライアント

### URL の構築

```typescript
import { ServerConnection } from '@jupyterlab/services';
import { PageConfig } from '@jupyterlab/coreutils';

const settings = ServerConnection.makeSettings();
const baseUrl = settings.wsUrl;        // ws:// or wss:// を自動判定
const token = PageConfig.getToken();   // 認証トークン取得
const url = `${baseUrl}api/ai/events?token=${token}`;
```

### 自動再接続パターン

```typescript
const RECONNECT_INTERVAL_MS = 5000;

class WebSocketClient {
  private reconnectTimer: number | null = null;

  connect(): void {
    this.ws = new WebSocket(this.url);
    this.ws.onclose = () => {
      this.onDisconnect?.();      // 切断時コールバック（ロック解除等）
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_INTERVAL_MS);
  }
}
```

## package.json の必須設定

```json
{
  "jupyterlab": {
    "extension": true,
    "outputDir": "extension-name/labextension",
    "schemaDir": "schema"
  },
  "dependencies": {
    "@jupyterlab/application": "^4.0.0",
    "@jupyterlab/cells": "^4.0.0",
    "@jupyterlab/notebook": "^4.0.0",
    "@jupyterlab/nbformat": "^4.0.0",
    "@jupyterlab/services": "^7.0.0",
    "@lumino/widgets": "^2.0.0"
  },
  "devDependencies": {
    "typescript": "~5.0.0",
    "@jupyterlab/builder": "^4.0.0"
  },
  "sideEffects": ["style/*.css"],
  "styleModule": "style/index.css"
}
```

## ビルドとインストール

```bash
# 開発モード（ソース変更時に自動反映）
jupyter labextension develop . --overwrite

# 本番インストール（Docker等）
pip install .

# ビルドのみ
npm run build   # tsc && jupyter labextension build .
```

## Tornado の WS/HTTP 競合（jupyter-server 側）

Tornado では同一パスで WebSocketHandler と通常の RequestHandler を共存させることが困難。そのため:

- `WS /api/ai/events` → WebSocket 接続用
- `POST /api/ai/events/broadcast` → イベント送信用（`/broadcast` サブパスで分離）

## チェックリスト

- [ ] `JupyterFrontEndPlugin<void>` で `autoStart: true` を設定したか
- [ ] `requires` で必要な DI トークンを注入したか
- [ ] デフォルト空セル問題を処理したか
- [ ] `execution_count` をウィジェットと SharedModel の両方に設定したか
- [ ] ロック時に `sharedModel.changed.connect()` で新規セルを監視しているか
- [ ] アンロック時に `disconnect()` でシグナル監視を解除しているか
- [ ] WebSocket 切断時に全ロックを解除しているか
- [ ] package.json に `jupyterlab` フィールドがあるか
- [ ] `sideEffects` に CSS を指定したか
