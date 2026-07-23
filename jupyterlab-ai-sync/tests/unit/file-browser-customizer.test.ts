import { describe, test, expect, vi } from 'vitest';

// file-browser-customizer.ts が JupyterLab モジュールを import するため、
// DOM 不要なテスト環境向けにモックして依存を回避する
vi.mock('@jupyterlab/application', () => ({
  JupyterFrontEnd: class {},
  JupyterFrontEndPlugin: class {},
}));
vi.mock('@jupyterlab/filebrowser', () => ({
  IDefaultFileBrowser: Symbol('IDefaultFileBrowser'),
}));

import { buildItemPath, buildItemsCache, resolveClickedItem, sortItems } from '../../src/file-browser-customizer';

describe('buildItemPath', () => {
  test('ルート直下のアイテムは名前のみを返す', () => {
    // Arrange & Act
    const result = buildItemPath('', 'notebook.ipynb');

    // Assert
    expect(result).toBe('notebook.ipynb');
  });

  test('ネストされたパスではディレクトリと名前を / で結合する', () => {
    // Arrange & Act
    const result = buildItemPath('project/data', 'sales.csv');

    // Assert
    expect(result).toBe('project/data/sales.csv');
  });

  test('1階層のディレクトリ配下のアイテム', () => {
    // Arrange & Act
    const result = buildItemPath('documents', 'report.ipynb');

    // Assert
    expect(result).toBe('documents/report.ipynb');
  });
});

describe('buildItemsCache', () => {
  test('Contents.IModel 配列から Map<string, { type: string }> を構築する', () => {
    // Arrange
    const items = [
      { name: 'data', type: 'directory' },
      { name: 'analysis.ipynb', type: 'notebook' },
      { name: 'readme.md', type: 'file' },
    ];

    // Act
    const cache = buildItemsCache(items);

    // Assert
    expect(cache).toBeInstanceOf(Map);
    expect(cache.size).toBe(3);
    expect(cache.get('data')).toEqual({ type: 'directory' });
    expect(cache.get('analysis.ipynb')).toEqual({ type: 'notebook' });
    expect(cache.get('readme.md')).toEqual({ type: 'file' });
  });

  test('空配列では空の Map を返す', () => {
    // Arrange & Act
    const cache = buildItemsCache([]);

    // Assert
    expect(cache).toBeInstanceOf(Map);
    expect(cache.size).toBe(0);
  });

  test('同名アイテムがある場合は後のエントリが優先される', () => {
    // Arrange
    const items = [
      { name: 'data', type: 'directory' },
      { name: 'data', type: 'file' },
    ];

    // Act
    const cache = buildItemsCache(items);

    // Assert
    expect(cache.get('data')).toEqual({ type: 'file' });
  });
});

describe('resolveClickedItem', () => {
  test('正常系: フォルダアイテムを解決できる', () => {
    // Arrange
    const cache = new Map<string, { type: string }>([
      ['data', { type: 'directory' }],
      ['analysis.ipynb', { type: 'notebook' }],
    ]);
    const itemName = 'data';

    // Act
    const result = resolveClickedItem(itemName, cache);

    // Assert
    expect(result).not.toBeNull();
    expect(result!.name).toBe('data');
    expect(result!.isDirectory).toBe(true);
  });

  test('正常系: ファイルアイテムを解決できる', () => {
    // Arrange
    const cache = new Map<string, { type: string }>([
      ['data', { type: 'directory' }],
      ['analysis.ipynb', { type: 'notebook' }],
    ]);
    const itemName = 'analysis.ipynb';

    // Act
    const result = resolveClickedItem(itemName, cache);

    // Assert
    expect(result).not.toBeNull();
    expect(result!.name).toBe('analysis.ipynb');
    expect(result!.isDirectory).toBe(false);
  });

  test('異常系: アイテム名が null の場合は null を返す', () => {
    // Arrange
    const cache = new Map<string, { type: string }>([['data', { type: 'directory' }]]);

    // Act
    const result = resolveClickedItem(null, cache);

    // Assert
    expect(result).toBeNull();
  });

  test('異常系: キャッシュにアイテムが存在しない場合は null を返す', () => {
    // Arrange
    const cache = new Map<string, { type: string }>([['data', { type: 'directory' }]]);
    const itemName = 'nonexistent.ipynb';

    // Act
    const result = resolveClickedItem(itemName, cache);

    // Assert
    expect(result).toBeNull();
  });

  test('異常系: キャッシュが空の場合は null を返す', () => {
    // Arrange
    const cache = new Map<string, { type: string }>();
    const itemName = 'data';

    // Act
    const result = resolveClickedItem(itemName, cache);

    // Assert
    expect(result).toBeNull();
  });
});

describe('sortItems', () => {
  test('フォルダがファイルより先に並ぶ', () => {
    // Arrange
    const items = [
      { name: 'script.py', type: 'file' },
      { name: 'data', type: 'directory' },
      { name: 'readme.md', type: 'file' },
      { name: 'src', type: 'directory' },
    ];

    // Act
    const sorted = sortItems(items);

    // Assert
    expect(sorted[0].name).toBe('data');
    expect(sorted[1].name).toBe('src');
    expect(sorted[2].name).toBe('readme.md');
    expect(sorted[3].name).toBe('script.py');
  });

  test('同じ種別内では名前のアルファベット順にソートされる', () => {
    // Arrange
    const items = [
      { name: 'zebra', type: 'directory' },
      { name: 'alpha', type: 'directory' },
      { name: 'middle', type: 'directory' },
    ];

    // Act
    const sorted = sortItems(items);

    // Assert
    expect(sorted[0].name).toBe('alpha');
    expect(sorted[1].name).toBe('middle');
    expect(sorted[2].name).toBe('zebra');
  });

  test('空配列では空配列を返す', () => {
    // Arrange & Act
    const sorted = sortItems([]);

    // Assert
    expect(sorted).toEqual([]);
  });

  test('元の配列を変更しない', () => {
    // Arrange
    const items = [
      { name: 'b.py', type: 'file' },
      { name: 'a', type: 'directory' },
    ];
    const original = [...items];

    // Act
    sortItems(items);

    // Assert
    expect(items).toEqual(original);
  });
});
