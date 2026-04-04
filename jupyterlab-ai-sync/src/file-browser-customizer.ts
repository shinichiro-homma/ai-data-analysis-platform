/**
 * ファイルブラウザUI改善プラグイン
 *
 * フォルダのシングルクリック時にツリー展開、ダブルクリック時にフォルダ移動を行う。
 */
import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import type { FileBrowser } from '@jupyterlab/filebrowser';
import type { Contents } from '@jupyterlab/services';

/** インデント幅 (px) */
const INDENT_PX = 16;

/** ダブルクリック判定タイムアウト (ms) */
const DBLCLICK_TIMEOUT_MS = 250;

/**
 * DOM 要素からアイテム名を取得する。
 * JupyterLab 4.x の DirListing ではテキスト要素にアイテム名が表示される。
 */
function getItemName(itemEl: Element): string | null {
  const textEl = itemEl.querySelector('.jp-DirListing-itemText');
  return textEl?.textContent?.trim() ?? null;
}

/**
 * アイテム名と現在のディレクトリパスからフルパスを構築する。
 */
function buildItemPath(currentDir: string, itemName: string): string {
  return currentDir ? `${currentDir}/${itemName}` : itemName;
}

/**
 * DOM 要素がフォルダかどうかを判定する。
 */
function isDirectory(itemEl: Element): boolean {
  return itemEl.getAttribute('data-isdir') === 'true';
}

/**
 * クリックターゲットがツリーアイテム内にあるかどうかを判定する。
 * ツリー内のクリックは親の DirListing ハンドラで処理しない。
 */
function isInsideTreeItem(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('.jp-fb-tree-item') !== null;
}

/**
 * クリックターゲットから最も近い jp-DirListing-item 要素を返す。
 */
function findListingItem(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest('.jp-DirListing-item');
}

/**
 * ツリーアイテム行 (div.jp-fb-tree-item) を生成する。
 */
function createTreeItemEl(
  name: string,
  isDir: boolean,
  path: string,
  level: number
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'jp-fb-tree-item';
  row.setAttribute('data-path', path);
  row.setAttribute('data-isdir', String(isDir));
  row.style.paddingLeft = `${level * INDENT_PX + 24}px`;

  // 展開矢印アイコン（フォルダのみ）
  const expandIcon = document.createElement('span');
  expandIcon.className = 'jp-fb-tree-expand-icon';
  expandIcon.textContent = isDir ? '▶' : '';
  row.appendChild(expandIcon);

  // ファイル/フォルダアイコン
  const typeIcon = document.createElement('span');
  typeIcon.className = isDir ? 'jp-fb-tree-folder-icon' : 'jp-fb-tree-file-icon';
  typeIcon.textContent = isDir ? '📁' : '📄';
  row.appendChild(typeIcon);

  // 名前
  const nameEl = document.createElement('span');
  nameEl.className = 'jp-fb-tree-name';
  nameEl.textContent = name;
  row.appendChild(nameEl);

  return row;
}

/**
 * 展開アイコンの表示状態を更新する。
 */
function setExpandIconState(itemEl: Element, expanded: boolean): void {
  const expandIcon = itemEl.querySelector('.jp-fb-tree-expand-icon');
  if (!expandIcon) return;
  if (expanded) {
    expandIcon.classList.add('jp-fb-tree-expand-icon--open');
  } else {
    expandIcon.classList.remove('jp-fb-tree-expand-icon--open');
  }
}

/**
 * 指定パスの子アイテム DOM を取得または作成し、フォルダ行の直後に挿入する。
 * childContainers は呼び出し元スコープのクロージャとして注入される。
 */
function makeToggleTreeExpansion(
  expandedPaths: Map<string, boolean>,
  childContainers: Map<string, HTMLElement>,
  navigateToFolder: (path: string) => void
) {
  /** ツリー内のダブルクリック判定用タイマー */
  let treeClickTimer: ReturnType<typeof setTimeout> | null = null;
  let treeClickPath: string | null = null;

  function cancelTreeClick(): void {
    if (treeClickTimer !== null) {
      clearTimeout(treeClickTimer);
      treeClickTimer = null;
      treeClickPath = null;
    }
  }

  async function toggleTreeExpansion(
    itemEl: Element,
    path: string,
    contentsManager: Contents.IManager,
    level: number
  ): Promise<void> {
    // Map から既存の子コンテナを探す（DOM 検索ではなく Map で管理）
    const existingContainer = childContainers.get(path);

    if (existingContainer) {
      // 既に展開済み → 折りたたむ / 再表示
      const isExpanded = expandedPaths.get(path) === true;
      if (isExpanded) {
        existingContainer.style.display = 'none';
        expandedPaths.set(path, false);
        setExpandIconState(itemEl, false);
      } else {
        existingContainer.style.display = '';
        expandedPaths.set(path, true);
        setExpandIconState(itemEl, true);
      }
      return;
    }

    // 初回展開: API でフォルダ内容を取得
    let items: Array<{ name: string; path: string; type: string }> = [];
    try {
      const result = await contentsManager.get(path, { content: true });
      if (!Array.isArray(result.content)) return;
      items = result.content as Array<{ name: string; path: string; type: string }>;
    } catch (e) {
      console.warn(`[FileBrowser] Failed to list ${path}:`, e);
      return;
    }

    // 子コンテナを生成してフォルダ行の直後に挿入
    const childContainer = document.createElement('div');
    childContainer.className = `jp-fb-tree-children jp-fb-tree-level-${level}`;

    // ソート: フォルダを先に、名前順
    items.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });

    for (const item of items) {
      const isDir = item.type === 'directory';
      const row = createTreeItemEl(item.name, isDir, item.path, level);
      childContainer.appendChild(row);
    }

    // フォルダ行の直後に挿入
    itemEl.insertAdjacentElement('afterend', childContainer);
    expandedPaths.set(path, true);
    childContainers.set(path, childContainer);

    // 矢印を開いた状態にする
    setExpandIconState(itemEl, true);

    // 子フォルダへのクリック: シングル=展開、ダブル=フォルダ移動
    childContainer.addEventListener('click', (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      const rowEl = e.target.closest('.jp-fb-tree-item');
      if (!rowEl) return;
      const childPath = rowEl.getAttribute('data-path');
      const childIsDir = rowEl.getAttribute('data-isdir') === 'true';
      if (!childPath || !childIsDir) return;
      e.stopPropagation();
      e.preventDefault();

      // ダブルクリック判定: 同じパスへの連続クリック
      if (treeClickTimer !== null && treeClickPath === childPath) {
        cancelTreeClick();
        navigateToFolder(childPath);
        return;
      }

      // シングルクリック: タイマーを設定してツリー展開を遅延実行
      cancelTreeClick();
      treeClickPath = childPath;
      treeClickTimer = setTimeout(() => {
        treeClickTimer = null;
        treeClickPath = null;
        void toggleTreeExpansion(rowEl, childPath, contentsManager, level + 1);
      }, DBLCLICK_TIMEOUT_MS);
    });

    // ダブルクリックイベントでもフォルダ移動を処理
    childContainer.addEventListener('dblclick', (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      const rowEl = e.target.closest('.jp-fb-tree-item');
      if (!rowEl) return;
      const childPath = rowEl.getAttribute('data-path');
      const childIsDir = rowEl.getAttribute('data-isdir') === 'true';
      if (!childPath || !childIsDir) return;
      e.stopPropagation();
      e.preventDefault();
      cancelTreeClick();
      navigateToFolder(childPath);
    });
  }

  return { toggleTreeExpansion, cancelTreeClick };
}

