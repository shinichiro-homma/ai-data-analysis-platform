import { describe, test, expect, vi } from 'vitest';

// lock-manager.ts が LockIndicator (Widget 継承) を import するため、
// DOM 不要なテスト環境向けにモックして @lumino/dragdrop の DragEvent 依存を回避する
vi.mock('../../src/ui/lock-indicator', () => ({
  LockIndicator: class {},
}));

import { BLOCKED_COMMAND_IDS, LOCK_EXEMPT_COMMAND_IDS, createIsEnabledGuard } from '../../src/lock-manager';

describe('BLOCKED_COMMAND_IDS / LOCK_EXEMPT_COMMAND_IDS', () => {
  test('BLOCKED_COMMAND_IDS にセル実行コマンドが含まれる', () => {
    const executionCommands = [
      'notebook:run-cell',
      'notebook:run-cell-and-select-next',
      'notebook:run-cell-and-insert-below',
      'notebook:run-all-cells',
      'notebook:run-all-above',
      'notebook:run-all-below',
      'notebook:restart-run-all',
    ];

    for (const cmd of executionCommands) {
      expect(BLOCKED_COMMAND_IDS.has(cmd), `${cmd} が BLOCKED_COMMAND_IDS に含まれていない`).toBe(true);
    }
  });

  test('BLOCKED_COMMAND_IDS にカーネル再起動コマンドが含まれる', () => {
    const restartCommands = [
      'notebook:restart-kernel',
      'notebook:restart-clear-output',
      'kernelmenu:restart',
      'kernelmenu:restart-clear',
    ];

    for (const cmd of restartCommands) {
      expect(BLOCKED_COMMAND_IDS.has(cmd), `${cmd} が BLOCKED_COMMAND_IDS に含まれていない`).toBe(true);
    }
  });

  test('BLOCKED_COMMAND_IDS にセル操作コマンドが含まれる', () => {
    const cellOperationCommands = [
      'notebook:insert-cell-above',
      'notebook:insert-cell-below',
      'notebook:delete-cell',
      'notebook:cut-cell',
      'notebook:move-cell-up',
      'notebook:move-cell-down',
      'notebook:split-cell-at-cursor',
      'notebook:merge-cells',
    ];

    for (const cmd of cellOperationCommands) {
      expect(BLOCKED_COMMAND_IDS.has(cmd), `${cmd} が BLOCKED_COMMAND_IDS に含まれていない`).toBe(true);
    }
  });

  test('LOCK_EXEMPT_COMMAND_IDS にカーネル中断コマンドが含まれる', () => {
    expect(LOCK_EXEMPT_COMMAND_IDS.has('notebook:interrupt-kernel')).toBe(true);
    expect(LOCK_EXEMPT_COMMAND_IDS.has('kernelmenu:interrupt')).toBe(true);
  });

  test('BLOCKED_COMMAND_IDS と LOCK_EXEMPT_COMMAND_IDS に重複がない', () => {
    for (const id of LOCK_EXEMPT_COMMAND_IDS) {
      expect(
        BLOCKED_COMMAND_IDS.has(id),
        `${id} が BLOCKED_COMMAND_IDS と LOCK_EXEMPT_COMMAND_IDS の両方に含まれている`,
      ).toBe(false);
    }
  });
});

describe('createIsEnabledGuard', () => {
  test('ロック中 + ブロック対象コマンド => isEnabled が false を返す', () => {
    // Arrange
    const isLocked = () => true;
    const originalIsEnabled = () => true;
    const guard = createIsEnabledGuard(isLocked, originalIsEnabled);

    // Act & Assert
    expect(guard('notebook:run-cell')).toBe(false);
  });

  test('ロック中 + exempt コマンド => 元の isEnabled の値を返す', () => {
    // Arrange
    const isLocked = () => true;
    const originalIsEnabled = (_id: string) => true;
    const guard = createIsEnabledGuard(isLocked, originalIsEnabled);

    // Act & Assert
    expect(guard('notebook:interrupt-kernel')).toBe(true);
  });

  test('ロック中 + ブロック/exempt どちらでもないコマンド => 元の isEnabled の値を返す', () => {
    // Arrange
    const isLocked = () => true;
    const originalIsEnabled = (_id: string) => true;
    const guard = createIsEnabledGuard(isLocked, originalIsEnabled);

    // Act & Assert
    expect(guard('notebook:some-other-command')).toBe(true);
  });

  test('非ロック時 + ブロック対象コマンド => 元の isEnabled の値を返す', () => {
    // Arrange
    const isLocked = () => false;
    const originalIsEnabled = (_id: string) => true;
    const guard = createIsEnabledGuard(isLocked, originalIsEnabled);

    // Act & Assert
    expect(guard('notebook:run-cell')).toBe(true);
  });

  test('args が元の isEnabled に転送される', () => {
    // Arrange
    const isLocked = () => false;
    const originalIsEnabled = vi.fn((_id: string, _args?: Record<string, unknown>) => true);
    const guard = createIsEnabledGuard(isLocked, originalIsEnabled);
    const args = { _luminoEvent: true, foo: 'bar' };

    // Act
    guard('notebook:run-cell', args);

    // Assert
    expect(originalIsEnabled).toHaveBeenCalledWith('notebook:run-cell', args);
  });

  test('exempt コマンドでも args が元の isEnabled に転送される', () => {
    // Arrange
    const isLocked = () => true;
    const originalIsEnabled = vi.fn((_id: string, _args?: Record<string, unknown>) => true);
    const guard = createIsEnabledGuard(isLocked, originalIsEnabled);
    const args = { _luminoEvent: true };

    // Act
    guard('notebook:interrupt-kernel', args);

    // Assert
    expect(originalIsEnabled).toHaveBeenCalledWith('notebook:interrupt-kernel', args);
  });
});
