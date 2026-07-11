import { describe, test, expect } from 'vitest';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { encodeContentsPath, JupyterClient } from '../../../src/jupyter-client/client.js';
import { lockTokenStorage } from '../../../src/utils/lock-context.js';

describe('encodeContentsPath', () => {
  test('スラッシュを含むパスはスラッシュを保持する', () => {
    expect(encodeContentsPath('workspaces/ws-123/data/file.csv')).toBe('workspaces/ws-123/data/file.csv');
  });

  test('スペースを含むファイル名はエンコードされる', () => {
    expect(encodeContentsPath('workspaces/ws-123/data/my file.csv')).toBe('workspaces/ws-123/data/my%20file.csv');
  });

  test('単一セグメントのパスはそのまま返す', () => {
    expect(encodeContentsPath('file.csv')).toBe('file.csv');
  });

  test('特殊文字を含むセグメントはエンコードされる', () => {
    expect(encodeContentsPath('workspaces/ws-123/data/file (1).csv')).toBe('workspaces/ws-123/data/file%20(1).csv');
  });

  test('空文字列は空文字列を返す', () => {
    expect(encodeContentsPath('')).toBe('');
  });
});

describe('JupyterClient X-Lock-Token ヘッダー伝播（バグ 1）', () => {
  /**
   * 発行されたリクエストのヘッダーを捕捉するカスタム axios アダプターを差し込んだ
   * クライアントを生成する。
   */
  function createCapturingClient(): { client: JupyterClient; getLastHeaders: () => Record<string, unknown> } {
    let lastHeaders: Record<string, unknown> = {};
    const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
      lastHeaders = { ...(config.headers as Record<string, unknown>) };
      return {
        data: { data: { cells: [] } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };
    const client = new JupyterClient({ baseUrl: 'http://localhost:8888', token: 'test-token' });
    // 内部 axios インスタンスにアダプターを差し込む
    (client as unknown as { axios: { defaults: { adapter: AxiosAdapter } } }).axios.defaults.adapter = adapter;
    return { client, getLastHeaders: () => lastHeaders };
  }

  test('lockTokenStorage.run 内で発行されるリクエストに X-Lock-Token が付与される', async () => {
    const { client, getLastHeaders } = createCapturingClient();

    await lockTokenStorage.run({ lockToken: 'lock-abc' }, async () => {
      await client.updateNotebook('workspaces/ws/x.ipynb', { cells: [] });
    });

    expect(getLastHeaders()['X-Lock-Token']).toBe('lock-abc');
  });

  test('ロックコンテキスト外のリクエストには X-Lock-Token が付与されない', async () => {
    const { client, getLastHeaders } = createCapturingClient();

    await client.updateNotebook('workspaces/ws/x.ipynb', { cells: [] });

    expect(getLastHeaders()['X-Lock-Token']).toBeUndefined();
  });
});
