import "server-only";
import { singleton } from "@/lib/singleton";

/** In-process metrics for the monitoring screen (per instance). Aggregation across instances is a Phase 6 concern. */
interface OpStats {
  count: number;
  errors: number;
  throttled: number;
  cacheHits: number;
  deduped: number;
  latencies: number[]; // ring buffer of the last N request durations
  queueWaits: number[];
}

const N = 500;
interface State { ops: Map<string, OpStats>; lastSuccessAt: number | undefined; authFailures: number }
const st = (): State => singleton<State>("metrics", () => ({ ops: new Map(), lastSuccessAt: undefined, authFailures: 0 }));

function stats(op: string): OpStats {
  const ops = st().ops;
  let s = ops.get(op);
  if (!s) {
    s = { count: 0, errors: 0, throttled: 0, cacheHits: 0, deduped: 0, latencies: [], queueWaits: [] };
    ops.set(op, s);
  }
  return s;
}

const push = (arr: number[], v: number) => {
  arr.push(v);
  if (arr.length > N) arr.shift();
};

export const metrics = {
  request(op: string, durationMs: number, queueWaitMs: number, outcome: "ok" | "error" | "throttled") {
    const s = stats(op);
    s.count += 1;
    if (outcome === "error") s.errors += 1;
    if (outcome === "throttled") s.throttled += 1;
    if (outcome === "ok") st().lastSuccessAt = Date.now();
    push(s.latencies, durationMs);
    push(s.queueWaits, queueWaitMs);
  },
  cacheHit: (op: string) => { stats(op).cacheHits += 1; },
  deduped: (op: string) => { stats(op).deduped += 1; },
  authFailure: () => { st().authFailures += 1; },
  snapshot() {
    const pct = (a: number[], p: number) => {
      if (!a.length) return 0;
      const s = [...a].sort((x, y) => x - y);
      return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
    };
    const { ops, lastSuccessAt, authFailures } = st();
    return {
      lastSuccessAt,
      authFailures,
      operations: Object.fromEntries(
        [...ops].map(([k, s]) => [k, {
          count: s.count, errors: s.errors, throttled: s.throttled, cacheHits: s.cacheHits, deduped: s.deduped,
          p50: pct(s.latencies, 50), p95: pct(s.latencies, 95), p99: pct(s.latencies, 99),
          queueWaitP95: pct(s.queueWaits, 95),
        }]),
      ),
    };
  },
  reset() { const x = st(); x.ops.clear(); x.lastSuccessAt = undefined; x.authFailures = 0; },
};
