import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGroup6Dashboard: vi.fn(),
  getGroup6Usage: vi.fn(),
  runReadOnlyQuery: vi.fn(),
}));

vi.mock("@/lib/brm-group6", () => ({
  getGroup6Dashboard: mocks.getGroup6Dashboard,
}));

vi.mock("@/lib/oracle", () => ({
  runReadOnlyQuery: mocks.runReadOnlyQuery,
}));

vi.mock("@/lib/group6-usage", () => ({
  getGroup6Usage: mocks.getGroup6Usage,
  classifyGl: (glId: string) => ({ kind: glId === "104" ? "usage" : glId === "102" ? "recurring" : "other" }),
}));

const { POST } = await import("@/app/api/group6/report/route");

function request(body: unknown) {
  return new Request("http://localhost/api/group6/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getGroup6Dashboard.mockResolvedValue({});
  mocks.getGroup6Usage.mockResolvedValue({
    daily: [
      { date: "2026-07-01", prompts: 5, tokens: 1000, revenue: 5 },
      { date: "2026-07-02", prompts: 20, tokens: 2000, revenue: 30 },
      { date: "2026-07-03", prompts: 30, tokens: 6000, revenue: 15 },
    ],
  });
});

describe("/api/group6/report preset mode", () => {
  it("computes, filters, sorts, limits, and projects preset rows", async () => {
    const response = await POST(request({
      reportType: "dailyUsage",
      fields: ["date", "prompts", "revenue_per_prompt"],
      filters: { prompts: { min: "10" } },
      sort: { field: "revenue_per_prompt", dir: "desc" },
      limit: 1,
    }));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.columns).toEqual(["date", "prompts", "revenue_per_prompt"]);
    expect(body.totalRows).toBe(2);
    expect(body.returnedRows).toBe(1);
    expect(body.rows).toEqual([{ date: "2026-07-02", prompts: 20, revenue_per_prompt: 1.5 }]);
  });

  it("rejects unknown report types as client errors", async () => {
    const response = await POST(request({ reportType: "notAReport" }));
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/unknown report type/i);
  });
});

describe("/api/group6/report custom mode", () => {
  it("runs a valid catalog selection and returns catalog labels", async () => {
    mocks.runReadOnlyQuery.mockResolvedValue({
      rows: [{ MODEL: "3.5", EVENT_COUNT: 2, USAGE_REVENUE: 4.5 }],
      metaData: [],
    });

    const response = await POST(request({
      mode: "custom",
      selection: {
        dimensions: ["model"],
        measures: ["event_count", "usage_revenue"],
        sort: { field: "usage_revenue", dir: "desc" },
        limit: 10,
      },
    }));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.columns).toEqual(["model", "event_count", "usage_revenue"]);
    expect(body.columnLabels.usage_revenue).toBe("Usage revenue USD");
    expect(body.rows).toEqual([{ model: "3.5", event_count: 2, usage_revenue: 4.5 }]);
    expect(mocks.runReadOnlyQuery).toHaveBeenCalledWith(expect.stringContaining("fetch first 10 rows only"), 5000, {});
  });

  it("rejects invalid custom dimensions, operators, and sort fields", async () => {
    const badDimension = await POST(request({
      mode: "custom",
      selection: { dimensions: ["__bad"], measures: ["event_count"] },
    }));
    expect(badDimension.status).toBe(400);
    await expect(json(badDimension)).resolves.toMatchObject({ error: expect.stringMatching(/unknown dimension/i) });

    const badOperator = await POST(request({
      mode: "custom",
      selection: { measures: ["event_count"], filters: [{ field: "model", op: "gt", value: "3.5" }] },
    }));
    expect(badOperator.status).toBe(400);
    await expect(json(badOperator)).resolves.toMatchObject({ error: expect.stringMatching(/not allowed/i) });

    const badSort = await POST(request({
      mode: "custom",
      selection: { dimensions: ["model"], measures: ["event_count"], sort: { field: "usage_revenue", dir: "desc" } },
    }));
    expect(badSort.status).toBe(400);
    await expect(json(badSort)).resolves.toMatchObject({ error: expect.stringMatching(/selected column/i) });
  });

  it("returns a graceful unavailable payload when Oracle is not reachable", async () => {
    mocks.runReadOnlyQuery.mockResolvedValue(null);

    const response = await POST(request({
      mode: "custom",
      selection: { dimensions: ["model"], measures: ["event_count"] },
    }));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.rows).toEqual([]);
    expect(body.unavailableReason).toMatch(/Oracle BRM is not reachable/i);
  });
});
