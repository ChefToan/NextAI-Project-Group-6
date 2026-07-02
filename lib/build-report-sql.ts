import "server-only";
import { group6AccountSubquery } from "@/lib/group6-scope";
import type { UsageRange } from "@/lib/group6-usage";
import {
  CUSTOM_SOURCES,
  MEASURE_FILTER_OPS,
  getDimension,
  getMeasure,
  type CatalogDimension,
  type FilterOp,
  type SourceId,
} from "@/lib/metrics-catalog";

const BASE_FROM = "event_t e join EVENT_SESSION_USAGE2_G6 u on u.OBJ_ID0 = e.poid_id0";
export const MAX_CUSTOM_ROWS = 5000;

const OP_SQL: Record<FilterOp, string> = {
  eq: "=",
  ne: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  contains: "like",
  in: "in",
};

export type CustomFilter = { field: string; op: FilterOp; value: string | string[] };
export type CustomSort = { field: string; dir: "asc" | "desc" };
export type CustomSelection = {
  dimensions?: string[];
  measures?: string[];
  filters?: CustomFilter[];
  sort?: CustomSort | null;
  limit?: number;
};

export type BuiltReport = { sql: string; binds: Record<string, unknown>; columns: string[] };

function uniq(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value)))].filter(Boolean);
}

function clampRows(limit: unknown): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return MAX_CUSTOM_ROWS;
  return Math.min(Math.floor(n), MAX_CUSTOM_ROWS);
}

// Builds a safe, parameterized Oracle query from a validated catalog selection.
// Every structural token comes from the catalog (allow-list); every user value is
// a bind parameter. Throws with a human-readable message on any invalid input.
export function buildReportSql(selection: CustomSelection, range: UsageRange = {}): BuiltReport {
  const dims = uniq(selection.dimensions ?? []).map((id) => {
    const dimension = getDimension(id);
    if (!dimension) throw new Error(`Unknown dimension: ${id}`);
    return dimension;
  });
  const measures = uniq(selection.measures ?? []).map((id) => {
    const measure = getMeasure(id);
    if (!measure) throw new Error(`Unknown measure: ${id}`);
    return measure;
  });
  if (!measures.length) throw new Error("Select at least one measure.");

  const columns = [...dims.map((d) => d.id), ...measures.map((m) => m.id)];
  const needed = new Set<SourceId>(["base"]);
  for (const dimension of dims) dimension.needs.forEach((source) => needed.add(source));
  for (const measure of measures) measure.needs.forEach((source) => needed.add(source));

  const binds: Record<string, unknown> = {};
  let bindSeq = 0;
  const bind = (value: unknown): string => {
    const key = `b${(bindSeq += 1)}`;
    binds[key] = value;
    return `:${key}`;
  };

  const where: string[] = [
    "e.poid_type = '/event/session/usagegr6'",
    `e.account_obj_id0 in (${group6AccountSubquery()})`,
  ];
  const from = Number.isFinite(range.from) ? Math.floor(range.from as number) : null;
  const to = Number.isFinite(range.to) ? Math.floor(range.to as number) : null;
  if (from != null) where.push(`e.start_t >= ${bind(from)}`);
  if (to != null) where.push(`e.start_t <= ${bind(to)}`);

  const having: string[] = [];
  for (const filter of selection.filters ?? []) {
    const dimension = getDimension(filter.field);
    const measure = getMeasure(filter.field);
    if (dimension) {
      if (!dimension.filterOps.includes(filter.op)) {
        throw new Error(`Operator "${filter.op}" is not allowed on ${filter.field}.`);
      }
      dimension.needs.forEach((source) => needed.add(source));
      where.push(renderDimensionFilter(dimension, filter, bind));
    } else if (measure) {
      if (!MEASURE_FILTER_OPS.includes(filter.op)) {
        throw new Error(`Operator "${filter.op}" is not allowed on measure ${filter.field}.`);
      }
      measure.needs.forEach((source) => needed.add(source));
      const value = Number(Array.isArray(filter.value) ? filter.value[0] : filter.value);
      if (!Number.isFinite(value)) throw new Error(`Measure filter on ${filter.field} needs a number.`);
      having.push(`${measure.sql} ${OP_SQL[filter.op]} ${bind(value)}`);
    } else {
      throw new Error(`Unknown filter field: ${filter.field}`);
    }
  }

  const select = [
    ...dims.map((d) => `${d.sql} as ${d.id}`),
    ...measures.map((m) => `${m.sql} as ${m.id}`),
  ].join(", ");

  const joins = ([...needed] as SourceId[])
    .filter((source) => source !== "base")
    .map((source) => CUSTOM_SOURCES[source].join)
    .filter(Boolean)
    .join(" ");

  let orderBy = "";
  if (selection.sort && selection.sort.field) {
    const index = columns.indexOf(selection.sort.field);
    if (index === -1) throw new Error(`Sort field must be a selected column: ${selection.sort.field}`);
    orderBy = ` order by ${index + 1} ${selection.sort.dir === "asc" ? "asc" : "desc"}`;
  }

  const sql =
    `select ${select}` +
    ` from ${BASE_FROM}${joins ? ` ${joins}` : ""}` +
    ` where ${where.join(" and ")}` +
    (dims.length ? ` group by ${dims.map((d) => d.sql).join(", ")}` : "") +
    (having.length ? ` having ${having.join(" and ")}` : "") +
    orderBy +
    ` fetch first ${clampRows(selection.limit)} rows only`;

  return { sql, binds, columns };
}

function renderDimensionFilter(
  dimension: CatalogDimension,
  filter: CustomFilter,
  bind: (value: unknown) => string,
): string {
  const coerce = (raw: string | number) => (dimension.type === "number" ? Number(raw) : String(raw));

  if (filter.op === "in") {
    const values = (Array.isArray(filter.value) ? filter.value : [filter.value])
      .map((value) => String(value).trim())
      .filter(Boolean);
    if (!values.length) throw new Error(`Filter on ${dimension.id} needs at least one value.`);
    const placeholders = values.map((value) => bind(coerce(value)));
    return `${dimension.sql} in (${placeholders.join(", ")})`;
  }

  const single = String(Array.isArray(filter.value) ? filter.value[0] : filter.value ?? "").trim();
  if (!single) throw new Error(`Filter on ${dimension.id} needs a value.`);

  if (filter.op === "contains") {
    return `lower(${dimension.sql}) like ${bind(`%${single.toLowerCase()}%`)}`;
  }
  return `${dimension.sql} ${OP_SQL[filter.op]} ${bind(coerce(single))}`;
}
