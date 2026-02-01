/**
 * ノートブック操作の結合テスト
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import { jupyterClient } from '../../src/jupyter-client/client.js';
import {
  generateTestNotebookName,
  cleanupNotebook,
  checkJupyterConnection,
} from '../setup.js';

describe('ノートブック基本操作の結合テスト', () => {
  const testNotebooks: string[] = [];

  beforeAll(async () => {
    // Jupyter サーバーの接続確認
    await checkJupyterConnection();
  });

  afterEach(async () => {
    // テスト後のクリーンアップ
    for (const notebookPath of testNotebooks) {
      await cleanupNotebook(notebookPath);
    }
    testNotebooks.length = 0;
  });

  test('ノートブックを作成し、code セルを追加できる', async () => {
    const notebookName = generateTestNotebookName('create-and-add-code-cell');
    const notebookPath = `${notebookName}.ipynb`;
    testNotebooks.push(notebookPath);

    // 1. ノートブック作成
    const createResult = await handleToolCall('notebook_create', {
      name: notebookName,
    });

    // 2. 作成成功を確認
    const createData = JSON.parse(createResult.content[0].text);
    expect(createData.success).toBe(true);
    expect(createData.path).toBe(`/${notebookPath}`);

    // 3. code セルを追加
    const addCellResult = await handleToolCall('notebook_add_cell', {
      notebook_path: notebookPath,
      cell_type: 'code',
      source: 'print("Hello from integration test")',
    });

    // 4. 追加成功を確認
    const addCellData = JSON.parse(addCellResult.content[0].text);
    expect(addCellData.success).toBe(true);

    // 5. ノートブックの内容を取得して検証
    const notebook = await jupyterClient.getContents(notebookPath);
    expect(notebook.content.cells.length).toBeGreaterThan(0);

    const lastCell = notebook.content.cells[notebook.content.cells.length - 1];
    expect(lastCell.cell_type).toBe('code');
    expect(lastCell.source).toContain('Hello from integration test');
  });

  test('ノートブックを作成し、markdown セルを追加できる', async () => {
    const notebookName = generateTestNotebookName('create-and-add-markdown-cell');
    const notebookPath = `${notebookName}.ipynb`;
    testNotebooks.push(notebookPath);

    // 1. ノートブック作成
    const createResult = await handleToolCall('notebook_create', {
      name: notebookName,
    });

    const createData = JSON.parse(createResult.content[0].text);
    expect(createData.success).toBe(true);

    // 2. markdown セルを追加
    const addCellResult = await handleToolCall('notebook_add_cell', {
      notebook_path: notebookPath,
      cell_type: 'markdown',
      source: '# Test Heading\n\nThis is a test markdown cell.',
    });

    const addCellData = JSON.parse(addCellResult.content[0].text);
    expect(addCellData.success).toBe(true);

    // 3. ノートブックの内容を検証
    const notebook = await jupyterClient.getContents(notebookPath);
    const lastCell = notebook.content.cells[notebook.content.cells.length - 1];

    expect(lastCell.cell_type).toBe('markdown');
    expect(lastCell.source).toContain('# Test Heading');
    expect(lastCell.source).toContain('This is a test markdown cell.');
  });

  test('複数のセルを追加し、position 指定で先頭に挿入できる', async () => {
    const notebookName = generateTestNotebookName('multi-cell-with-position');
    const notebookPath = `${notebookName}.ipynb`;
    testNotebooks.push(notebookPath);

    // 1. ノートブック作成
    await handleToolCall('notebook_create', { name: notebookName });

    // 2. 末尾に 2 つセルを追加
    await handleToolCall('notebook_add_cell', {
      notebook_path: notebookPath,
      cell_type: 'code',
      source: 'first_cell = 1',
    });

    await handleToolCall('notebook_add_cell', {
      notebook_path: notebookPath,
      cell_type: 'code',
      source: 'second_cell = 2',
    });

    // 3. position=0 で先頭に挿入
    const insertResult = await handleToolCall('notebook_add_cell', {
      notebook_path: notebookPath,
      cell_type: 'markdown',
      source: '# Title',
      position: 0,
    });

    const insertData = JSON.parse(insertResult.content[0].text);
    expect(insertData.success).toBe(true);

    // 4. セルの順序を確認
    const notebook = await jupyterClient.getContents(notebookPath);
    expect(notebook.content.cells.length).toBe(3);

    expect(notebook.content.cells[0].cell_type).toBe('markdown');
    expect(notebook.content.cells[0].source).toContain('# Title');

    expect(notebook.content.cells[1].cell_type).toBe('code');
    expect(notebook.content.cells[1].source).toContain('first_cell = 1');

    expect(notebook.content.cells[2].cell_type).toBe('code');
    expect(notebook.content.cells[2].source).toContain('second_cell = 2');
  });

  test('ノートブック作成→複数セル追加の一連フローが動作する', async () => {
    const notebookName = generateTestNotebookName('complete-flow');
    const notebookPath = `${notebookName}.ipynb`;
    testNotebooks.push(notebookPath);

    // 1. ノートブック作成
    const createResult = await handleToolCall('notebook_create', {
      name: notebookName,
    });
    expect(JSON.parse(createResult.content[0].text).success).toBe(true);

    // 2. タイトルセルを追加
    await handleToolCall('notebook_add_cell', {
      notebook_path: notebookPath,
      cell_type: 'markdown',
      source: '# Data Analysis\n\nThis notebook demonstrates data analysis workflow.',
    });

    // 3. インポートセルを追加
    await handleToolCall('notebook_add_cell', {
      notebook_path: notebookPath,
      cell_type: 'code',
      source: 'import pandas as pd\nimport numpy as np',
    });

    // 4. データ作成セルを追加
    await handleToolCall('notebook_add_cell', {
      notebook_path: notebookPath,
      cell_type: 'code',
      source: 'df = pd.DataFrame({"A": [1, 2, 3], "B": [4, 5, 6]})',
    });

    // 5. 説明セルを追加
    await handleToolCall('notebook_add_cell', {
      notebook_path: notebookPath,
      cell_type: 'markdown',
      source: '## Results\n\nThe analysis results are shown below.',
    });

    // 6. 全体の構成を検証
    const notebook = await jupyterClient.getContents(notebookPath);
    const cells = notebook.content.cells;

    expect(cells.length).toBe(4);
    expect(cells[0].cell_type).toBe('markdown');
    expect(cells[1].cell_type).toBe('code');
    expect(cells[2].cell_type).toBe('code');
    expect(cells[3].cell_type).toBe('markdown');

    // 各セルの内容を確認
    expect(cells[0].source).toContain('# Data Analysis');
    expect(cells[1].source).toContain('import pandas');
    expect(cells[2].source).toContain('pd.DataFrame');
    expect(cells[3].source).toContain('## Results');
  });
});
