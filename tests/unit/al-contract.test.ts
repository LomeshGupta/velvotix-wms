import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERATIONS } from "@/lib/business-central/endpoints";

/**
 * Static cross-check between the web tier's endpoint registry and the AL source. It cannot prove
 * the AL compiles or behaves, but it catches the most likely integration failure: a renamed or
 * missing entity, field, or action parameter on one side only.
 */
const AL_API_DIR = join(__dirname, "../../al/src/API");
const CODEUNIT_FILES: Record<string, string> = {
  VWMSWorker: join(
    __dirname,
    "../../al/src/Codeunits/VWMSWorkerAPI.Codeunit.al",
  ),
  VWMSAuth: join(
    __dirname,
    "../../al/src/Codeunits/VWMSAuthenticationAPI.Codeunit.al",
  ),
};

interface AlField {
  editable: boolean;
}
interface AlPage {
  fields: Map<string, AlField>;
  parts: Set<string>;
}

function loadPages(): Map<string, AlPage> {
  const pages = new Map<string, AlPage>();
  for (const file of readdirSync(AL_API_DIR)) {
    const src = readFileSync(join(AL_API_DIR, file), "utf8");
    const set = /EntitySetName\s*=\s*'(\w+)'/.exec(src)?.[1];
    if (!set) continue;
    const fields = new Map<string, AlField>();
    for (const m of src.matchAll(/^\s*field\((\w+);[^)]*\)\s*\{([^}]*)\}/gm)) {
      fields.set(m[1]!, { editable: !/Editable\s*=\s*false/.test(m[2]!) });
    }
    const parts = new Set(
      [...src.matchAll(/EntitySetName\s*=\s*'(\w+)'/g)].map((m) => m[1]!),
    );
    pages.set(set, { fields, parts });
  }
  return pages;
}

function loadProcedures(
  file: string,
): Map<string, { params: string[]; returns: string; serviceEnabled: boolean }> {
  const src = readFileSync(file, "utf8");
  const out = new Map<
    string,
    { params: string[]; returns: string; serviceEnabled: boolean }
  >();
  for (const m of src.matchAll(/^\s*procedure\s+(\w+)\(([^)]*)\)([^\n]*)/gm)) {
    const params = m[2]!
      .split(";")
      .map((p) => p.trim().split(":")[0]!.trim())
      .filter(Boolean);
    const after = m[3] ?? "";
    const returns =
      /(?:^|\s)\w+\s*:\s*(Text|Boolean|Integer|Decimal|Date|DateTime)\b/i.exec(
        after,
      )?.[1] ??
      /^\s*:\s*(Text|Boolean|Integer|Decimal|Date|DateTime)\b/i.exec(
        after,
      )?.[1] ??
      "";
    const before = src.slice(Math.max(0, m.index! - 80), m.index!);
    out.set(m[1]!, {
      params,
      returns,
      serviceEnabled: /\[ServiceEnabled\]\s*$/.test(before.trimEnd()),
    });
  }
  return out;
}

const pages = loadPages();
const proceduresByService = Object.fromEntries(
  Object.entries(CODEUNIT_FILES).map(([service, file]) => [
    service,
    loadProcedures(file),
  ]),
) as Record<string, ReturnType<typeof loadProcedures>>;
const procedures = proceduresByService.VWMSWorker;
const ops = Object.entries(OPERATIONS) as [
  string,
  (typeof OPERATIONS)[keyof typeof OPERATIONS],
][];

