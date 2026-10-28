/** Stable, client-safe error codes. Raw BC/Microsoft text never reaches the browser. */
export type GatewayErrorCode =
  | "QUEUE_FULL"
  | "RATE_LIMITED"
  | "CIRCUIT_OPEN"
  | "TIMEOUT"
  | "BC_UNAUTHORIZED"
  | "BC_FORBIDDEN"
  | "BC_NOT_FOUND"
  | "BC_CONFLICT"
  | "BC_PRECONDITION"
  | "BC_THROTTLED"
  | "BC_SERVER_ERROR"
  | "BC_BAD_REQUEST"
  | "NETWORK"
  | "OUTCOME_UNKNOWN"
  | "DUPLICATE_SUBMISSION"
  | "ENDPOINT_NOT_ALLOWED"
  | "INVALID_QUERY";

export interface GatewayErrorOptions {
  status?: number;
  retryable?: boolean;
  retryAfterMs?: number;
  correlationId?: string;
  /** For writes: true when the request may have been applied by BC. */
  outcomeUnknown?: boolean;
}

/**
 * `instanceof GatewayError` is unreliable under Next.js (the same module can be bundled into several
 * server chunks, giving several distinct classes), which turned every gateway error into a 500
 * "Unexpected error". Identify the error by its shape instead.
 */
export function isGatewayError(e: unknown): e is GatewayError {
  if (e instanceof GatewayError) return true;
  const x = e as { name?: unknown; code?: unknown; opts?: unknown } | null;
  return !!x && typeof x === "object" && x.name === "GatewayError" && typeof x.code === "string" && typeof x.opts === "object" && x.opts !== null;
}

export class GatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    message: string,
    public readonly opts: GatewayErrorOptions = {},
  ) {
    super(message);
    this.name = "GatewayError";
  }

  get retryable(): boolean {
    return this.opts.retryable ?? false;
  }

  get httpStatus(): number {
    switch (this.code) {
      case "QUEUE_FULL":
      case "CIRCUIT_OPEN":
      case "BC_SERVER_ERROR":
      case "NETWORK":
      case "TIMEOUT":
        return 503;
      case "RATE_LIMITED":
      case "BC_THROTTLED":
        return 429;
      case "ENDPOINT_NOT_ALLOWED":
      case "BC_FORBIDDEN":
        return 403;
      case "BC_NOT_FOUND":
        return 404;
      case "BC_CONFLICT":
      case "BC_PRECONDITION":
      case "DUPLICATE_SUBMISSION":
        return 409;
      case "INVALID_QUERY":
      case "BC_BAD_REQUEST":
        return 400;
      case "OUTCOME_UNKNOWN":
        return 202;
      default:
        return 502;
    }
  }
}

export function classifyStatus(status: number): { code: GatewayErrorCode; retryable: boolean } {
  if (status === 401) return { code: "BC_UNAUTHORIZED", retryable: false };
  if (status === 403) return { code: "BC_FORBIDDEN", retryable: false };
  if (status === 404) return { code: "BC_NOT_FOUND", retryable: false };
  if (status === 409) return { code: "BC_CONFLICT", retryable: false };
  if (status === 412) return { code: "BC_PRECONDITION", retryable: false };
  if (status === 429) return { code: "BC_THROTTLED", retryable: true };
  if (status === 408) return { code: "TIMEOUT", retryable: true };
  if (status >= 500) return { code: "BC_SERVER_ERROR", retryable: true };
  return { code: "BC_BAD_REQUEST", retryable: false };
}
