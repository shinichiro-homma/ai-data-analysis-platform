import { describe, test, expect } from 'vitest';
import { encodeContentsPath } from '../../../src/jupyter-client/client.js';

describe('encodeContentsPath', () => {
  test('スラッシュを含むパスはスラッシュを保持する', () => {
    expect(encodeContentsPath('workspaces/ws-123/data/file.csv'))
      .toBe('workspaces/ws-123/data/file.csv');
  });

  test('スペースを含むファイル名はエンコードされる', () => {
    expect(encodeContentsPath('workspaces/ws-123/data/my file.csv'))
      .toBe('workspaces/ws-123/data/my%20file.csv');
  });

  test('単一セグメントのパスはそのまま返す', () => {
    expect(encodeContentsPath('file.csv')).toBe('file.csv');
  });

  test('特殊文字を含むセグメントはエンコードされる', () => {
    expect(encodeContentsPath('workspaces/ws-123/data/file (1).csv'))
      .toBe('workspaces/ws-123/data/file%20(1).csv');
  });

  test('空文字列は空文字列を返す', () => {
    expect(encodeContentsPath('')).toBe('');
  });
});
