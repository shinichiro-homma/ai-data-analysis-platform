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
 * JupyterLab 4.x 非公開セレクタ: DirListing のアイテム要素。
 * DOM 構造が変わった場合は findListingItem が null を返し、標準動作にフォールバックする。
 */
const LISTING_ITEM_SELECTOR = '.jp-DirListing-item';

/**
 * JupyterLab 4.x 非公開セレクタ: DirListing のアイテム名テキスト要素。
 * DirListing-item の子要素にはアイコン・名前・更新日時・サイズが混在し、
 * textContent ベースでは名前のみの分離が困難なため、セレクタによる取得を維持する。
 * フォールバック: セレクタでヒットしない場合は null を返し標準動作に委譲する。
 */
const LISTING_ITEM_TEXT_SELECTOR = '.jp-DirListing-itemText';

const DIRECTORY_TYPE = 'directory';

type ItemsCacheEntry = { type: string };
type ItemsCache = Map<string, ItemsCacheEntry>;

// --- 純粋関数（export / テスト対象） ---

/**
 * アイテム名と現在のディレクトリパスからフルパスを構築する。
 */
export function buildItemPath(currentDir: string, itemName: string): string {
  return currentDir ? `${currentDir}/${itemName}` : itemName;
}

/**
 * Contents.IModel 配列からアイテム名をキー、type を値とするキャッシュを構築する。
 * 同名アイテムがある場合は後のエントリが優先される。
 */
export function buildItemsCache(items: Array<{ name: string; type: string }>): ItemsCache {
  const cache: ItemsCache = new Map();
  for (const item of items) {
    cache.set(item.name, { type: item.type });
  }
  return cache;
}

/**
 * クリックされたアイテム名とキャッシュから、アイテム情報を解決する。
 * name が null、またはキャッシュにヒットしない場合は null を返す（= 標準動作にフォールバック）。
 */
export function resolveClickedItem(
  name: string | null,
  cache: ItemsCache,
): { name: string; isDirectory: boolean } | null {
  if (name === null) return null;
  const entry = cache.get(name);
  if (!entry) return null;
  return { name, isDirectory: entry.type === DIRECTORY_TYPE };
}

/**
 * アイテムをフォルダ優先・名前アルファベット順でソートする。
 * 元の配列は変更しない（新しい配列を返す）。
 */
export function sortItems<T extends { name: string; type: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.type === DIRECTORY_TYPE && b.type !== DIRECTORY_TYPE) return -1;
    if (a.type !== DIRECTORY_TYPE && b.type === DIRECTORY_TYPE) return 1;
    return a.name.localeCompare(b.name);
  });
}

// --- 内部ヘルパー関数 ---

/**
 * DOM 要素からアイテム名を取得する。
 * LISTING_ITEM_TEXT_SELECTOR でヒットしない場合は null を返す。
 */
function getItemName(itemEl: Element): string | null {
  const textEl = itemEl.querySelector(LISTING_ITEM_TEXT_SELECTOR);
  return textEl?.textContent?.trim() ?? null;
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
 * クリックターゲットから最も近いアイテム要素を返す。
 * JupyterLab 4.x の DirListing 非公開 DOM 構造に依存する。
 * DOM 構造が変わった場合は null を返し、標準動作にフォールバックする。
 */
function findListingItem(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(LISTING_ITEM_SELECTOR);
}

// --- ツリー UI ---

/**
 * ツリーアイテム行 (div.jp-fb-tree-item) を生成する。
 */
function createTreeItemEl(name: string, isDir: boolean, path: string, level: number): HTMLElement {
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
  navigateToFolder: (path: string) => void,
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
    level: number,
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
    const sorted = sortItems(items);

    for (const item of sorted) {
      const isDir = item.type === DIRECTORY_TYPE;
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

    /** ディレクトリアイテムキャッシュ: アイテム名 -> { type } */
    let itemsCache: ItemsCache = new Map();

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
      navigateToFolder,
    );

    function resolveDirectoryClick(target: EventTarget | null): { itemEl: Element; name: string } | null {
      if (isInsideTreeItem(target)) return null;
      const itemEl = findListingItem(target);
      if (!itemEl) return null;
      const itemName = getItemName(itemEl);
      const resolved = resolveClickedItem(itemName, itemsCache);
      if (!resolved || !resolved.isDirectory) return null;
      return { itemEl, name: resolved.name };
    }

    const clickHandler = (e: MouseEvent) => {
      const hit = resolveDirectoryClick(e.target);
      if (!hit) return;

      const path = buildItemPath(browser.model.path, hit.name);

      // デフォルトのフォルダ移動を抑制
      e.preventDefault();
      e.stopPropagation();

      // ダブルクリック判定
      if (clickTimer !== null) {
        // ダブルクリック検出: タイマーをクリアして標準移動を実行
        cancelPendingClick();
        // JupyterLab のデフォルト cd 動作: model.cd() は相対パスを受け取る
        void browser.model.cd(hit.name);
        return;
      }

      // シングルクリック: タイマーを設定してツリー展開を遅延実行
      clickTimer = setTimeout(() => {
        clickTimer = null;
        void toggleTreeExpansion(hit.itemEl, path, contentsManager, 1);
      }, DBLCLICK_TIMEOUT_MS);
    };

    const dblclickHandler = (e: MouseEvent) => {
      const hit = resolveDirectoryClick(e.target);
      if (!hit) return;

      // シングルクリックタイマーをキャンセル
      cancelPendingClick();

      // デフォルト動作を抑制し、cd を直接実行（相対パス）
      e.preventDefault();
      e.stopPropagation();
      void browser.model.cd(hit.name);
    };

    // DirListing の DOM ノードにキャプチャフェーズでイベントリスナーを追加
    browser.node.addEventListener('click', clickHandler, true);
    browser.node.addEventListener('dblclick', dblclickHandler, true);

    // モデル更新時にアイテムキャッシュを再構築
    // refreshed はアイテム格納後に発火するため、items() で全アイテムを取得できる
    // pathChanged は refreshed より先に発火し、アイテム未格納のため使用しない
    browser.model.refreshed.connect(() => {
      const items: Array<{ name: string; type: string }> = [];
      for (const model of browser.model.items()) {
        items.push({ name: model.name, type: model.type });
      }
      itemsCache = buildItemsCache(items);
    });

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