/**
 * ファイルブラウザカスタマイザプラグイン
 */
const fileBrowserPlugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-ai-sync:file-browser',
  autoStart: true,
  requires: [IDefaultFileBrowser],
  activate: (app: JupyterFrontEnd, browser: FileBrowser) => {
    console.log('[FileBrowser] File browser customizer activated');
    const contentsManager = app.serviceManager.contents;

    /** ツリー展開状態: パス -> 展開中かどうか */
    const expandedPaths = new Map<string, boolean>();

    /** 子コンテナの参照: パス -> DOM 要素 */
    const childContainers = new Map<string, HTMLElement>();

    /** シングルクリックタイマー */
    let clickTimer: ReturnType<typeof setTimeout> | null = null;

    /** シングルクリックタイマーをキャンセルする */
    function cancelPendingClick(): void {
      if (clickTimer !== null) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
    }

    /** ツリー内のフォルダをダブルクリックした時にフォルダ移動を実行する */
    function navigateToFolder(fullPath: string): void {
      void browser.model.cd('/' + fullPath);
    }

    const { toggleTreeExpansion, cancelTreeClick } = makeToggleTreeExpansion(
      expandedPaths,
      childContainers,
      navigateToFolder
    );

    const clickHandler = (e: MouseEvent) => {
      // ツリーアイテム内のクリックは無視（子コンテナのリスナーで処理）
      if (isInsideTreeItem(e.target)) return;

      const itemEl = findListingItem(e.target);
      if (!itemEl) return;
      if (!isDirectory(itemEl)) return; // ファイルは介入しない

      const itemName = getItemName(itemEl);
      if (!itemName) return;
      const path = buildItemPath(browser.model.path, itemName);

      // デフォルトのフォルダ移動を抑制
      e.preventDefault();
      e.stopPropagation();

      // ダブルクリック判定
      if (clickTimer !== null) {
        // ダブルクリック検出: タイマーをクリアして標準移動を実行
        cancelPendingClick();
        // JupyterLab のデフォルト cd 動作: model.cd() は相対パスを受け取る
        void browser.model.cd(itemName);
        return;
      }

      // シングルクリック: タイマーを設定してツリー展開を遅延実行
      clickTimer = setTimeout(() => {
        clickTimer = null;
        void toggleTreeExpansion(itemEl, path, contentsManager, 1);
      }, DBLCLICK_TIMEOUT_MS);
    };

    const dblclickHandler = (e: MouseEvent) => {
      // ツリーアイテム内のダブルクリックは無視
      if (isInsideTreeItem(e.target)) return;

      const itemEl = findListingItem(e.target);
      if (!itemEl) return;
      if (!isDirectory(itemEl)) return;

      const itemName = getItemName(itemEl);
      if (!itemName) return;
      const path = buildItemPath(browser.model.path, itemName);

      // シングルクリックタイマーをキャンセル
      cancelPendingClick();

      // デフォルト動作を抑制し、cd を直接実行（相対パス）
      e.preventDefault();
      e.stopPropagation();
      void browser.model.cd(itemName);
    };

    // DirListing の DOM ノードにキャプチャフェーズでイベントリスナーを追加
    browser.node.addEventListener('click', clickHandler, true);
    browser.node.addEventListener('dblclick', dblclickHandler, true);

    // ディレクトリ変更時にツリー展開状態をクリア
    browser.model.pathChanged.connect(() => {
      expandedPaths.clear();
      childContainers.forEach((container) => container.remove());
      childContainers.clear();
    });

    // ブラウザ破棄時にイベントリスナーをクリーンアップ
    browser.disposed.connect(() => {
      browser.node.removeEventListener('click', clickHandler, true);
      browser.node.removeEventListener('dblclick', dblclickHandler, true);
      cancelPendingClick();
      cancelTreeClick();
    });

    console.log('[FileBrowser] Click handlers registered on default browser');
  },
};

export default fileBrowserPlugin;
