"use client";

import { useSessionStore } from "@/store/uiStore";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterMs?: number,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get retryable(): boolean {
    return this.status === 429 || this.status === 503;
  }
}

const FRIENDLY: Record<string, string> = {
  QUEUE_FULL: "The system is busy. Try again in a moment.",
  RATE_LIMITED: "Too many requests. Wait a few seconds and try again.",
  CIRCUIT_OPEN:
    "Business Central is temporarily unavailable. Try again shortly.",
  TIMEOUT: "Business Central took too long to respond.",
  NETWORK: "Could not reach the server. Check the connection and try again.",
  OUTCOME_UNKNOWN:
    "We could not confirm the result. Check the transaction list before retrying.",
  UNAUTHENTICATED: "Your session has ended. Sign in again.",
  FORBIDDEN: "You do not have permission for this action.",
  ENDPOINT_NOT_ALLOWED: "You do not have access to this location or action.",
  CSRF: "Your session could not be verified. Reload the page and try again.",
  ITEM_NOT_FOUND: "No item matches this code.",
  BC_CONFLICT: "This receipt was already submitted with different contents.",
  VALIDATION: "Some details are missing or not valid.",
};

type JsonRecord = Record<string, unknown>;

// Redact credentials, cookies, session identifiers and common secrets.
const SENSITIVE_KEY =
  /(password|token|secret|authorization|cookie|csrf|session|pin|hash|credential|api[-_]?key)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  const result: JsonRecord = {};

  for (const [key, item] of Object.entries(value as JsonRecord)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? "[REDACTED]"
      : redact(item, depth + 1);
  }

  return result;
}

function makeCorrelationId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `wms-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }
}

const DEBUG_LOG = process.env.NODE_ENV !== "production";

function logRequest(
  correlationId: string,
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): void {
  if (!DEBUG_LOG) return;
  console.groupCollapsed(
    `%c[WMS API REQUEST] ${method} ${url}`,
    "color:#1976d2;font-weight:bold",
  );

  console.log("Time:", new Date().toISOString());
  console.log("Correlation ID:", correlationId);
  console.log("URL:", url);
  console.log("Method:", method);
  console.log("Headers:", redact(headers));
  console.log("Request body:", redact(body ?? null));
  console.groupEnd();
}

function logResponse(
  correlationId: string,
  method: string,
  url: string,
  status: number,
  body: unknown,
  durationMs: number,
): void {
  if (!DEBUG_LOG) return;
  const failed = status === 0 || status >= 400;

  console.groupCollapsed(
    `%c[WMS API ${failed ? "ERROR" : "RESPONSE"}] ${status} ${method} ${url} (${durationMs} ms)`,
    `color:${failed ? "#d32f2f" : "#2e7d32"};font-weight:bold`,
  );

  console.log("Time:", new Date().toISOString());
  console.log("Correlation ID:", correlationId);
  console.log("URL:", url);
  console.log("Method:", method);
  console.log("Status:", status);
  console.log("Duration:", `${durationMs} ms`);
  console.log("Response body:", redact(body));
  console.groupEnd();
}

export function friendlyMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return (
      FRIENDLY[error.code] ??
      "Something went wrong. Check the request details in the Console."
    );
  }

  return "Something went wrong. Check the connection and try again.";
}

export interface BcRequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}

export async function bcRequest<T>(
  path: string,
  options: BcRequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const correlationId = makeCorrelationId();

  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-correlation-id": correlationId,
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (method !== "GET") {
    const csrf = useSessionStore.getState().csrfToken;

    if (csrf) {
      headers["x-csrf-token"] = csrf;
    }
  }

  const requestUrl = new URL(path, window.location.origin).toString();
  const started = Date.now();

  logRequest(correlationId, method, requestUrl, headers, options.body);

  let response: Response;

  try {
    response = await fetch(path, {
      method,
      headers,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    const durationMs = Date.now() - started;

    logResponse(
      correlationId,
      method,
      requestUrl,
      0,
      {
        error: error instanceof Error ? error.message : "Unknown network error",
      },
      durationMs,
    );

    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    throw new ApiError(0, "NETWORK", "Network error", undefined, correlationId);
  }

  const rawResponse = await response.text().catch(() => "");

  let payload: unknown = {};

  if (rawResponse) {
    try {
      payload = JSON.parse(rawResponse) as unknown;
    } catch {
      payload = { message: rawResponse.slice(0, 2000) };
    }
  }

  const durationMs = Date.now() - started;

  logResponse(
    correlationId,
    method,
    requestUrl,
    response.status,
    payload,
    durationMs,
  );

  if (response.ok) {
    return payload as T;
  }

  const data = payload as {
    error?: {
      code?: string;
      message?: string;
      correlationId?: string;
    };
  };

  const code = data.error?.code ?? "ERROR";
  const responseCorrelation =
    data.error?.correlationId ??
    response.headers.get("x-correlation-id") ??
    correlationId;

  if (
    response.status === 401 &&
    typeof window !== "undefined" &&
    !window.location.pathname.startsWith("/login")
  ) {
    window.location.assign(
      `/login?next=${encodeURIComponent(window.location.pathname)}`,
    );
  }

  const retryAfter = Number(response.headers.get("retry-after"));

  throw new ApiError(
    response.status,
    code,
    data.error?.message ?? "Request failed",
    Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : undefined,
    responseCorrelation,
  );
}

export const apiFetch = bcRequest;
