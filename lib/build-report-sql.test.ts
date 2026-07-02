import { describe, it, expect } from "vitest";
import { buildReportSql, MAX_CUSTOM_ROWS } from "@/lib/build-report-sql";

describe("buildReportSql — structure", () => {
  it("builds a grouped aggregate with aliases and a row cap", () => {
    const { sql, columns } = buildReportSql({ dimensions: ["model"], measures: ["prompts", "usage_revenue"] });
    expect(columns).toEqual(["model", "prompts", "usage_revenue"]);
    expect(sql).toContain("u.model_code2_g6 as model");
    expect(sql).toContain("as prompts");
    expect(sql).toContain("as usage_revenue");
    expect(sql).toContain("group by u.model_code2_g6");
    expect(sql).toContain(`fetch first ${MAX_CUSTOM_ROWS} rows only`);
  });

  it("always scopes to Group 6 accounts and the usage event type", () => {
    const { sql } = buildReportSql({ measures: ["event_count"] });
    expect(sql).toContain("e.poid_type = '/event/session/usagegr6'");
    expect(sql).toContain("e.account_obj_id0 in (select");
  });

  it("adds the revenue join only when a revenue field is used", () => {
    const withRevenue = buildReportSql({ dimensions: ["model"], measures: ["usage_revenue"] });
    expect(withRevenue.sql).toContain("left join event_bal_impacts_t bi");

    const withoutRevenue = buildReportSql({ dimensions: ["model"], measures: ["prompts"] });
    expect(withoutRevenue.sql).not.toContain("event_bal_impacts_t");
  });

  it("omits GROUP BY for a grand-total (no dimensions)", () => {
    const { sql, columns } = buildReportSql({ measures: ["event_count"] });
    expect(columns).toEqual(["event_count"]);
    expect(sql).not.toContain("group by");
  });

  it("orders by the selected column position", () => {
    const { sql } = buildReportSql({
      dimensions: ["model"],
      measures: ["prompts"],
      sort: { field: "prompts", dir: "desc" },
    });
    expect(sql).toContain("order by 2 desc");
  });

  it("respects a user row limit under the cap", () => {
    const { sql } = buildReportSql({ measures: ["event_count"], limit: 10 });
    expect(sql).toContain("fetch first 10 rows only");
  });
});

describe("buildReportSql — validation", () => {
  it("requires at least one measure", () => {
    expect(() => buildReportSql({ dimensions: ["model"] })).toThrow(/at least one measure/i);
  });

  it("rejects unknown dimensions and measures", () => {
    expect(() => buildReportSql({ dimensions: ["evil"], measures: ["event_count"] })).toThrow(/unknown dimension/i);
    expect(() => buildReportSql({ measures: ["evil"] })).toThrow(/unknown measure/i);
  });

  it("rejects operators not allowed on a dimension", () => {
    expect(() =>
      buildReportSql({ measures: ["event_count"], filters: [{ field: "model", op: "gt", value: "3.0" }] }),
    ).toThrow(/not allowed/i);
  });

  it("rejects a sort field that is not a selected column", () => {
    expect(() =>
      buildReportSql({ dimensions: ["model"], measures: ["prompts"], sort: { field: "usage_revenue", dir: "desc" } }),
    ).toThrow(/selected column/i);
  });

  it("rejects a non-numeric measure filter", () => {
    expect(() =>
      buildReportSql({ measures: ["usage_revenue"], filters: [{ field: "usage_revenue", op: "gt", value: "lots" }] }),
    ).toThrow(/needs a number/i);
  });
});

describe("buildReportSql — injection safety", () => {
  it("passes filter values as binds, never concatenated into SQL", () => {
    const payload = "3.0'; drop table account_t; --";
    const { sql, binds } = buildReportSql({
      measures: ["event_count"],
      filters: [{ field: "model", op: "eq", value: payload }],
    });
    // The payload must live in a bind, not in the SQL text.
    expect(sql).not.toContain("drop table");
    expect(Object.values(binds)).toContain(payload);
    expect(sql).toMatch(/u\.model_code2_g6 = :b\d+/);
  });

  it("binds each value of an IN list", () => {
    const { sql, binds } = buildReportSql({
      measures: ["event_count"],
      filters: [{ field: "model", op: "in", value: ["3.0", "3.5"] }],
    });
    expect(sql).toMatch(/u\.model_code2_g6 in \(:b\d+, :b\d+\)/);
    expect(Object.values(binds)).toEqual(expect.arrayContaining(["3.0", "3.5"]));
  });

  it("wraps contains values in wildcards via a bind", () => {
    const { sql, binds } = buildReportSql({
      measures: ["event_count"],
      filters: [{ field: "rum_name", op: "contains", value: "Prompt" }],
    });
    expect(sql).toMatch(/lower\(e\.rum_name\) like :b\d+/);
    expect(Object.values(binds)).toContain("%prompt%");
  });

  it("coerces numeric dimension filters to numbers", () => {
    const { binds } = buildReportSql({
      measures: ["event_count"],
      filters: [{ field: "account_id", op: "eq", value: "1468081" }],
    });
    expect(Object.values(binds)).toContain(1468081);
  });

  it("renders measure filters as HAVING with a bound number", () => {
    const { sql, binds } = buildReportSql({
      dimensions: ["account_id"],
      measures: ["usage_revenue"],
      filters: [{ field: "usage_revenue", op: "gte", value: "100" }],
    });
    expect(sql).toMatch(/having .*>= :b\d+/);
    expect(Object.values(binds)).toContain(100);
  });
});
