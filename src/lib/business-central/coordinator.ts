import "server-only";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { resetSingleton, singleton } from "@/lib/singleton";

/**
 * Coordination primitives shared across app instances: rate tokens, global
 * concurrency leases, response cache with tag versions, single-flight locks.
 *
 * Redis is an accelerator only. If it is unavailable every call degrades to
 * the per-instance LocalCoordinator; nothing transactional lives here.
 */
export interface Coordinator {
  readonly kind: "local" | "redis";
  /** Returns 0 if a token was taken, otherwise the ms to wait before retrying. */
  takeToken(bucket: string, ratePerSec: number, burst: number): Promise<number>;
  acquireLease(name: string, limit: number, ttlMs: number): Promise<string | null>;
  releaseLease(name: string, leaseId: string): Promise<void>;
  tagVersions(tags: readonly string[]): Promise<string>;
  bumpTags(tags: readonly string[]): Promise<void>;
  cacheGet(key: string): Promise<string | null>;
  cacheSet(key: string, value: string, ttlMs: number): Promise<void>;
  tryLock(key: string, ttlMs: number): Promise<string | null>;
  unlock(key: string, lockId: string): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ local */

export class LocalCoordinator implements Coordinator {
  readonly kind = "local" as const;
  private buckets = new Map<string, { tokens: number; ts: number }>();
  private leases = new Map<string, Map<string, number>>();
  private versions = new Map<string, number>();
  private cache = new Map<string, { v: string; exp: number }>();
  private locks = new Map<string, { id: string; exp: number }>();
  private readonly maxCacheEntries = 2000;

  constructor(private readonly now: () => number = Date.now) {}

  async takeToken(bucket: string, ratePerSec: number, burst: number): Promise<number> {
    const t = this.now();
    const b = this.buckets.get(bucket) ?? { tokens: burst, ts: t };
    b.tokens = Math.min(burst, b.tokens + ((t - b.ts) / 1000) * ratePerSec);
    b.ts = t;
    let wait = 0;
    if (b.tokens >= 1) b.tokens -= 1;
    else wait = Math.ceil(((1 - b.tokens) / ratePerSec) * 1000);
    this.buckets.set(bucket, b);
    return wait;
  }

  async acquireLease(name: string, limit: number, ttlMs: number): Promise<string | null> {
    const t = this.now();
    const set = this.leases.get(name) ?? new Map<string, number>();
    for (const [id, exp] of set) if (exp <= t) set.delete(id);
    if (set.size >= limit) {
      this.leases.set(name, set);
      return null;
    }
    const id = randomUUID();
    set.set(id, t + ttlMs);
    this.leases.set(name, set);
    return id;
  }

  async releaseLease(name: string, leaseId: string): Promise<void> {
    this.leases.get(name)?.delete(leaseId);
  }

  async tagVersions(tags: readonly string[]): Promise<string> {
    return tags.map((t) => `${t}.${this.versions.get(t) ?? 0}`).join("|");
  }

  async bumpTags(tags: readonly string[]): Promise<void> {
    for (const t of tags) this.versions.set(t, (this.versions.get(t) ?? 0) + 1);
  }

  async cacheGet(key: string): Promise<string | null> {
    const e = this.cache.get(key);
    if (!e) return null;
    if (e.exp <= this.now()) {
      this.cache.delete(key);
      return null;
    }
    return e.v;
  }

  async cacheSet(key: string, value: string, ttlMs: number): Promise<void> {
    if (this.cache.size >= this.maxCacheEntries) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    this.cache.set(key, { v: value, exp: this.now() + ttlMs });
  }

  async tryLock(key: string, ttlMs: number): Promise<string | null> {
    const t = this.now();
    const cur = this.locks.get(key);
    if (cur && cur.exp > t) return null;
    const id = randomUUID();
    this.locks.set(key, { id, exp: t + ttlMs });
    return id;
  }

  async unlock(key: string, lockId: string): Promise<void> {
    if (this.locks.get(key)?.id === lockId) this.locks.delete(key);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {}
}

/* ------------------------------------------------------------------ redis */

const TOKEN_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local rate = tonumber(ARGV[1]); local burst = tonumber(ARGV[2])
local d = redis.call('HMGET', KEYS[1], 'tk', 'ts')
local tokens = tonumber(d[1]) or burst
local ts = tonumber(d[2]) or now
tokens = math.min(burst, tokens + (now - ts) / 1000 * rate)
local wait = 0
if tokens >= 1 then tokens = tokens - 1 else wait = math.ceil((1 - tokens) / rate * 1000) end
redis.call('HSET', KEYS[1], 'tk', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], 60000)
return wait`;

const LEASE_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[1]) then
  redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[2])
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]) * 2)
  return 1
end
return 0`;

const UNLOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

export class RedisCoordinator implements Coordinator {
  readonly kind = "redis" as const;
  private readonly redis: Redis;

