import { describe, test, expect, beforeEach } from 'vitest';
import { imageStore } from '../../../src/image-store/index.js';
import type { ImageOutput } from '../../../src/image-store/types.js';

// テスト前にストアをクリア
beforeEach(() => {
  // シングルトンなので、deleteBySession で全セッションをクリア
  const allImages = imageStore.listAll();
  const sessionIds = new Set(allImages.map(img => img.sessionId));
  sessionIds.forEach(sessionId => imageStore.deleteBySession(sessionId));
});

describe('ImageStore', () => {
  describe('store', () => {
    test('画像を保存 => ImageReference返却', () => {
      const imageData: ImageOutput = {
        mime_type: 'image/png',
        data: 'base64encodeddata',
        width: 800,
        height: 600,
      };

      const result = imageStore.store('session-123', imageData);

      expect(result).toHaveProperty('resource_uri');
      expect(result).toHaveProperty('mime_type', 'image/png');
      expect(result).toHaveProperty('description');
      expect(result.resource_uri).toMatch(/^jupyter:\/\/sessions\/session-123\/images\/.+\.png$/);
      expect(result.description).toMatch(/matplotlib output \[\d+\]/);
    });

    test('複数画像の保存 => カウンターが増加', () => {
      const imageData: ImageOutput = {
        mime_type: 'image/png',
        data: 'base64data',
      };

      const ref1 = imageStore.store('session-abc', imageData);
      const ref2 = imageStore.store('session-abc', imageData);
      const ref3 = imageStore.store('session-abc', imageData);

      expect(ref1.description).toBe('matplotlib output [1]');
      expect(ref2.description).toBe('matplotlib output [2]');
      expect(ref3.description).toBe('matplotlib output [3]');
    });

    test('異なるセッション => 独立したカウンター', () => {
      const imageData: ImageOutput = {
        mime_type: 'image/png',
        data: 'base64data',
      };

      const ref1 = imageStore.store('session-1', imageData);
      const ref2 = imageStore.store('session-2', imageData);
      const ref3 = imageStore.store('session-1', imageData);

      expect(ref1.description).toBe('matplotlib output [1]');
      expect(ref2.description).toBe('matplotlib output [1]');
      expect(ref3.description).toBe('matplotlib output [2]');
    });

    test('無効なsessionId => エラー', () => {
      const imageData: ImageOutput = {
        mime_type: 'image/png',
        data: 'base64data',
      };

      expect(() => imageStore.store('', imageData)).toThrow('Invalid sessionId');
      expect(() => imageStore.store(null as any, imageData)).toThrow('Invalid sessionId');
      expect(() => imageStore.store(123 as any, imageData)).toThrow('Invalid sessionId');
    });

    test('無効なimageData => エラー', () => {
      expect(() => imageStore.store('session-1', null as any)).toThrow('Invalid imageData');
      expect(() => imageStore.store('session-1', {} as any)).toThrow('Invalid imageData');
      expect(() => imageStore.store('session-1', { mime_type: 'image/png' } as any)).toThrow('Invalid imageData');
      expect(() => imageStore.store('session-1', { data: 'base64' } as any)).toThrow('Invalid imageData');
    });

    test('JPEG画像 => .jpg拡張子のURI', () => {
      const imageData: ImageOutput = {
        mime_type: 'image/jpeg',
        data: 'jpegdata',
      };

      const result = imageStore.store('session-1', imageData);
      expect(result.resource_uri).toMatch(/\.jpg$/);
      expect(result.mime_type).toBe('image/jpeg');
    });
  });

  describe('get', () => {
    test('保存した画像を取得 => StoredImage返却', () => {
      const imageData: ImageOutput = {
        mime_type: 'image/png',
        data: 'base64data',
        width: 800,
        height: 600,
      };

      const ref = imageStore.store('session-123', imageData);
      const stored = imageStore.get(ref.resource_uri);

      expect(stored).toBeDefined();
      expect(stored?.sessionId).toBe('session-123');
      expect(stored?.mimeType).toBe('image/png');
      expect(stored?.data).toBe('base64data');
      expect(stored?.width).toBe(800);
      expect(stored?.height).toBe(600);
      expect(stored?.createdAt).toBeInstanceOf(Date);
    });

    test('存在しない画像 => undefined', () => {
      const result = imageStore.get('jupyter://sessions/session-1/images/nonexistent.png');
      expect(result).toBeUndefined();
    });

    test('無効なURI形式 => undefined', () => {
      const result = imageStore.get('invalid-uri');
      expect(result).toBeUndefined();
    });

    test('無効なresourceUri => エラー', () => {
      expect(() => imageStore.get('')).toThrow('Invalid resourceUri');
      expect(() => imageStore.get(null as any)).toThrow('Invalid resourceUri');
      expect(() => imageStore.get(123 as any)).toThrow('Invalid resourceUri');
    });
  });

  describe('listAll', () => {
    test('全画像を取得 => 全StoredImageの配列', () => {
      const imageData: ImageOutput = {
        mime_type: 'image/png',
        data: 'data1',
      };

      imageStore.store('session-1', imageData);
      imageStore.store('session-2', imageData);
      imageStore.store('session-1', imageData);

      const allImages = imageStore.listAll();
      expect(allImages).toHaveLength(3);
      expect(allImages.every(img => img.id)).toBe(true);
      expect(allImages.every(img => img.sessionId)).toBe(true);
    });

    test('画像が0件 => 空配列', () => {
      const allImages = imageStore.listAll();
      expect(allImages).toEqual([]);
    });
  });

  describe('listBySession', () => {
    test('特定セッションの画像のみ取得', () => {
      const imageData: ImageOutput = {
        mime_type: 'image/png',
        data: 'data',
      };

      imageStore.store('session-1', imageData);
      imageStore.store('session-2', imageData);
      imageStore.store('session-1', imageData);
      imageStore.store('session-3', imageData);

      const session1Images = imageStore.listBySession('session-1');
      expect(session1Images).toHaveLength(2);
      expect(session1Images.every(img => img.sessionId === 'session-1')).toBe(true);

      const session2Images = imageStore.listBySession('session-2');
      expect(session2Images).toHaveLength(1);
      expect(session2Images[0].sessionId).toBe('session-2');
    });

    test('存在しないセッション => 空配列', () => {
      const imageData: ImageOutput = {
        mime_type: 'image/png',
        data: 'data',
      };

      imageStore.store('session-1', imageData);

      const result = imageStore.listBySession('nonexistent-session');
      expect(result).toEqual([]);
    });
  });

  describe('deleteBySession', () => {
    test('セッションの画像を全削除', () => {
      const imageData: ImageOutput = {
        mime_type: 'image/png',
        data: 'data',
      };

      imageStore.store('session-1', imageData);
      imageStore.store('session-1', imageData);
      imageStore.store('session-2', imageData);

      expect(imageStore.listAll()).toHaveLength(3);

      imageStore.deleteBySession('session-1');

      expect(imageStore.listBySession('session-1')).toHaveLength(0);
      expect(imageStore.listBySession('session-2')).toHaveLength(1);
      expect(imageStore.listAll()).toHaveLength(1);
    });

    test('削除後、同じセッションの新規画像はカウンター1から', () => {
      const imageData: ImageOutput = {
        mime_type: 'image/png',
        data: 'data',
      };

      imageStore.store('session-1', imageData);
      imageStore.store('session-1', imageData);

      imageStore.deleteBySession('session-1');

      const ref = imageStore.store('session-1', imageData);
      expect(ref.description).toBe('matplotlib output [1]');
    });

    test('存在しないセッション削除 => エラーなし', () => {
      expect(() => imageStore.deleteBySession('nonexistent')).not.toThrow();
    });
  });
});
