/**
 * WebSocket イベント受信クライアント
 *
 * 統合テストで jupyter-server の AI同期WebSocketエンドポイント
 * (/api/ai/events) からイベントを受信するためのヘルパークラス。
 */

import WebSocket from 'ws';

/**
 * Phase 21 で定義されたイベントタイプ
 */
export const AI_EVENT_TYPES = {
  NOTEBOOK_CHANGED: 'notebook_changed',
  LOCK_ACQUIRED: 'lock_acquired',
  LOCK_RELEASED: 'lock_released',
  CELL_EXECUTE_START: 'cell_execute_start',
  CELL_EXECUTE_END: 'cell_execute_end',
} as const;

export type AiEventType = (typeof AI_EVENT_TYPES)[keyof typeof AI_EVENT_TYPES];

export interface AiEvent {
  type: string;
  notebook_path: string;
  [key: string]: unknown;
}

/** notebook_changed イベント（seq 付き） */
export interface NotebookChangedEvent extends AiEvent {
  type: typeof AI_EVENT_TYPES.NOTEBOOK_CHANGED;
  seq: number;
}

/** lock_acquired イベント */
export interface LockAcquiredEvent extends AiEvent {
  type: typeof AI_EVENT_TYPES.LOCK_ACQUIRED;
}

/** lock_released イベント */
export interface LockReleasedEvent extends AiEvent {
  type: typeof AI_EVENT_TYPES.LOCK_RELEASED;
}

/** cell_execute_start イベント */
export interface CellExecuteStartEvent extends AiEvent {
  type: typeof AI_EVENT_TYPES.CELL_EXECUTE_START;
}

/** cell_execute_end イベント */
export interface CellExecuteEndEvent extends AiEvent {
  type: typeof AI_EVENT_TYPES.CELL_EXECUTE_END;
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
   * 段階的にポーリング間隔を増加させながら（最大200ms）条件を満たすまで待機する共通ループ
   *
   * @param check 条件チェック関数。値が見つかれば返し、未検出なら undefined を返す
   * @param timeoutMs タイムアウト（ミリ秒）
   * @param errorMessage タイムアウト時のエラーメッセージを生成する関数
   * @returns check が返した値
   * @throws タイムアウトした場合
   */
  private async pollUntil<T>(check: () => T | undefined, timeoutMs: number, errorMessage: () => string): Promise<T> {
    const startTime = Date.now();
    let pollInterval = 50;

    while (Date.now() - startTime < timeoutMs) {
      const result = check();
      if (result) {
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      // 段階的にポーリング間隔を増加（最大200ms）
      pollInterval = Math.min(pollInterval + 25, 200);
    }

    throw new Error(errorMessage());
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
    return this.pollUntil(
      () => this.events.find((e) => e.type === type),
      timeoutMs,
      () =>
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
   * 指定数のイベントが溜まるまで待機する
   *
   * @param count 期待するイベント数
   * @param timeoutMs タイムアウト（ミリ秒）
   * @returns 受信したイベントの配列
   * @throws タイムアウトした場合
   */
  async waitForEventCount(count: number, timeoutMs = 10000): Promise<AiEvent[]> {
    const startTime = Date.now();
    return this.pollUntil(
      () => (this.events.length >= count ? [...this.events] : undefined),
      timeoutMs,
      () =>
        `Timeout waiting for ${count} events after ${Date.now() - startTime}ms. ` +
        `Got ${this.events.length} events: [${this.events.map((e) => e.type).join(', ')}]`,
    );
  }

  /**
   * 条件に一致するイベントを待機する
   *
   * @param predicate マッチ条件
   * @param description タイムアウト時のエラーメッセージ用説明
   * @param timeoutMs タイムアウト（ミリ秒）
   * @returns マッチしたイベント
   * @throws タイムアウトした場合
   */
  async waitForEventMatching<T extends AiEvent = AiEvent>(
    predicate: (event: AiEvent) => boolean,
    description: string,
    timeoutMs = 5000,
  ): Promise<T> {
    return this.pollUntil(
      () => this.events.find(predicate) as T | undefined,
      timeoutMs,
      () =>
        `Timeout waiting for event matching "${description}" after ${timeoutMs}ms. ` +
        `Received events: ${this.events.map((e) => `${e.type}(${e.notebook_path})`).join(', ')}`,
    );
  }

  /**
   * 接続状態を取得する
   */
  isConnected(): boolean {
    return this.connected;
  }
}
