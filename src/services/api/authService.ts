import { bcRequest } from "./bcRequest";
import type { LoginResponse, SessionResponse } from "./schemas";

export function login(userId: string, password: string): Promise<LoginResponse> {
  return bcRequest<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: { userId: userId.trim(), password },
  });
}

export function logout(): Promise<{ ok: boolean }> {
  return bcRequest<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

export function getSession(signal?: AbortSignal): Promise<SessionResponse> {
  return bcRequest<SessionResponse>("/api/auth/session", { signal });
}
