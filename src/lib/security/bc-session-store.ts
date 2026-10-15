import "server-only";
import { z } from "zod";
import type { BcGateway } from "@/lib/business-central/client";
import { BC_GUID_RE } from "@/lib/business-central/guid";
import type { Coordinator } from "@/lib/business-central/coordinator";
import { SYSTEM_PRINCIPAL } from "@/types/principal";
import type { SessionRecord, SessionStore } from "./session";

const Row = z.object({
  id: z.string().regex(BC_GUID_RE, "Invalid Business Central GUID"),
  sessionHash: z.string(),
  userId: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  ipHash: z.string().default(""),
  userAgent: z.string().default(""),
  revoked: z.boolean().default(false),
});
type SessionRow = z.infer<typeof Row>;

const sys = { principal: SYSTEM_PRINCIPAL };
const SELECT = ["id", "sessionHash", "userId", "createdAt", "lastSeenAt", "ipHash", "userAgent", "revoked"];

/**
 * Session store in the VWMS Session table. Sessions are validated on every request, so reads are
 * cached briefly (cross-instance revocation takes effect within CACHE_TTL_MS; revocation on the
 * serving instance is immediate). Keys are sha256 hashes of the opaque cookie token.
 *
 * BC upper-cases Code fields, so hashes are compared case-insensitively (the cookie hash is
 * lower-case hex; BC returns it upper-case).
 */
const CACHE_TTL_MS = 15_000;

function toRecord(r: SessionRow): SessionRecord {
  return {
    idHash: r.sessionHash.toLowerCase(),
    userId: r.userId,
    createdAt: Date.parse(r.createdAt),
    lastSeenAt: Date.parse(r.lastSeenAt),
    ipHash: r.ipHash,
    userAgent: r.userAgent,
    revoked: r.revoked,
  };
}

export class BcSessionStore implements SessionStore {
  constructor(
    private readonly gateway: BcGateway,
    private readonly coordinator: Coordinator,
  ) {}

  private cacheKey(idHash: string): string {
    return `sess:${idHash.toLowerCase()}`;
  }

  private async fetchRow(idHash: string): Promise<SessionRow | undefined> {
    const r = await this.gateway.read<Record<string, unknown>>(
      "sessions.get",
      { select: SELECT, filter: [{ field: "sessionHash", op: "eq", value: idHash }], top: 1 },
      sys,
    );
    return r.rows[0] ? Row.parse(r.rows[0]) : undefined;
  }

  private async cachePut(row: SessionRow): Promise<void> {
    await this.coordinator.cacheSet(this.cacheKey(row.sessionHash), JSON.stringify(row), CACHE_TTL_MS).catch(() => undefined);
  }

  async create(rec: SessionRecord): Promise<void> {
    await this.gateway.create(
      "sessions.create",
      {
        sessionHash: rec.idHash,
        userId: rec.userId,
        createdAt: new Date(rec.createdAt).toISOString(),
        lastSeenAt: new Date(rec.lastSeenAt).toISOString(),
        ipHash: rec.ipHash,
        userAgent: rec.userAgent,
        revoked: false,
      },
      sys,
    );
  }

  async get(idHash: string): Promise<SessionRecord | undefined> {
    const cached = await this.coordinator.cacheGet(this.cacheKey(idHash)).catch(() => null);
    if (cached) return toRecord(Row.parse(JSON.parse(cached)));
    const row = await this.fetchRow(idHash);
    if (!row) return undefined;
    await this.cachePut(row);
    return toRecord(row);
  }

  async touch(idHash: string, at: number): Promise<void> {
    const row = await this.fetchRow(idHash); // uncached: we need the record id
    if (!row || row.revoked) return;
    const lastSeenAt = new Date(at).toISOString();
    await this.gateway.patch("sessions.update", row.id, { lastSeenAt }, sys);
    await this.cachePut({ ...row, lastSeenAt });
  }

  async revoke(idHash: string): Promise<void> {
    const row = await this.fetchRow(idHash);
    if (!row) return;
    await this.gateway.patch("sessions.update", row.id, { revoked: true, revokedBy: row.userId }, sys);
    await this.cachePut({ ...row, revoked: true }); // immediate on this instance
  }

  async listForUser(userId: string): Promise<SessionRecord[]> {
    const r = await this.gateway.read<Record<string, unknown>>(
      "sessions.get",
      { select: SELECT, filter: [{ field: "userId", op: "eq", value: userId }, { field: "revoked", op: "eq", value: false }], top: 50 },
      sys,
    );
    return r.rows.map((x) => toRecord(Row.parse(x)));
  }
}
