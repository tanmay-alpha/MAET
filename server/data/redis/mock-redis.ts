/**
 * MockRedis — in-memory Redis substitute for offline unit and integration tests.
 *
 * Implements the ioredis surface used by rate-limit, idempotency, SSE hub, and
 * the Redis client tests.  Not intended for production use.
 */

type StoreEntry = { value: string; expiresAt: number | null };

class MockPipeline {
  private results: Array<[Error | null, unknown]> = [];
  private commands: Array<() => [Error | null, unknown]> = [];

  // Capture commands to run on exec()
  sadd(key: string, ...members: string[]): this {
    const store = (this as unknown as { _store: () => Map<string, StoreEntry> })._store();
    this.commands.push(() => {
      let added = 0;
      for (const m of members) {
        const existing = store.get(key);
        if (!existing) {
          store.set(key, { value: JSON.stringify(new Set([m])), expiresAt: null });
          added++;
        } else {
          try {
            const set: string[] = JSON.parse(existing.value);
            if (!set.includes(m)) { set.push(m); existing.value = JSON.stringify(set); added++; }
          } catch { /* ignore */ }
        }
      }
      return [null, added];
    });
    return this;
  }

  srem(key: string, ...members: string[]): this {
    const store = (this as unknown as { _store: () => Map<string, StoreEntry> })._store();
    this.commands.push(() => {
      const existing = store.get(key);
      if (!existing) return [null, 0];
      try {
        let set: string[] = JSON.parse(existing.value);
        const before = set.length;
        set = set.filter((m) => !members.includes(m));
        existing.value = JSON.stringify(set);
        return [null, before - set.length];
      } catch { return [null, 0]; }
    });
    return this;
  }

  hset(key: string, fields: Record<string, string>): this {
    const store = (this as unknown as { _store: () => Map<string, StoreEntry> })._store();
    this.commands.push(() => {
      store.set(key, { value: JSON.stringify(fields), expiresAt: null });
      return [null, Object.keys(fields).length];
    });
    return this;
  }

  expire(key: string, seconds: number): this {
    const store = (this as unknown as { _store: () => Map<string, StoreEntry> })._store();
    this.commands.push(() => {
      const entry = store.get(key);
      if (entry) entry.expiresAt = Date.now() + seconds * 1000;
      return [null, entry ? 1 : 0];
    });
    return this;
  }

  incrby(key: string, increment: number): this {
    const store = (this as unknown as { _store: () => Map<string, StoreEntry> })._store();
    this.commands.push(() => {
      const entry = store.get(key);
      const current = entry ? parseInt(entry.value, 10) || 0 : 0;
      const next = current + increment;
      if (entry) {
        entry.value = String(next);
      } else {
        store.set(key, { value: String(next), expiresAt: null });
      }
      return [null, next];
    });
    return this;
  }

  ttl(key: string): this {
    const store = (this as unknown as { _store: () => Map<string, StoreEntry> })._store();
    this.commands.push(() => {
      const entry = store.get(key);
      if (!entry) return [null, -2];
      if (entry.expiresAt === null) return [null, -1];
      const remaining = Math.ceil((entry.expiresAt - Date.now()) / 1000);
      return [null, remaining > 0 ? remaining : -2];
    });
    return this;
  }

  del(...keys: string[]): this {
    const store = (this as unknown as { _store: () => Map<string, StoreEntry> })._store();
    this.commands.push(() => {
      let count = 0;
      for (const k of keys) { if (store.delete(k)) count++; }
      return [null, count];
    });
    return this;
  }

  exec(): [Error | null, unknown][] {
    this.results = this.commands.map((cmd) => cmd());
    return this.results;
  }
}

export class MockRedis {
  private store: Map<string, StoreEntry> = new Map();

  // Attach the store reference to pipeline instances
  multi(): MockPipeline {
    const pipeline = new MockPipeline();
    // Bind the store accessor
    (pipeline as unknown as { _store: () => Map<string, StoreEntry> })._store = () => this.store;
    return pipeline;
  }

  private _isExpired(entry: StoreEntry): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }

  private _get(key: string): StoreEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this._isExpired(entry)) { this.store.delete(key); return undefined; }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this._get(key)?.value ?? null;
  }

  async set(
    key: string,
    value: string,
    exMode?: string,
    ex?: number,
    nxMode?: string,
  ): Promise<"OK" | null> {
    const existing = this._get(key);
    if (nxMode === "NX" && existing) return null;
    const expiresAt = exMode === "EX" && ex ? Date.now() + ex * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) { if (this.store.delete(k)) count++; }
    return count;
  }

  async ttl(key: string): Promise<number> {
    const entry = this._get(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this._get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    const result: string[] = [];
    for (const [k, v] of this.store) {
      if (!this._isExpired(v) && regex.test(k)) result.push(k);
    }
    return result;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const entry = this._get(key);
    if (!entry) {
      this.store.set(key, { value: JSON.stringify(members), expiresAt: null });
      return members.length;
    }
    const set: string[] = JSON.parse(entry.value);
    let added = 0;
    for (const m of members) { if (!set.includes(m)) { set.push(m); added++; } }
    entry.value = JSON.stringify(set);
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const entry = this._get(key);
    if (!entry) return 0;
    const set: string[] = JSON.parse(entry.value);
    const before = set.length;
    entry.value = JSON.stringify(set.filter((m) => !members.includes(m)));
    return before - JSON.parse(entry.value).length;
  }

  async hset(key: string, fields: Record<string, string>): Promise<number> {
    this.store.set(key, { value: JSON.stringify(fields), expiresAt: null });
    return Object.keys(fields).length;
  }

  async incrby(key: string, increment: number): Promise<number> {
    const entry = this._get(key);
    const current = entry ? parseInt(entry.value, 10) || 0 : 0;
    const next = current + increment;
    if (entry) { entry.value = String(next); }
    else { this.store.set(key, { value: String(next), expiresAt: null }); }
    return next;
  }

  /** ioredis compatibility: no-op disconnect */
  disconnect(): void {
    this.store.clear();
  }

  /** ioredis compatibility: no-op quit */
  async quit(): Promise<"OK"> {
    this.store.clear();
    return "OK";
  }

  // Event listener stubs for ioredis compatibility
  on(_event: string, _listener: () => void): this { return this; }
  off(_event: string, _listener: () => void): this { return this; }
}
