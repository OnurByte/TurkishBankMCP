interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TimedCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  async getOrCreate<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.entries.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expiresAt > now) return cached.value;

    const value = await factory();
    this.entries.set(key, { value, expiresAt: now + ttlMs });
    return value;
  }
}
