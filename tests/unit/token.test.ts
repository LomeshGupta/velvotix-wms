import { describe, expect, it, vi } from "vitest";
import { TokenManager } from "@/lib/business-central/auth";
import { parseConfig } from "@/lib/business-central/config";

const U = "3d410f00-0000-4000-8000-000000000001";
const cfg = parseConfig({ WMS_BC_MODE: "live", NODE_ENV: "test", BC_TENANT_ID: U, BC_CLIENT_ID: U, BC_CLIENT_SECRET: "s", BC_COMPANY_ID: U, BC_COMPANY_NAME: "C", BC_ENV_NAME: "sb", WMS_SESSION_SECRET: "x".repeat(32) });

const ok = (expires = 3600) => new Response(JSON.stringify({ access_token: "tok", expires_in: expires }), { status: 200 });

describe("token manager", () => {
  it("shares one acquisition between 50 concurrent callers (single-flight)", async () => {
    const f = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); return ok(); });
    const tm = new TokenManager(cfg, { fetchImpl: f as unknown as typeof fetch });
    const all = await Promise.all(Array.from({ length: 50 }, () => tm.getToken()));
    expect(new Set(all).size).toBe(1);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("refreshes inside the safety margin and reuses outside it", async () => {
    let t = 0;
    const f = vi.fn(async () => ok(3600));
    const tm = new TokenManager(cfg, { fetchImpl: f as unknown as typeof fetch, now: () => t, refreshMarginMs: 300_000 });
    await tm.getToken(); t = 3_000_000; await tm.getToken();
    expect(f).toHaveBeenCalledTimes(1);
    t = 3_400_000; await tm.getToken();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("does not leak provider error bodies and recovers after a failure", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("client_secret=SUPER invalid", { status: 401 }))
      .mockResolvedValueOnce(ok());
    const tm = new TokenManager(cfg, { fetchImpl: f as unknown as typeof fetch });
    await expect(tm.getToken()).rejects.toThrow(/authentication failed/);
    await expect(tm.getToken()).resolves.toBe("tok");
  });
  it("rejects malformed token responses", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: "x" }), { status: 200 }));
    await expect(new TokenManager(cfg, { fetchImpl: f as unknown as typeof fetch }).getToken()).rejects.toThrow();
  });
});
