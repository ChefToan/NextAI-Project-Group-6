// Semantic layer for the custom report engine.
//
// This module is intentionally free of server-only imports so the builder UI can
// import the metadata (labels, types, operators, options) directly. The SQL
// fragments here are static, developer-authored strings — never user input — and
// are the ONLY things concatenated into a query. All user-supplied *values* are
// passed as Oracle bind parameters by lib/build-report-sql.ts.
//
// Adding a new field to the custom report engine is a one-entry change here:
// give it an id, label, a SQL expression, and which source(s) it needs.

export type SourceId = "base" | "revenue";
export type FieldType = "text" | "number" | "date";
export type FilterOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  eq: "=",
  ne: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "contains",
  in: "in list",
};

// Comparison operators valid against an aggregated measure (rendered as HAVING).
export const MEASURE_FILTER_OPS: FilterOp[] = ["eq", "ne", "gt", "gte", "lt", "lte"];

export type CatalogDimension = {
  id: string;
  label: string;
  group: string;
  type: FieldType;
  sql: string; // grouping expression, no alias
  needs: SourceId[];
  filterOps: FilterOp[];
  options?: string[]; // suggested values for enum-like fields
  valueAliases?: Record<string, string>; // natural-language aliases normalized by AI drafts
};

export type CatalogMeasure = {
  id: string;
  label: string;
  group: string;
  unit?: string;
  sql: string; // aggregate expression
  needs: SourceId[];
};

// Join fragments per optional source. `base` is the FROM clause in the builder.
// `revenue` is the per-event USD balance impact (resource 840); it is 1:1 with a
// usage event, so joining it does not fan out volume/token measures.
export const CUSTOM_SOURCES: Record<SourceId, { join?: string }> = {
  base: {},
  revenue: {
    join: "left join event_bal_impacts_t bi on bi.obj_id0 = e.poid_id0 and bi.resource_id = 840",
  },
};

const REVENUE_TYPE_SQL =
  "case nvl(to_char(bi.gl_id),'0') when '102' then 'recurring' when '104' then 'usage' when '0' then 'unassigned' else 'other' end";

const DAY_SQL = "to_char(date '1970-01-01' + e.start_t/86400,'YYYY-MM-DD')";

export const CATALOG_DIMENSIONS: CatalogDimension[] = [
  { id: "account_id", label: "Account ID", group: "Account", type: "number", sql: "e.account_obj_id0", needs: ["base"], filterOps: ["eq", "ne", "in"] },
  {
    id: "model",
    label: "Model",
    group: "Usage",
    type: "text",
    sql: "u.model_code2_g6",
    needs: ["base"],
    filterOps: ["eq", "ne", "in"],
    options: ["3.0", "3.5"],
    valueAliases: { "Odyssey 3.0": "3.0", "Odyssey 3.5": "3.5" },
  },
  { id: "rum_name", label: "Billing metric (RUM)", group: "Usage", type: "text", sql: "e.rum_name", needs: ["base"], filterOps: ["eq", "ne", "contains"], options: ["PromptG6", "TokensG6"] },
  { id: "event_day", label: "Day", group: "Time", type: "date", sql: DAY_SQL, needs: ["base"], filterOps: ["eq", "gte", "lte"] },
  { id: "event_month", label: "Month", group: "Time", type: "text", sql: "to_char(date '1970-01-01' + e.start_t/86400,'YYYY-MM')", needs: ["base"], filterOps: ["eq"] },
  { id: "event_hour", label: "Hour of day", group: "Time", type: "number", sql: "to_number(to_char(date '1970-01-01' + e.start_t/86400,'HH24'))", needs: ["base"], filterOps: ["eq", "gte", "lte"] },
  { id: "gl_id", label: "GL ID", group: "Revenue", type: "text", sql: "nvl(to_char(bi.gl_id),'0')", needs: ["base", "revenue"], filterOps: ["eq", "in"] },
  { id: "revenue_type", label: "Revenue type", group: "Revenue", type: "text", sql: REVENUE_TYPE_SQL, needs: ["base", "revenue"], filterOps: ["eq", "in"], options: ["recurring", "usage", "unassigned", "other"] },
];

export const CATALOG_MEASURES: CatalogMeasure[] = [
  { id: "event_count", label: "Usage events", group: "Volume", sql: "count(*)", needs: ["base"] },
  { id: "active_accounts", label: "Distinct accounts", group: "Volume", sql: "count(distinct e.account_obj_id0)", needs: ["base"] },
  { id: "prompts", label: "Prompts", group: "Volume", sql: "sum(case when e.rum_name = 'PromptG6' then 1 else 0 end)", needs: ["base"] },
  { id: "input_tokens", label: "Input tokens", group: "Tokens", sql: "sum(u.input_tokens2_g6)", needs: ["base"] },
  { id: "output_tokens", label: "Output tokens", group: "Tokens", sql: "sum(u.output_tokens2_g6)", needs: ["base"] },
  { id: "total_tokens", label: "Total tokens", group: "Tokens", sql: "sum(u.input_tokens2_g6 + u.output_tokens2_g6)", needs: ["base"] },
  { id: "token_blocks", label: "Token blocks (1k)", group: "Tokens", unit: "blocks", sql: "round(sum(u.input_tokens2_g6 + u.output_tokens2_g6)/1000, 2)", needs: ["base"] },
  { id: "usage_revenue", label: "Usage revenue USD", group: "Revenue", unit: "USD", sql: "round(nvl(sum(bi.amount),0), 2)", needs: ["base", "revenue"] },
];

export function getDimension(id: string): CatalogDimension | undefined {
  return CATALOG_DIMENSIONS.find((dimension) => dimension.id === id);
}

export function getMeasure(id: string): CatalogMeasure | undefined {
  return CATALOG_MEASURES.find((measure) => measure.id === id);
}

export function catalogLabel(id: string): string {
  return getDimension(id)?.label ?? getMeasure(id)?.label ?? id;
}
