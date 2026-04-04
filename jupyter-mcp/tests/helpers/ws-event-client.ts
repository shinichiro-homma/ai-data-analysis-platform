/**
 * WebSocket イベント受信クライアント
 *
 * 統合テストで jupyter-server の AI同期WebSocketエンドポイント
 * (/api/ai/events) からイベントを受信するためのヘルパークラス。
 */

import WebSocket from 'ws';

export interface AiEvent {
  type: string;
  notebook_path: string;
  [key: string]: unknown;
}

export class WsEventClient {
  private ws: WebSocket | null = null;
  private events: AiEvent[] = [];
  private connected = false;
  private connectionPromise: Promise<void> | null = null;

  constructor(
    private serverUrl: string,
    private token: string,
  ) {}

  /**
   * WebSocket に接続する
   */
  connect(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      const wsUrl = `${this.serverUrl}/api/ai/events?token=${this.token}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.connected = true;
        resolve();
      });

      this.ws.on('error', (error) => {
        reject(error);
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString()) as AiEvent;
          this.events.push(event);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
      });
    });

    return this.connectionPromise;
  }

  /**
   * WebSocket を切断する
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
      this.connectionPromise = null;
    }
  }

  /**
   * これまでに受信した全イベントを取得する
   */
  getEvents(): AiEvent[] {
    return [...this.events];
  }

  /**
   * イベントバッファをクリアする
   */
  clearEvents(): void {
    this.events = [];
  }

  /**
   * 特定のイベントタイプを待機する
   *
   * @param type イベントタイプ
   * @param timeoutMs タイムアウト（ミリ秒）
   * @returns マッチしたイベント
   * @throws タイムアウトした場合
   */
  async waitForEvent(type: string, timeoutMs = 5000): Promise<AiEvent> {
    const startTime = Date.now();
    let pollInterval = 50;

    while (Date.now() - startTime < timeoutMs) {
      const event = this.events.find((e) => e.type === type);
      if (event) {
        return event;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      // 段階的にポーリング間隔を増加（最大200ms）
      pollInterval = Math.min(pollInterval + 25, 200);
    }

    throw new Error(
      `Timeout waiting for event type "${type}" after ${timeoutMs}ms. ` +
        `Received events: ${this.events.map((e) => e.type).join(', ')}`,
    );
  }

  /**
   * 複数のイベントタイプを順序付きで待機する
   *
   * @param types イベントタイプの配列（期待される順序）
   * @param timeoutMs タイムアウト（ミリ秒）
   * @returns マッチしたイベントの配列
   * @throws タイムアウトした場合、または順序が異なる場合
   */
  async waitForEvents(types: string[], timeoutMs = 10000): Promise<AiEvent[]> {
    const startTime = Date.now();
    const results: AiEvent[] = [];
    let nextTypeIndex = 0;
    let pollInterval = 50;

    while (Date.now() - startTime < timeoutMs && nextTypeIndex < types.length) {
      const expectedType = types[nextTypeIndex];

      // すでに受信済みのイベントから検索
      const eventIndex = this.events.findIndex((e, idx) => {
        // 既にマッチ済みのイベントはスキップ
        return idx >= results.length && e.type === expectedType;
      });

      if (eventIndex !== -1) {
        results.push(this.events[eventIndex]);
        nextTypeIndex++;
        pollInterval = 50; // マッチ時はポーリング間隔をリセット
      } else {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        // 段階的にポーリング間隔を増加（最大200ms）
        pollInterval = Math.min(pollInterval + 25, 200);
      }
    }

    if (nextTypeIndex < types.length) {
      const elapsed = Date.now() - startTime;
      throw new Error(
        `Timeout waiting for events after ${elapsed}ms. Expected: [${types.join(', ')}], ` +
          `Got: [${results.map((e) => e.type).join(', ')}], ` +
          `All received: [${this.events.map((e) => e.type).join(', ')}]`,
      );
    }

    return results;
  }

  /**
   * 接続状態を取得する
   */
  isConnected(): boolean {
    return this.connected;
  }
}
