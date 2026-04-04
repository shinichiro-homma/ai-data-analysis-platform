/**
 * サイズ上限付きインメモリ Map
 *
 * 上限に達すると最も古いエントリを削除する（FIFO）。
 * session/kernel ID → 値 のストアとして使用する。
 *
 * session_id と kernel_id の両方を登録するため、
 * 実効容量は maxEntries / 2 セッション分となる。
 */
export class BoundedMap {
  private store = new Map<string, string>();

  constructor(private readonly maxEntries = 1000) {}

  set(key: string, value: string): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(key, value);
  }

  get(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
