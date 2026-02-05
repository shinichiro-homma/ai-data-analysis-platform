import { describe, test, expect } from 'vitest';
import {
  getExtensionFromMimeType,
  buildResourceUri,
  buildResourceUriFromImage,
  extractImageIdFromUri,
  RESOURCE_URI_SCHEME,
} from '../../../src/image-store/uri-utils.js';
import type { StoredImage } from '../../../src/image-store/types.js';

describe('getExtensionFromMimeType', () => {
  test('image/png => "png"', () => {
    expect(getExtensionFromMimeType('image/png')).toBe('png');
  });

  test('image/jpeg => "jpg"', () => {
    expect(getExtensionFromMimeType('image/jpeg')).toBe('jpg');
  });

  test('image/svg+xml => "svg"', () => {
    expect(getExtensionFromMimeType('image/svg+xml')).toBe('svg');
  });

  test('image/gif => "gif"', () => {
    expect(getExtensionFromMimeType('image/gif')).toBe('gif');
  });

  test('未知のMIMEタイプ => "png"（デフォルト）', () => {
    expect(getExtensionFromMimeType('image/unknown')).toBe('png');
  });
});

describe('buildResourceUri', () => {
  test('PNG画像のURI生成 => 正しいURI形式', () => {
    const uri = buildResourceUri('session-123', 'img-456', 'image/png');
    expect(uri).toBe('jupyter://sessions/session-123/images/img-456.png');
  });

  test('JPEG画像のURI生成 => .jpg拡張子', () => {
    const uri = buildResourceUri('session-abc', 'img-def', 'image/jpeg');
    expect(uri).toBe('jupyter://sessions/session-abc/images/img-def.jpg');
  });

  test('SVG画像のURI生成 => .svg拡張子', () => {
    const uri = buildResourceUri('session-1', 'img-2', 'image/svg+xml');
    expect(uri).toBe('jupyter://sessions/session-1/images/img-2.svg');
  });

  test('未知のMIMEタイプ => .png拡張子（デフォルト）', () => {
    const uri = buildResourceUri('session-x', 'img-y', 'image/unknown');
    expect(uri).toBe('jupyter://sessions/session-x/images/img-y.png');
  });

  test('URIスキームが正しい', () => {
    const uri = buildResourceUri('session-1', 'img-1', 'image/png');
    expect(uri).toContain(RESOURCE_URI_SCHEME);
    expect(uri).toMatch(/^jupyter:\/\/sessions\//);
  });
});

describe('buildResourceUriFromImage', () => {
  test('StoredImageからURI生成 => 正しいURI', () => {
    const image: StoredImage = {
      id: 'img-123',
      sessionId: 'session-456',
      data: 'base64data',
      mimeType: 'image/png',
      createdAt: new Date(),
    };

    const uri = buildResourceUriFromImage(image);
    expect(uri).toBe('jupyter://sessions/session-456/images/img-123.png');
  });

  test('JPEG画像のStoredImage => .jpg拡張子', () => {
    const image: StoredImage = {
      id: 'img-abc',
      sessionId: 'session-xyz',
      data: 'base64data',
      mimeType: 'image/jpeg',
      createdAt: new Date(),
    };

    const uri = buildResourceUriFromImage(image);
    expect(uri).toBe('jupyter://sessions/session-xyz/images/img-abc.jpg');
  });
});

describe('extractImageIdFromUri', () => {
  test('有効なPNG URI => 画像ID抽出', () => {
    const uri = 'jupyter://sessions/session-123/images/img-456.png';
    const imageId = extractImageIdFromUri(uri);
    expect(imageId).toBe('img-456');
  });

  test('有効なJPEG URI => 画像ID抽出', () => {
    const uri = 'jupyter://sessions/session-abc/images/img-def.jpg';
    const imageId = extractImageIdFromUri(uri);
    expect(imageId).toBe('img-def');
  });

  test('有効なSVG URI => 画像ID抽出', () => {
    const uri = 'jupyter://sessions/session-1/images/img-2.svg';
    const imageId = extractImageIdFromUri(uri);
    expect(imageId).toBe('img-2');
  });

  test('無効なURI（スキーム違い） => null', () => {
    const uri = 'http://sessions/session-1/images/img-1.png';
    const imageId = extractImageIdFromUri(uri);
    expect(imageId).toBeNull();
  });

  test('無効なURI（パス構造違い） => null', () => {
    const uri = 'jupyter://sessions/img-1.png';
    const imageId = extractImageIdFromUri(uri);
    expect(imageId).toBeNull();
  });

  test('無効なURI（拡張子なし） => null', () => {
    const uri = 'jupyter://sessions/session-1/images/img-1';
    const imageId = extractImageIdFromUri(uri);
    expect(imageId).toBeNull();
  });

  test('空文字列 => null', () => {
    const imageId = extractImageIdFromUri('');
    expect(imageId).toBeNull();
  });
});
