import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  draftReportSelection: vi.fn(),
}));

vi.mock("@/lib/ai-report", () => ({
  draftReportSelection: mocks.draftReportSelection,
}));

const { POST } = await import("@/app/api/group6/report/ai/route");

function request(prompt: string) {
  return new Request("http://localhost/api/group6/report/ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/group6/report/ai", () => {
  it("returns 400 when no selection can be drafted", async () => {
    mocks.draftReportSelection.mockResolvedValue({ error: "Describe the report you want." });

    const response = await POST(request(""));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Describe the report you want." });
    expect(mocks.draftReportSelection).toHaveBeenCalledWith("");
  });

  it("returns 400 with missing fields from an unsupported request", async () => {
    mocks.draftReportSelection.mockResolvedValue({ error: "No churn metric is available.", missing: ["churn_rate"] });

    const response = await POST(request("show churn by plan"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.missing).toEqual(["churn_rate"]);
  });

  it("returns 200 with a validated selection", async () => {
    mocks.draftReportSelection.mockResolvedValue({
      selection: { dimensions: ["model"], measures: ["usage_revenue"], limit: 5 },
      notes: "Usage revenue by model.",
      provider: "gemini",
      model: "gemini-test",
    });

    const response = await POST(request("usage revenue by model"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.selection).toEqual({ dimensions: ["model"], measures: ["usage_revenue"], limit: 5 });
    expect(body.provider).toBe("gemini");
  });
});
