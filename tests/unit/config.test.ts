import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "@/lib/business-central/config";

const UUID = "3d410f00-0000-4000-8000-000000000001";
const live = {
  WMS_BC_MODE: "live", NODE_ENV: "development", BC_TENANT_ID: UUID, BC_CLIENT_ID: UUID, BC_CLIENT_SECRET: "s",
  BC_COMPANY_ID: UUID, BC_COMPANY_NAME: "My Company", BC_ENV_NAME: "sandbox-IN", WMS_SESSION_SECRET: "x".repeat(32),
};

describe("config validation", () => {
  it("accepts a valid live config and applies conservative defaults", () => {
    const c = parseConfig(live);
    expect(c.scheduler.maxConcurrent).toBe(4);
    expect(c.scheduler.maxRetries).toBe(2);
  });
  it("rejects mock mode in production", () => {
    expect(() => parseConfig({ ...live, NODE_ENV: "production", WMS_BC_MODE: "mock" })).toThrow(ConfigError);
  });
  it("generates an ephemeral secret for local mock or live-sandbox development", () => {
    const c = parseConfig({ WMS_BC_MODE: "mock", NODE_ENV: "development" });
    const liveNoSecret = { ...live };
    delete (liveNoSecret as { WMS_SESSION_SECRET?: string }).WMS_SESSION_SECRET;
    expect(c.sessionSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(parseConfig(liveNoSecret).sessionSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });
  it("still requires an explicit session secret in production", () => {
    const { WMS_SESSION_SECRET: _secret, ...liveWithoutSecret } = live;
    void _secret;
    expect(() => parseConfig({ ...liveWithoutSecret, NODE_ENV: "production" })).toThrow(/sessionSecret/);
  });
  it("accepts a company display name and defers GUID resolution to the companies API", () => {
    const config = parseConfig({ ...live, BC_COMPANY_ID: "Velvotix Sandbox", BC_COMPANY_NAME: "My Company" });
    expect(config.companyId).toBe("00000000-0000-0000-0000-000000000000");
    expect(config.companyLookupHint).toBe("Velvotix Sandbox");
    expect(config.companyResolved).toBe(false);
  });
  it("rejects a secret exposed through NEXT_PUBLIC_", () => {
    expect(() => parseConfig({ ...live, NEXT_PUBLIC_BC_CLIENT_SECRET: "leak" })).toThrow(/NEXT_PUBLIC_/);
  });
  it("rejects legacy aliases instead of silently honouring them", () => {
    expect(() => parseConfig({ ...live, NEXT_ENV_NAME: "prod" })).toThrow(/BC_ENV_NAME/);
  });
  it("accepts non-secret NEXT_PUBLIC identifiers as documented fallbacks", () => {
    const { BC_TENANT_ID, ...rest } = live;
    void BC_TENANT_ID;
    expect(parseConfig({ ...rest, NEXT_PUBLIC_BC_TENANT_ID: UUID }).tenantId).toBe(UUID);
  });
  it("replaces a short development secret but rejects one in production and rejects non-https", () => {
    expect(parseConfig({ ...live, WMS_SESSION_SECRET: "short" }).sessionSecret.length).toBeGreaterThanOrEqual(32);
    expect(() => parseConfig({ ...live, NODE_ENV: "production", WMS_SESSION_SECRET: "short" })).toThrow(ConfigError);
    expect(() => parseConfig({ ...live, BC_API_BASE_URL: "http://example.com" })).toThrow(ConfigError);
  });
});
