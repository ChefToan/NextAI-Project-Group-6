import { NextResponse } from "next/server";
import { getGroup6Dashboard } from "@/lib/brm-group6";
import { runReadOnlyQuery } from "@/lib/oracle";
import {
  applyReportFilters,
  buildReportRows,
  clampLimit,
  computeRows,
  getReportDefinition,
  projectRows,
  reportFilename,
  selectedFields,
  sortRows,
  type FilterValue,
  type ReportRow,
  type ReportSort,
  type ReportType,
} from "@/lib/report-definitions";
import { getGroup6Usage, classifyGl, type UsageRange } from "@/lib/group6-usage";
import { group6AccountSubquery } from "@/lib/group6-scope";
import { buildReportSql, MAX_CUSTOM_ROWS, type CustomSelection } from "@/lib/build-report-sql";
import { catalogLabel } from "@/lib/metrics-catalog";

type ReportRequest = {
  mode?: "preset" | "custom";
  reportType?: string;
  fields?: string[];
  range?: Partial<UsageRange>;
  filters?: Record<string, FilterValue>;
  sort?: { field?: string; dir?: string };
  limit?: number;
  selection?: CustomSelection;
};

type GlMetadata = {
  available: boolean;
  column?: string;
  reason?: string;
};

type OracleRow = Record<string, unknown>;

function numberOrUndefined(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRange(input: unknown): Partial<UsageRange> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  return {
    from: numberOrUndefined(source.from),
    to: numberOrUndefined(source.to),
  };
}

function cleanFilterValue(value: unknown) {
  return String(value ?? "").trim().slice(0, 80);
}

function normalizeSort(input: ReportRequest["sort"]): ReportSort | null {
  if (!input || typeof input !== "object") return null;
  const field = String(input.field ?? "");
  if (!field) return null;
  return { field, dir: input.dir === "asc" ? "asc" : "desc" };
}

async function getGlMetadata(): Promise<GlMetadata> {
  try {
    const result = await runReadOnlyQuery(
      `select column_name from user_tab_columns where table_name = 'EVENT_BAL_IMPACTS_T' and lower(column_name) like '%gl%' order by column_id`,
      20,
    );
    const rows = (result?.rows ?? []) as OracleRow[];
    const names = rows.map((row) => String(row.COLUMN_NAME ?? row.column_name ?? "").toUpperCase()).filter(Boolean);
    const column = names.find((name) => name === "GL_ID" || name === "GLID") ?? names[0];
    if (!column) {
      return { available: false, reason: "No GL ID column was found on EVENT_BAL_IMPACTS_T in this BRM schema." };
    }
    return { available: true, column };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : "Unable to read BRM GL metadata.",
    };
  }
}

function safeSqlLiteral(value: string) {
  return value.replace(/'/g, "''");
}

async function buildGlLookupRows(range: Partial<UsageRange>, filters: Record<string, unknown> = {}) {
  const metadata = await getGlMetadata();
  if (!metadata.available || !metadata.column) {
    return { rows: [] as ReportRow[], unavailableReason: metadata.reason ?? "GL metadata is unavailable." };
  }

  // Revenue-bearing USD impacts across usage and recurring (cycle-forward) events,
  // so the report can show recurring vs usage by GL ID at the event grain.
  const clauses = [
    `bi.resource_id = 840`,
    `e.account_obj_id0 in (${group6AccountSubquery()})`,
  ];
  if (range.from) clauses.push(`e.start_t >= ${Math.floor(range.from)}`);
  if (range.to) clauses.push(`e.start_t <= ${Math.floor(range.to)}`);

  const glId = cleanFilterValue(filters.gl_id);
  if (glId) clauses.push(`to_char(bi.${metadata.column}) = '${safeSqlLiteral(glId)}'`);

  const accountId = Number(filters.account_id);
  if (Number.isFinite(accountId) && accountId > 0) clauses.push(`e.account_obj_id0 = ${Math.floor(accountId)}`);

  const result = await runReadOnlyQuery(
    `select bi.${metadata.column} as gl_id,
            e.poid_type as event_type,
            e.poid_id0 as event_id,
            e.account_obj_id0 as account_id,
            bi.resource_id as resource_id,
            round(bi.amount, 4) as amount,
            to_char(date '1970-01-01' + (e.start_t / 86400), 'YYYY-MM-DD') as event_date
       from event_t e
       join event_bal_impacts_t bi on bi.obj_id0 = e.poid_id0
      where ${clauses.join(" and ")}
      order by e.start_t desc
      fetch first 1000 rows only`,
    1000,
  );
  const rows = (result?.rows ?? []) as OracleRow[];

  return {
    rows: rows.map((row) => {
      const glValue = String(row.GL_ID ?? row.gl_id ?? "0") || "0";
      return {
        gl_id: glValue,
        revenue_type: classifyGl(glValue).kind,
        event_type: String(row.EVENT_TYPE ?? row.event_type ?? ""),
        event_id: Number(row.EVENT_ID ?? row.event_id ?? 0),
        account_id: Number(row.ACCOUNT_ID ?? row.account_id ?? 0),
        resource_id: Number(row.RESOURCE_ID ?? row.resource_id ?? 0),
        amount: Number(row.AMOUNT ?? row.amount ?? 0),
        event_date: String(row.EVENT_DATE ?? row.event_date ?? ""),
      };
    }),
    unavailableReason: undefined,
  };
}

export async function GET() {
  const gl = await getGlMetadata();
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    glAvailable: gl.available,
    glUnavailableReason: gl.available ? undefined : gl.reason,
  });
}

