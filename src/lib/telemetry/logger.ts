import "server-only";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACT = /(secret|password|token|authorization|cookie|hash|pin)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export interface LogFields {
  correlationId?: string;
  transactionId?: string;
  jobId?: string;
  userId?: string;
  operation?: string;
  status?: number;
  durationMs?: number;
  queueWaitMs?: number;
  retryCount?: number;
  errorCode?: string;
  [key: string]: unknown;
}

export function log(level: Level, msg: string, fields: LogFields = {}): void {
  const min = (process.env.WMS_LOG_LEVEL as Level | undefined) ?? "info";
  if (ORDER[level] < ORDER[min]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(fields) as object) });
  (level === "error" ? console.error : console.log)(line);
}

export const logger = {
  debug: (m: string, f?: LogFields) => log("debug", m, f),
  info: (m: string, f?: LogFields) => log("info", m, f),
  warn: (m: string, f?: LogFields) => log("warn", m, f),
  error: (m: string, f?: LogFields) => log("error", m, f),
};
