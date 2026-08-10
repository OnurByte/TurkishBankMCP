import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface CacheState {
  version: 1;
  entries: Record<string, CacheEntry<unknown>>;
}

function isCacheState(value: unknown): value is CacheState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && !!record.entries && typeof record.entries === "object";
}

export class TimedCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private loaded = false;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath?: string) {}

  async getOrCreate<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
    await this.load();

    const now = Date.now();
    const cached = this.entries.get(key) as CacheEntry<T> | undefined;

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    if (cached) this.entries.delete(key);

    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;

    const task = (async () => {
      const value = await factory();
      this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      this.prune();
      await this.persist();
      return value;
    })();

    this.inflight.set(key, task as Promise<unknown>);

    try {
      return await task;
    } finally {
      this.inflight.delete(key);
    }
  }

  stats() {
    const now = Date.now();
    let activeEntries = 0;

    for (const entry of this.entries.values()) {
      if (entry.expiresAt > now) activeEntries += 1;
    }

    return {
      persistent: Boolean(this.filePath),
      activeEntries,
      inflight: this.inflight.size
    };
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    if (!this.filePath) return;

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);

      if (!isCacheState(parsed)) {
        console.error("TurkishBankMCP cache ignored: unsupported cache format");
        return;
      }

      const now = Date.now();
      for (const [key, entry] of Object.entries(parsed.entries)) {
        if (entry && typeof entry.expiresAt === "number" && entry.expiresAt > now) {
          this.entries.set(key, entry);
        }
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;

      if (code !== "ENOENT") {
        console.error(`TurkishBankMCP cache load failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private prune(): void {
    const now = Date.now();

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return;

    const state: CacheState = {
      version: 1,
      entries: Object.fromEntries(this.entries)
    };

    const payload = `${JSON.stringify(state)}\n`;
    const target = this.filePath;

    this.persistQueue = this.persistQueue
      .then(async () => {
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temp, payload, { encoding: "utf8", mode: 0o600 });
        await rename(temp, target);

        try {
          await chmod(target, 0o600);
        } catch {
          // Best effort on platforms that do not implement POSIX permissions.
        }
      })
      .catch((error) => {
        console.error(`TurkishBankMCP cache persist failed: ${error instanceof Error ? error.message : String(error)}`);
      });

    await this.persistQueue;
  }
}
