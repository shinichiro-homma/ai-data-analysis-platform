import { describe, test, expect } from 'vitest';
import { toImageReference } from '../../../src/image-store/index.js';
import type { ImageOutput } from '../../../src/jupyter-client/types.js';

describe('toImageReference', () => {
  test('ImageOutput を ImageReference に変換', () => {
    const image: ImageOutput = {
      file_path: 'workspaces/ws-001/output/exec-1-img-001.png',
      mime_type: 'image/png',
      description: 'matplotlib output [1]',
    };

    const result = toImageReference(image);

    expect(result).toEqual({
      file_path: 'workspaces/ws-001/output/exec-1-img-001.png',
      mime_type: 'image/png',
      description: 'matplotlib output [1]',
    });
  });

  test('PNG画像 => mime_type が正しく転写', () => {
    const image: ImageOutput = {
      file_path: 'workspaces/ws-001/output/exec-1-img-001.png',
      mime_type: 'image/png',
      description: 'matplotlib output [1]',
    };

    const result = toImageReference(image);
    expect(result.mime_type).toBe('image/png');
  });

  test('JPEG画像 => mime_type が正しく転写', () => {
    const image: ImageOutput = {
      file_path: 'workspaces/ws-001/output/exec-2-img-001.jpg',
      mime_type: 'image/jpeg',
      description: 'matplotlib output [2]',
    };

    const result = toImageReference(image);
    expect(result.mime_type).toBe('image/jpeg');
  });

  test('SVG画像 => mime_type が正しく転写', () => {
    const image: ImageOutput = {
      file_path: 'workspaces/ws-001/output/exec-3-img-001.svg',
      mime_type: 'image/svg+xml',
      description: 'matplotlib output [3]',
    };

    const result = toImageReference(image);
    expect(result.mime_type).toBe('image/svg+xml');
  });

  test('file_path が正確に転写される', () => {
    const image: ImageOutput = {
      file_path: 'workspaces/ws-abc/output/exec-10-img-003.png',
      mime_type: 'image/png',
      description: 'matplotlib output [3]',
    };

    const result = toImageReference(image);
    expect(result.file_path).toBe('workspaces/ws-abc/output/exec-10-img-003.png');
  });

  test('description が正確に転写される', () => {
    const image: ImageOutput = {
      file_path: 'workspaces/ws-001/output/exec-1-img-001.png',
      mime_type: 'image/png',
      description: 'カスタム説明文',
    };

    const result = toImageReference(image);
    expect(result.description).toBe('カスタム説明文');
  });
});
