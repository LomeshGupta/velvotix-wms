"use client";

// Compatibility re-exports. New UI and hooks should import from services/api.
export { ApiError, apiFetch, bcRequest, friendlyMessage } from "@/services/api/bcRequest";
export type { BcRequestOptions } from "@/services/api/bcRequest";
