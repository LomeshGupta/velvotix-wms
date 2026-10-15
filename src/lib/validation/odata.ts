import { GatewayError } from "@/lib/business-central/errors";
import { encodeODataEnum } from "@/lib/business-central/odata-enum";

/**
 * Callers never supply raw OData. They supply a structured query that is
 * validated against the endpoint's declared fields, then serialised here.
 */

export type FieldType = "string" | "number" | "boolean" | "guid" | "date" | "enum";

export type FilterOp = "eq" | "ne" | "gt" | "ge" | "lt" | "le" | "contains" | "startswith" | "in";

export interface FieldSpec {
  type: FieldType;
  /** Required for type "enum": the allowed labels (human-readable, as shown in BC). */
  values?: readonly string[];
  filterable?: boolean;
  sortable?: boolean;
  /** Operators allowed for this field. Defaults depend on type. */
  ops?: readonly FilterOp[];
}

export interface QuerySpec {
  fields: Readonly<Record<string, FieldSpec>>;
  maxTop: number;
  defaultTop: number;
  defaultSelect: readonly string[];
}

export type Scalar = string | number | boolean;

export interface FilterClause {
  field: string;
  op: FilterOp;
  /** An array is only valid with op "in" (max 20 values). */
  value: Scalar | readonly Scalar[];
}

export interface StructuredQuery {
  select?: readonly string[];
  filter?: readonly FilterClause[];
  orderBy?: readonly { field: string; dir?: "asc" | "desc" }[];
  top?: number;
  skip?: number;
}

const DEFAULT_OPS: Record<FieldType, readonly FilterOp[]> = {
  string: ["eq", "ne", "contains", "startswith", "in"],
  number: ["eq", "ne", "gt", "ge", "lt", "le"],
  boolean: ["eq", "ne"],
  guid: ["eq", "ne"],
  date: ["eq", "ne", "gt", "ge", "lt", "le"],
  enum: ["eq", "ne", "in"],
};

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z)?$/;
const IDENT_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_STRING = 200;
const MAX_CLAUSES = 8;

const bad = (msg: string): GatewayError => new GatewayError("INVALID_QUERY", msg);

/** OData string literal: single quotes doubled, control characters rejected. */
export function odataString(value: string): string {
  if (/[\u0000-\u001f]/.test(value)) throw bad("Control characters are not allowed in filter values");
  if (value.length > MAX_STRING) throw bad("Filter value too long");
  return `'${value.replace(/'/g, "''")}'`;
}

function literal(field: string, spec: FieldSpec, value: unknown): string {
  switch (spec.type) {
    case "string":
      if (typeof value !== "string") throw bad(`${field} expects a string`);
      return odataString(value);
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw bad(`${field} expects a finite number`);
      return String(value);
    case "boolean":
      if (typeof value !== "boolean") throw bad(`${field} expects a boolean`);
      return value ? "true" : "false";
    case "guid":
      if (typeof value !== "string" || !GUID_RE.test(value)) throw bad(`${field} expects a GUID`);
      return value.toLowerCase();
    case "enum":
      if (typeof value !== "string" || !spec.values?.includes(value)) throw bad(`${field} must be one of its allowed values`);
      return `'${encodeODataEnum(value)}'`;
    case "date":
      if (typeof value !== "string" || !DATE_RE.test(value)) throw bad(`${field} expects an ISO date`);
      return value;
  }
}

function clauseToOData(clause: FilterClause, spec: QuerySpec): string {
  const f = spec.fields[clause.field];
  if (!f || !f.filterable) throw bad(`Field '${clause.field}' cannot be filtered`);
  const allowed = f.ops ?? DEFAULT_OPS[f.type];
  if (!allowed.includes(clause.op)) throw bad(`Operator '${clause.op}' is not allowed on '${clause.field}'`);
  if (clause.op === "in") {
    if (!Array.isArray(clause.value) || clause.value.length === 0 || clause.value.length > 20) {
      throw bad(`'in' on '${clause.field}' needs 1-20 values`);
    }
    const parts = (clause.value as readonly Scalar[]).map((v) => `${clause.field} eq ${literal(clause.field, f, v)}`);
    return parts.join(" or ");
  }
  if (Array.isArray(clause.value)) throw bad(`'${clause.op}' does not accept a list`);
  const lit = literal(clause.field, f, clause.value);
  if (clause.op === "contains" || clause.op === "startswith") return `${clause.op}(${clause.field},${lit})`;
  return `${clause.field} ${clause.op} ${lit}`;
}

export interface BuiltQuery {
  params: URLSearchParams;
  /** The validated field list; the gateway projects every row to exactly these fields. */
  select: string[];
  /** Stable string used for cache keys and request de-duplication. */
  canonical: string;
}

/**
 * `serverFilters` are appended by the server (user/warehouse scope) and are
 * trusted; they are still serialised through the same type-checked path.
 */
export function buildQuery(
  spec: QuerySpec,
  query: StructuredQuery = {},
  serverFilters: readonly FilterClause[] = [],
): BuiltQuery {
  const select = [...(query.select?.length ? query.select : spec.defaultSelect)];
  for (const s of select) {
    if (!IDENT_RE.test(s) || !spec.fields[s]) throw bad(`Field '${s}' cannot be selected`);
  }

  const clauses = [...(query.filter ?? []), ...serverFilters];
  if (clauses.length > MAX_CLAUSES) throw bad("Too many filter clauses");
  const filterParts = clauses.map((c) => clauseToOData(c, spec));

  const orderParts = (query.orderBy ?? []).map((o) => {
    const f = spec.fields[o.field];
    if (!f || !f.sortable) throw bad(`Field '${o.field}' cannot be sorted`);
    return `${o.field} ${o.dir === "desc" ? "desc" : "asc"}`;
  });
  if (orderParts.length > 2) throw bad("At most two sort fields are allowed");

  const top = query.top ?? spec.defaultTop;
  if (!Number.isInteger(top) || top < 1 || top > spec.maxTop) throw bad(`top must be between 1 and ${spec.maxTop}`);
  const skip = query.skip ?? 0;
  if (!Number.isInteger(skip) || skip < 0 || skip > 100_000) throw bad("skip is out of range");

  const params = new URLSearchParams();
  params.set("$select", [...select].sort().join(","));
  if (filterParts.length) params.set("$filter", filterParts.map((p) => `(${p})`).join(" and "));
  if (orderParts.length) params.set("$orderby", orderParts.join(","));
  params.set("$top", String(top));
  if (skip) params.set("$skip", String(skip));

  return { params, select: [...select], canonical: params.toString() };
}
