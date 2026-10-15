import "server-only";
import type { Coordinator } from "./coordinator";
import type { CacheClass } from "./endpoints";
import { metrics } from "@/lib/telemetry/metrics";
import { sleep } from "./retry-policy";

/**
 * Response cache. Keys embed the operation, the canonical (already scope-filtered)
 * query and the current tag versions, so one user's scoped result is never served
 * to a user with a different scope, and a write invalidates only the tags it names.
 */

const envSeconds = (name: string, def: number): number => {
  const v = Number(process.env[name]);
  return (Number.isFinite(v) && v >= 0 ? v : def) * 1000;
};

export function ttlFor(cls: CacheClass): number {
  switch (cls) {
    case "reference":
      return envSeconds("WMS_CACHE_TTL_REFERENCE_S", 600);
    case "availability":
      return envSeconds("WMS_CACHE_TTL_AVAILABILITY_S", 15);
    case "dashboard":
      return envSeconds("WMS_CACHE_TTL_DASHBOARD_S", 30);
    case "none":
      return 0;
  }
}

export interface CacheResult<T> {
  value: T;
  source: "hit" | "miss" | "deduped" | "coalesced";
}

export class ResponseCache {
  private inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly coord: Coordinator) {}

  async getOrLoad<T>(
    opKey: string,
    canonicalQuery: string,
    tags: readonly string[],
    ttlMs: number,
    loader: () => Promise<T>,
  ): Promise<CacheResult<T>> {
    if (ttlMs <= 0) return { value: await loader(), source: "miss" };

    const versions = await this.coord.tagVersions(tags);
    const key = `${opKey}|${versions}|${canonicalQuery}`;

    // Same-instance single-flight.
    const pending = this.inflight.get(key) as Promise<CacheResult<T>> | undefined;
    if (pending) {
      metrics.deduped(opKey);
      const r = await pending;
      return { value: r.value, source: "deduped" };
    }

    const p = this.resolve(opKey, key, ttlMs, loader).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async resolve<T>(opKey: string, key: string, ttlMs: number, loader: () => Promise<T>): Promise<CacheResult<T>> {
    const hit = await this.coord.cacheGet(key);
    if (hit !== null) {
      metrics.cacheHit(opKey);
      return { value: JSON.parse(hit) as T, source: "hit" };
    }

    // Cross-instance single-flight: one instance loads, the others briefly wait for its result.
    const lock = await this.coord.tryLock(key, 10_000);
    if (!lock) {
      for (let i = 0; i < 15; i += 1) {
        await sleep(100);
        const filled = await this.coord.cacheGet(key);
        if (filled !== null) {
          metrics.deduped(opKey);
          return { value: JSON.parse(filled) as T, source: "coalesced" };
        }
      }
      // Bounded wait exhausted: load directly rather than starve the caller.
    }
    try {
      const value = await loader();
      await this.coord.cacheSet(key, JSON.stringify(value), ttlMs);
      return { value, source: "miss" };
    } finally {
      if (lock) await this.coord.unlock(key, lock);
    }
  }

  invalidate(tags: readonly string[]): Promise<void> {
    return this.coord.bumpTags(tags);
  }
}
