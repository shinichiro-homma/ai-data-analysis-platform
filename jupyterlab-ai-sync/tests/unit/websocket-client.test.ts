import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// JupyterLab 依存をモック（DOM 不要なテスト環境向け）
vi.mock('@jupyterlab/services', () => ({
  ServerConnection: {
    makeSettings: () => ({ wsUrl: 'ws://localhost:8888/' }),
  },
}));

vi.mock('@jupyterlab/coreutils', () => ({
  PageConfig: {
    getToken: () => 'test-token',
  },
}));

import { WebSocketClient } from '../../src/websocket-client';

describe('WebSocketClient ライフサイクル', () => {
  /** テスト中に作成された MockWebSocket インスタンスを追跡 */
  let mockWsInstances: Array<{
    readyState: number;
    onopen: (() => void) | null;
    onclose: (() => void) | null;
    close: ReturnType<typeof vi.fn>;
  }>;

  beforeEach(() => {
    vi.useFakeTimers();
    // node 環境では window が未定義のため、window.setTimeout を使うソースコードのためにスタブ
    vi.stubGlobal('window', globalThis);

    mockWsInstances = [];

    // WebSocket コンストラクタをモック
    vi.stubGlobal(
      'WebSocket',
      Object.assign(
        class MockWebSocket {
          readyState = 1;
          onopen: (() => void) | null = null;
          onmessage: ((event: { data: string }) => void) | null = null;
          onerror: ((error: unknown) => void) | null = null;
          onclose: (() => void) | null = null;
          close = vi.fn();

          constructor(_url: string) {
            mockWsInstances.push(this);
          }
        },
        { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 },
      ),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('dispose() が WebSocket を閉じる', () => {
    // Arrange
    const callback = vi.fn();
    const client = new WebSocketClient(callback);
    client.connect();
    expect(mockWsInstances).toHaveLength(1);

    // Act
    client.dispose();

    // Assert
    expect(mockWsInstances[0].close).toHaveBeenCalled();
  });

  test('dispose() が再接続タイマーをクリアする', () => {
    // Arrange
    const callback = vi.fn();
    const client = new WebSocketClient(callback);
    client.connect();
    // onclose を発火して再接続タイマーを開始させる
    mockWsInstances[0].onclose?.();

    // Act
    client.dispose();

    // Assert - タイマーを進めても新しい WebSocket が作成されない
    const countBefore = mockWsInstances.length;
    vi.advanceTimersByTime(10000);
    expect(mockWsInstances).toHaveLength(countBefore);
  });

  test('dispose 後の connect() が WebSocket を作成しない', () => {
    // Arrange
    const callback = vi.fn();
    const client = new WebSocketClient(callback);
    client.dispose();

    // Act
    client.connect();

    // Assert
    expect(mockWsInstances).toHaveLength(0);
  });

  test('dispose() が冪等（2 回呼んでもエラーなし）', () => {
    // Arrange
    const callback = vi.fn();
    const client = new WebSocketClient(callback);
    client.connect();

    // Act & Assert - 2 回呼んでもエラーにならない
    expect(() => {
      client.dispose();
      client.dispose();
    }).not.toThrow();
  });
});