describe("web tier registry vs AL API pages", () => {
  it("found the AL sources", () => {
    expect(pages.size).toBeGreaterThanOrEqual(7);
    expect(procedures).toBeDefined();
    expect(procedures!.size).toBeGreaterThanOrEqual(5);
  });

  for (const [key, op] of ops) {
    if (op.method === "ACTION") continue;
    if (op.api !== "custom") continue;
    it(`${key}: entity '${op.entity}' exists as an AL API page`, () => {
      expect(
        pages.has(op.entity),
        `no AL page with EntitySetName '${op.entity}'`,
      ).toBe(true);
    });
    if (op.method === "GET") {
      it(`${key}: every registered field exists on the AL page`, () => {
        const page = pages.get(op.entity)!;
        const missing = Object.keys(op.query.fields).filter(
          (f) => !page.fields.has(f),
        );
        expect(missing).toEqual([]);
      });
    }
    if (op.method === "PATCH") {
      it(`${key}: every patchable field exists and is editable in AL`, () => {
        const page = pages.get(op.entity)!;
        for (const f of Object.keys(op.fields)) {
          expect(
            page.fields.has(f),
            `AL page '${op.entity}' has no field '${f}'`,
          ).toBe(true);
          expect(
            page.fields.get(f)?.editable,
            `AL field '${f}' is read-only`,
          ).toBe(true);
        }
      });
    }
  }

  it("transactions.submit body fields exist and are editable on insert", () => {
    const page = pages.get("transactions")!;
    for (const f of [
      "idempotencyKey",
      "operationType",
      "locationCode",
      "wmsUserId",
      "sourceDocumentType",
      "sourceDocumentNo",
      "correlationId",
      "payloadHash",
    ]) {
      expect(page.fields.get(f)?.editable, f).toBe(true);
    }
    // Server-controlled fields must not be client-settable.
    for (const f of [
      "status",
      "attemptCount",
      "errorCode",
      "resultDocumentNo",
      "completedAt",
    ]) {
      expect(page.fields.get(f)?.editable, f).toBe(false);
    }
  });

  it("transactions page deep-inserts lines", () => {
    expect(pages.has("transactionLines")).toBe(true);
    expect(
      readFileSync(join(AL_API_DIR, "VWMSTransactionsAPI.Page.al"), "utf8"),
    ).toMatch(/EntitySetName\s*=\s*'lines'/);
  });
});

describe("web tier worker actions vs AL VWMSWorker codeunit", () => {
  const actions = ops.filter(([, op]) => op.method === "ACTION") as [
    string,
    Extract<(typeof OPERATIONS)[keyof typeof OPERATIONS], { method: "ACTION" }>,
  ][];
  for (const [key, op] of actions) {
    const serviceProcedures = proceduresByService[op.service];

    if (!serviceProcedures) {
      throw new Error(`No AL procedures found for service '${op.service}'`);
    }

    it(`${key}: AL procedure ${op.service}.${op.action} exists with the same parameter names`, () => {
      const proc = serviceProcedures.get(op.action);

      expect(proc, `no AL procedure '${op.action}'`).toBeDefined();

      // BC exposes parameters with their AL names, camel-cased by OData;
      // compare case-insensitively.
      expect(proc!.params.map((p) => p.toLowerCase())).toEqual(
        Object.keys(op.params).map((p) => p.toLowerCase()),
      );
    });

    it(`${key}: return type matches (${op.returns})`, () => {
      const proc = serviceProcedures.get(op.action)!;

      expect(proc.returns).toBe(op.returns === "boolean" ? "Boolean" : "Text");

      expect(
        proc.serviceEnabled,
        "OData codeunit procedures must be marked ServiceEnabled",
      ).toBe(true);
    });
  }
});

describe("automatic ODataV4 service registration", () => {
  for (const filename of [
    "VWMSInstall.Codeunit.al",
    "VWMSUpgrade.Codeunit.al",
  ]) {
    it(`${filename} publishes auth and worker codeunits through Web Service Management`, () => {
      const src = readFileSync(
        join(__dirname, `../../al/src/Codeunits/${filename}`),
        "utf8",
      );
      expect(src).toMatch(/using System\.Integration;/);
      if (filename === "VWMSUpgrade.Codeunit.al")
        expect(src).toMatch(/trigger OnUpgradePerCompany\(\)/);
      expect(src).toMatch(
        /CreateTenantWebService\(object::Codeunit, ObjectId, ServiceName, true\)/,
      );
      expect(src).toMatch(
        /RegisterWebService\('VWMSWorker', Codeunit::"VWMS Worker API"\)/,
      );
      expect(src).toMatch(
        /RegisterWebService\('VWMSAuth', Codeunit::"VWMS Authentication API"\)/,
      );
      expect(src).not.toMatch(/Record\s+"Web Service"/i);
    });
  }
});
