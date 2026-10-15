export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type BackoffShape = Omit<RetryPolicy, "maxRetries">;

export const DEFAULT_READ_BACKOFF: BackoffShape = { baseDelayMs: 400, maxDelayMs: 8000 };

/** Parses Retry-After (seconds or HTTP date). Returns ms, or undefined. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** Full-jitter exponential backoff. A server-directed delay is always a floor. */
export function backoffDelay(
  attempt: number,
  shape: BackoffShape,
  retryAfterMs?: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(shape.maxDelayMs, shape.baseDelayMs * 2 ** attempt);
  const jittered = Math.floor(random() * ceiling);
  return Math.max(retryAfterMs ?? 0, jittered);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
