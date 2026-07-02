import { describe, it, expect } from "vitest";
import {
  MAX_REPORT_ROWS,
  allowedFieldIds,
  applyReportFilters,
  clampLimit,
  computeRows,
  getReportDefinition,
  projectRows,
  reportFields,
  reportFilename,
  selectedFields,
  sortRows,
  type ReportRow,
} from "@/lib/report-definitions";

describe("field selection & whitelisting", () => {
  it("falls back to default fields when nothing valid is requested", () => {
    const def = getReportDefinition("dailyUsage")!;
    expect(selectedFields("dailyUsage", undefined)).toEqual(def.defaultFields);
    expect(selectedFields("dailyUsage", ["bogus", "also_bogus"])).toEqual(def.defaultFields);
  });

  it("keeps only whitelisted requested fields, dropping unknown ones", () => {
    const result = selectedFields("dailyUsage", ["date", "prompts", "__inject__"]);
    expect(result).toEqual(["date", "prompts"]);
  });

  it("allows opt-in computed fields to be selected", () => {
    const result = selectedFields("dailyUsage", ["date", "revenue_per_prompt"]);
    expect(result).toContain("revenue_per_prompt");
  });

  it("exposes computed fields in the allowed set and field list", () => {
    const allowed = allowedFieldIds("customerSummary");
    expect(allowed.has("total_revenue_usd")).toBe(true);
    expect(allowed.has("collection_rate_pct")).toBe(true);
    const ids = reportFields("customerSummary").map((f) => f.id);
    expect(ids).toContain("account_id"); // base field
    expect(ids).toContain("total_revenue_usd"); // computed field
  });

  it("returns nothing for an unknown report type", () => {
    expect(selectedFields("nope", ["x"])).toEqual([]);
    expect(allowedFieldIds("nope").size).toBe(0);
  });
});

describe("computed (derived) fields", () => {
  it("computes derived columns from the row", () => {
    const rows: ReportRow[] = [{ date: "2026-01-01", prompts: 10, tokens: 2000, usage_revenue_usd: 5 }];
    const [row] = computeRows("dailyUsage", rows);
    expect(row.revenue_per_prompt).toBe(0.5);
    expect(row.tokens_per_prompt).toBe(200);
  });

  it("guards divide-by-zero to 0", () => {
    const rows: ReportRow[] = [{ prompts: 0, tokens: 2000, usage_revenue_usd: 5 }];
    const [row] = computeRows("dailyUsage", rows);
    expect(row.revenue_per_prompt).toBe(0);
    expect(row.tokens_per_prompt).toBe(0);
  });

  it("blanks computed values when a dependency is missing", () => {
    const rows: ReportRow[] = [{ tokens: 2000, usage_revenue_usd: 5 }]; // no prompts
    const [row] = computeRows("dailyUsage", rows);
    expect(row.revenue_per_prompt).toBe("");
    expect(row.tokens_per_prompt).toBe("");
  });

  it("sums total revenue across usage/recurring/unassigned", () => {
    const rows: ReportRow[] = [{ usage_revenue_usd: 10, recurring_revenue_usd: 90, unassigned_revenue_usd: 0.5, billed_due_usd: 200, received_usd: 50 }];
    const [row] = computeRows("customerSummary", rows);
    expect(row.total_revenue_usd).toBe(100.5);
    expect(row.collection_rate_pct).toBe(25); // 50/200
  });

  it("is a no-op for reports without computed fields", () => {
    const rows: ReportRow[] = [{ gl_id: "104", usage_revenue_usd: 5 }];
    expect(computeRows("revenueByGl", rows)).toEqual(rows);
  });
});

