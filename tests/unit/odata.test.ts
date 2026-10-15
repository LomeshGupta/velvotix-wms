import { describe, expect, it } from "vitest";
import { OPERATIONS } from "@/lib/business-central/endpoints";
import { buildQuery } from "@/lib/validation/odata";

const items = OPERATIONS["items.list"].query;
const tx = OPERATIONS["transactions.list"].query;

describe("OData query validation", () => {
  it("doubles single quotes so values cannot break out of the literal", () => {
    const q = buildQuery(items, { filter: [{ field: "displayName", op: "contains", value: "x') or (1 eq 1" }] });
    expect(q.params.get("$filter")).toBe("(contains(displayName,'x'') or (1 eq 1'))");
  });
  it("rejects unknown fields, operators and unsortable fields", () => {
    expect(() => buildQuery(items, { filter: [{ field: "secret", op: "eq", value: "a" }] })).toThrow();
    expect(() => buildQuery(items, { filter: [{ field: "gtin", op: "contains", value: "a" }] })).toThrow();
    expect(() => buildQuery(items, { orderBy: [{ field: "inventory" }] })).toThrow();
    expect(() => buildQuery(items, { select: ["nope"] })).toThrow();
  });
  it("enforces type checks and the page-size ceiling", () => {
    expect(() => buildQuery(items, { filter: [{ field: "blocked", op: "eq", value: "false" }] })).toThrow();
    expect(() => buildQuery(items, { top: 101 })).toThrow();
    expect(() => buildQuery(items, { top: 0 })).toThrow();
  });
  it("rejects control characters and oversized values", () => {
    expect(() => buildQuery(items, { filter: [{ field: "displayName", op: "eq", value: "a\nb" }] })).toThrow();
    expect(() => buildQuery(items, { filter: [{ field: "displayName", op: "eq", value: "a".repeat(201) }] })).toThrow();
  });
  it("combines server scope with user filters using AND, so users can only narrow", () => {
    const q = buildQuery(tx, { filter: [{ field: "status", op: "eq", value: "Failed" }] }, [{ field: "locationCode", op: "in", value: ["MAIN", "EAST"] }]);
    expect(q.params.get("$filter")).toBe("(status eq 'Failed') and (locationCode eq 'MAIN' or locationCode eq 'EAST')");
  });
  it("produces a stable canonical string regardless of select order", () => {
    const a = buildQuery(items, { select: ["number", "displayName"] }).canonical;
    const b = buildQuery(items, { select: ["displayName", "number"] }).canonical;
    expect(a).toBe(b);
  });
  it("gives different canonical queries (hence cache keys) to different warehouse scopes", () => {
    const a = buildQuery(tx, {}, [{ field: "locationCode", op: "in", value: ["MAIN"] }]).canonical;
    const b = buildQuery(tx, {}, [{ field: "locationCode", op: "in", value: ["EAST"] }]).canonical;
    expect(a).not.toBe(b);
  });
});