  constructor(url: string, private readonly prefix = "wms:") {
    this.redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      commandTimeout: 1500,
    });
    this.redis.on("error", () => {
      /* surfaced through ping()/health; never thrown into request paths */
    });
  }

  private k(s: string): string {
    return `${this.prefix}${s}`;
  }

  async takeToken(bucket: string, ratePerSec: number, burst: number): Promise<number> {
    const r = await this.redis.eval(TOKEN_LUA, 1, this.k(`rl:${bucket}`), String(ratePerSec), String(burst));
    return Number(r);
  }

  async acquireLease(name: string, limit: number, ttlMs: number): Promise<string | null> {
    const id = randomUUID();
    const r = await this.redis.eval(LEASE_LUA, 1, this.k(`ls:${name}`), String(limit), id, String(ttlMs));
    return Number(r) === 1 ? id : null;
  }

  async releaseLease(name: string, leaseId: string): Promise<void> {
    await this.redis.zrem(this.k(`ls:${name}`), leaseId);
  }

  async tagVersions(tags: readonly string[]): Promise<string> {
    if (tags.length === 0) return "";
    const vals = await this.redis.mget(...tags.map((t) => this.k(`tv:${t}`)));
    return tags.map((t, i) => `${t}.${vals[i] ?? 0}`).join("|");
  }

  async bumpTags(tags: readonly string[]): Promise<void> {
    if (tags.length === 0) return;
    const pipe = this.redis.pipeline();
    for (const t of tags) pipe.incr(this.k(`tv:${t}`));
    await pipe.exec();
  }

  async cacheGet(key: string): Promise<string | null> {
    return this.redis.get(this.k(`c:${key}`));
  }

  async cacheSet(key: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(this.k(`c:${key}`), value, "PX", ttlMs);
  }

  async tryLock(key: string, ttlMs: number): Promise<string | null> {
    const id = randomUUID();
    const r = await this.redis.set(this.k(`lk:${key}`), id, "PX", ttlMs, "NX");
    return r === "OK" ? id : null;
  }

  async unlock(key: string, lockId: string): Promise<void> {
    await this.redis.eval(UNLOCK_LUA, 1, this.k(`lk:${key}`), lockId);
  }

  async ping(): Promise<boolean> {
    try {
      if (this.redis.status === "wait") await this.redis.connect();
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}

/* -------------------------------------------------------------- resilient */

/**
 * Prefers Redis, falls back to local state per call when Redis errors.
 * Lease/limit fallbacks are only safe because the scheduler also enforces a
 * per-instance cap of ceil(global / instanceCount).
 */
export class ResilientCoordinator implements Coordinator {
  private redisFailures = 0;
  private lastFailureAt = 0;

  constructor(
    private readonly primary: Coordinator,
    private readonly fallback: LocalCoordinator,
  ) {}

  get kind(): "local" | "redis" {
    return this.degraded ? "local" : this.primary.kind;
  }

  get degraded(): boolean {
    return this.redisFailures >= 3 && Date.now() - this.lastFailureAt < 15_000;
  }

  private async run<T>(fn: (c: Coordinator) => Promise<T>): Promise<T> {
    if (!this.degraded) {
      try {
        const r = await fn(this.primary);
        this.redisFailures = 0;
        return r;
      } catch {
        this.redisFailures += 1;
        this.lastFailureAt = Date.now();
      }
    }
    return fn(this.fallback);
  }

  takeToken(b: string, r: number, burst: number) { return this.run((c) => c.takeToken(b, r, burst)); }
  acquireLease(n: string, l: number, t: number) { return this.run((c) => c.acquireLease(n, l, t)); }
  releaseLease(n: string, id: string) { return this.run((c) => c.releaseLease(n, id)); }
  tagVersions(t: readonly string[]) { return this.run((c) => c.tagVersions(t)); }
  bumpTags(t: readonly string[]) {
    // Bump both so a later fallback/recovery cannot serve entries from before the write.
    return Promise.all([this.fallback.bumpTags(t), this.primary.bumpTags(t).catch(() => undefined)]).then(() => undefined);
  }
  cacheGet(k: string) { return this.run((c) => c.cacheGet(k)); }
  cacheSet(k: string, v: string, ttl: number) { return this.run((c) => c.cacheSet(k, v, ttl)); }
  tryLock(k: string, ttl: number) { return this.run((c) => c.tryLock(k, ttl)); }
  unlock(k: string, id: string) { return this.run((c) => c.unlock(k, id)); }
  async ping() { return this.primary.ping(); }
  async close() { await this.primary.close(); }
}

export function getCoordinator(redisUrl?: string): Coordinator {
  return singleton<Coordinator>("coordinator", () => {
    const local = new LocalCoordinator();
    return redisUrl ? new ResilientCoordinator(new RedisCoordinator(redisUrl), local) : local;
  });
}

export function resetCoordinatorForTests(): void {
  resetSingleton("coordinator");
}
