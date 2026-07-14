/**
 * AI同期WebSocketクライアント
 */
import { ServerConnection } from '@jupyterlab/services';
import { PageConfig } from '@jupyterlab/coreutils';

/** WebSocket再接続間隔（ミリ秒） */
const RECONNECT_INTERVAL_MS = 5000;

export interface AiEvent {
  type: string;
  [key: string]: unknown;
}

export type EventCallback = (event: AiEvent) => void;
export type DisconnectCallback = () => void;
export type OpenCallback = () => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private readonly url: string;
  private callback: EventCallback;
  private onDisconnect?: DisconnectCallback;
  private onOpen?: OpenCallback;

  constructor(callback: EventCallback, onDisconnect?: DisconnectCallback, onOpen?: OpenCallback) {
    this.callback = callback;
    this.onDisconnect = onDisconnect;
    this.onOpen = onOpen;

    // WebSocketのURLを構築
    const settings = ServerConnection.makeSettings();
    const baseUrl = settings.wsUrl;
    const token = PageConfig.getToken();

    this.url = `${baseUrl}api/ai/events?token=${token}`;

    console.log('[WebSocketClient] Initialized with URL:', this.url);
  }

  /**
   * WebSocketに接続
   */
  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[WebSocketClient] Already connected');
      return;
    }

    console.log('[WebSocketClient] Connecting to:', this.url);

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WebSocketClient] Connected');
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        if (this.onOpen) {
          this.onOpen();
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[WebSocketClient] Received event:', data);
          this.callback(data);
        } catch (error) {
          // JSONパースエラーは個別メッセージの問題として無視（次のメッセージは処理続行）
          console.error('[WebSocketClient] Failed to parse message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocketClient] Error:', error);
      };

      this.ws.onclose = () => {
        console.log('[WebSocketClient] Disconnected');
        // 切断時コールバックを実行（ロック解除等）
        if (this.onDisconnect) {
          this.onDisconnect();
        }
        this.scheduleReconnect();
      };
    } catch (error) {
      console.error('[WebSocketClient] Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * 再接続をスケジュール
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    console.log(`[WebSocketClient] Reconnecting in ${RECONNECT_INTERVAL_MS}ms...`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_INTERVAL_MS);
  }

  /**
   * WebSocketを切断
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    console.log('[WebSocketClient] Disconnected');
  }
}