// Custom mode: compile a validated catalog selection into a parameterized query.
async function runCustomReport(body: ReportRequest, generatedAt: Date) {
  let built;
  try {
    built = buildReportSql(body.selection ?? {}, parseRange(body.range));
  } catch (error) {
    // Invalid selection is a client error, not a server fault.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid custom report selection." },
      { status: 400 },
    );
  }
  const filename = `nextai-group6-custom-${generatedAt.toISOString().slice(0, 10)}.csv`;
  const result = await runReadOnlyQuery(built.sql, MAX_CUSTOM_ROWS, built.binds);

  if (!result) {
    return NextResponse.json({
      filename,
      columns: built.columns,
      columnLabels: Object.fromEntries(built.columns.map((id) => [id, catalogLabel(id)])),
      rows: [],
      generatedAt: generatedAt.toISOString(),
      unavailableReason: "Oracle BRM is not reachable.",
    });
  }

  const source = (result.rows ?? []) as OracleRow[];
  const rows = source.map((row) => {
    const projected: ReportRow = {};
    for (const id of built.columns) {
      const value = row[id.toUpperCase()] ?? row[id] ?? null;
      projected[id] = value as ReportRow[string];
    }
    return projected;
  });

  return NextResponse.json({
    filename,
    columns: built.columns,
    columnLabels: Object.fromEntries(built.columns.map((id) => [id, catalogLabel(id)])),
    rows,
    generatedAt: generatedAt.toISOString(),
    totalRows: rows.length,
    returnedRows: rows.length,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReportRequest;
    const generatedAt = new Date();

    if (body.mode === "custom") {
      return await runCustomReport(body, generatedAt);
    }

    const reportType = body.reportType as ReportType;
    const definition = getReportDefinition(reportType);

    if (!definition) {
      return NextResponse.json({ error: "Unknown report type." }, { status: 400 });
    }

    const range = parseRange(body.range);
    const fields = selectedFields(reportType, body.fields);
    const filters = body.filters ?? {};
    const sort = normalizeSort(body.sort);
    const limit = clampLimit(body.limit);

    // build -> compute derived columns -> filter -> sort -> limit -> project.
    const finalize = (rawRows: ReportRow[], unavailableReason?: string) => {
      const computed = computeRows(reportType, rawRows);
      const filtered = applyReportFilters(reportType, computed, filters);
      const sorted = sortRows(reportType, filtered, sort);
      const limited = limit ? sorted.slice(0, limit) : sorted;
      return NextResponse.json({
        filename: reportFilename(reportType, generatedAt),
        columns: fields,
        rows: projectRows(limited, fields),
        generatedAt: generatedAt.toISOString(),
        totalRows: filtered.length,
        returnedRows: limited.length,
        unavailableReason,
      });
    };

    if (reportType === "glLookup") {
      const gl = await buildGlLookupRows(range, filters);
      return finalize(gl.rows, gl.unavailableReason);
    }

    const [dashboard, usage] = await Promise.all([getGroup6Dashboard(), getGroup6Usage(range)]);
    return finalize(buildReportRows(reportType, usage, dashboard));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to generate report.",
      },
      { status: 500 },
    );
  }
}