describe("declarative filters", () => {
  const rows: ReportRow[] = [
    { account_id: 1001, login: "acme_one", account_status: "Active", model: "3.0", state: "AZ", outstanding_usd: 500, usage_revenue_usd: 10 },
    { account_id: 1002, login: "beta_two", account_status: "Closed", model: "3.5", state: "CA", outstanding_usd: 0, usage_revenue_usd: 300 },
    { account_id: 1003, login: "acme_three", account_status: "Active", model: "3.5", state: "AZ", outstanding_usd: 120, usage_revenue_usd: 0 },
  ];

  it("ignores empty / inactive filters", () => {
    expect(applyReportFilters("customerSummary", rows, {}).length).toBe(3);
    expect(applyReportFilters("customerSummary", rows, { login: "  ", outstanding_usd: {} }).length).toBe(3);
  });

  it("matches id filters exactly", () => {
    const out = applyReportFilters("customerSummary", rows, { account_id: "1002" });
    expect(out.map((r) => r.account_id)).toEqual([1002]);
  });

  it("matches text filters as case-insensitive substrings", () => {
    const out = applyReportFilters("customerSummary", rows, { login: "ACME" });
    expect(out.map((r) => r.account_id)).toEqual([1001, 1003]);
  });

  it("matches enum filters case-insensitively and exactly", () => {
    const out = applyReportFilters("customerSummary", rows, { account_status: "active" });
    expect(out.map((r) => r.account_id)).toEqual([1001, 1003]);
  });

  it("applies numberRange min/max inclusively", () => {
    expect(applyReportFilters("customerSummary", rows, { outstanding_usd: { min: "120" } }).map((r) => r.account_id)).toEqual([1001, 1003]);
    expect(applyReportFilters("customerSummary", rows, { outstanding_usd: { max: "120" } }).map((r) => r.account_id)).toEqual([1002, 1003]);
    expect(applyReportFilters("customerSummary", rows, { outstanding_usd: { min: "100", max: "200" } }).map((r) => r.account_id)).toEqual([1003]);
  });

  it("ANDs multiple filters together", () => {
    const out = applyReportFilters("customerSummary", rows, { account_status: "Active", model: "3.5" });
    expect(out.map((r) => r.account_id)).toEqual([1003]);
  });

  it("ignores filter keys not declared for the report", () => {
    // `login` is not a declared filter on revenueByGl, so it must not filter.
    const glRows: ReportRow[] = [{ gl_id: "104", revenue_type: "usage" }, { gl_id: "102", revenue_type: "recurring" }];
    expect(applyReportFilters("revenueByGl", glRows, { login: "nope" }).length).toBe(2);
    expect(applyReportFilters("revenueByGl", glRows, { revenue_type: "usage" }).map((r) => r.gl_id)).toEqual(["104"]);
  });
});

describe("sorting", () => {
  const rows: ReportRow[] = [
    { date: "2026-01-02", prompts: 3 },
    { date: "2026-01-01", prompts: 1 },
    { date: "2026-01-03", prompts: 2 },
  ];

  it("sorts numeric fields ascending and descending", () => {
    expect(sortRows("dailyUsage", rows, { field: "prompts", dir: "asc" }).map((r) => r.prompts)).toEqual([1, 2, 3]);
    expect(sortRows("dailyUsage", rows, { field: "prompts", dir: "desc" }).map((r) => r.prompts)).toEqual([3, 2, 1]);
  });

  it("sorts string fields", () => {
    expect(sortRows("dailyUsage", rows, { field: "date", dir: "asc" }).map((r) => r.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("leaves rows untouched for a non-allowed or empty sort field", () => {
    expect(sortRows("dailyUsage", rows, { field: "__evil__", dir: "asc" })).toEqual(rows);
    expect(sortRows("dailyUsage", rows, null)).toEqual(rows);
  });

  it("does not mutate the input array", () => {
    const snapshot = rows.map((r) => r.prompts);
    sortRows("dailyUsage", rows, { field: "prompts", dir: "desc" });
    expect(rows.map((r) => r.prompts)).toEqual(snapshot);
  });
});

describe("row limit clamping", () => {
  it("returns null for absent / non-positive / non-numeric values", () => {
    expect(clampLimit(undefined)).toBeNull();
    expect(clampLimit(0)).toBeNull();
    expect(clampLimit(-5)).toBeNull();
    expect(clampLimit("abc")).toBeNull();
  });

  it("floors and caps at MAX_REPORT_ROWS", () => {
    expect(clampLimit(3.9)).toBe(3);
    expect(clampLimit(100)).toBe(100);
    expect(clampLimit(MAX_REPORT_ROWS + 1000)).toBe(MAX_REPORT_ROWS);
  });
});

describe("projection & filename", () => {
  it("projects only the selected fields and blanks missing ones", () => {
    const rows: ReportRow[] = [{ a: 1, b: 2, c: 3 }];
    expect(projectRows(rows, ["a", "c", "missing"])).toEqual([{ a: 1, c: 3, missing: "" }]);
  });

  it("builds a dated csv filename", () => {
    const name = reportFilename("customerSummary", new Date("2026-07-01T12:00:00Z"));
    expect(name).toBe("nextai-group6-customer-summary-2026-07-01.csv");
  });
});
