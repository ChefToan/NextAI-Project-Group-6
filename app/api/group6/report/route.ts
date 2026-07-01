import { NextResponse } from "next/server";
import { getGroup6Dashboard } from "@/lib/brm-group6";
import { runReadOnlyQuery } from "@/lib/oracle";
import {
  buildReportRows,
  getReportDefinition,
  projectRows,
  reportFilename,
  selectedFields,
  type ReportRow,
  type ReportType,
} from "@/lib/report-definitions";
import { getGroup6Usage, classifyGl, type UsageRange } from "@/lib/group6-usage";
import { group6AccountSubquery } from "@/lib/group6-scope";

type ReportRequest = {
  reportType?: string;
  fields?: string[];
  range?: Partial<UsageRange>;
  filters?: Record<string, unknown>;
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

function applyFilters(rows: ReportRow[], filters: Record<string, unknown> = {}) {
  const accountId = cleanFilterValue(filters.accountId);
  const model = cleanFilterValue(filters.model).toLowerCase();
  const product = cleanFilterValue(filters.product).toLowerCase();

  return rows.filter((row) => {
    if (accountId && String(row.account_id ?? row.accountId ?? "") !== accountId) return false;
    if (model && !String(row.model ?? "").toLowerCase().includes(model)) return false;
    if (product && !String(row.product ?? "").toLowerCase().includes(product)) return false;
    return true;
  });
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

  const glId = cleanFilterValue(filters.glId);
  if (glId) clauses.push(`to_char(bi.${metadata.column}) = '${safeSqlLiteral(glId)}'`);

  const accountId = Number(filters.accountId);
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReportRequest;
    const reportType = body.reportType as ReportType;
    const definition = getReportDefinition(reportType);

    if (!definition) {
      return NextResponse.json({ error: "Unknown report type." }, { status: 400 });
    }

    const range = parseRange(body.range);
    const fields = selectedFields(reportType, body.fields);
    const filters = body.filters ?? {};
    const generatedAt = new Date();

    if (reportType === "glLookup") {
      const gl = await buildGlLookupRows(range, filters);
      return NextResponse.json({
        filename: reportFilename(reportType, generatedAt),
        columns: fields,
        rows: projectRows(gl.rows, fields),
        generatedAt: generatedAt.toISOString(),
        unavailableReason: gl.unavailableReason,
      });
    }

    const [dashboard, usage] = await Promise.all([getGroup6Dashboard(), getGroup6Usage(range)]);
    const rows = projectRows(applyFilters(buildReportRows(reportType, usage, dashboard), filters), fields);

    return NextResponse.json({
      filename: reportFilename(reportType, generatedAt),
      columns: fields,
      rows,
      generatedAt: generatedAt.toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to generate report.",
      },
      { status: 500 },
    );
  }
}