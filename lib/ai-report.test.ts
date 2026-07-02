import { beforeEach, describe, it, expect, vi } from "vitest";

const provider = vi.hoisted(() => ({
  configured: true,
  result: { provider: "gemini" as const, model: "gemini-test", text: "{}" },
  error: undefined as Error | undefined,
}));

vi.mock("@/lib/ai-providers", () => ({
  anyProviderConfigured: () => provider.configured,
  callAiJson: vi.fn(async () => {
    if (provider.error) throw provider.error;
    return provider.result;
  }),
  parseJsonBlock: (text: string) => {
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return JSON.parse(fenced ? fenced[1] : trimmed);
  },
}));

import { draftReportSelection, validateSelection } from "@/lib/ai-report";
import { buildReportSql } from "@/lib/build-report-sql";

beforeEach(() => {
  provider.configured = true;
  provider.result = { provider: "gemini", model: "gemini-test", text: "{}" };
  provider.error = undefined;
});

describe("validateSelection", () => {
  it("accepts a clean selection", () => {
    const { selection, error } = validateSelection({
      dimensions: ["model"],
      measures: ["event_count", "usage_revenue"],
      notes: "Events and revenue per model",
    });
    expect(error).toBeUndefined();
    expect(selection?.dimensions).toEqual(["model"]);
    expect(selection?.measures).toEqual(["event_count", "usage_revenue"]);
  });

  it("drops unknown dimensions and measures", () => {
    const { selection } = validateSelection({
      dimensions: ["model", "made_up"],
      measures: ["usage_revenue", "also_fake"],
    });
    expect(selection?.dimensions).toEqual(["model"]);
    expect(selection?.measures).toEqual(["usage_revenue"]);
  });

  it("errors when no valid measure survives", () => {
    const { selection, error } = validateSelection({ dimensions: ["model"], measures: ["nonsense"] });
    expect(selection).toBeUndefined();
    expect(error).toMatch(/measure/i);
  });

  it("passes through an explicit model refusal with missing fields", () => {
    const { error, missing } = validateSelection({ error: "No data for churn", missing: ["churn_rate"] });
    expect(error).toMatch(/churn/i);
    expect(missing).toEqual(["churn_rate"]);
  });

  it("keeps valid filters and drops invalid ones", () => {
    const { selection } = validateSelection({
      measures: ["event_count"],
      filters: [
        { field: "model", op: "eq", value: "3.5" }, // valid
        { field: "model", op: "gt", value: "3.5" }, // op not allowed on this dimension
        { field: "ghost", op: "eq", value: "x" }, // unknown field
        { field: "usage_revenue", op: "gt", value: "10" }, // valid measure (HAVING)
        { field: "usage_revenue", op: "contains", value: "x" }, // op invalid on a measure
        { field: "model", op: "eq", value: "" }, // empty value
      ],
    });
    expect(selection?.filters).toEqual([
      { field: "model", op: "eq", value: "3.5" },
      { field: "usage_revenue", op: "gt", value: "10" },
    ]);
  });

  it("keeps a sort only when it targets a selected column", () => {
    const good = validateSelection({ dimensions: ["model"], measures: ["prompts"], sort: { field: "prompts", dir: "asc" } });
    expect(good.selection?.sort).toEqual({ field: "prompts", dir: "asc" });

    const bad = validateSelection({ dimensions: ["model"], measures: ["prompts"], sort: { field: "usage_revenue", dir: "desc" } });
    expect(bad.selection?.sort).toBeNull();
  });

  it("normalizes an IN list and a positive integer limit", () => {
    const { selection } = validateSelection({
      measures: ["event_count"],
      filters: [{ field: "model", op: "in", value: ["3.0", "3.5"] }],
      limit: 25.7,
    });
    expect(selection?.filters?.[0]).toEqual({ field: "model", op: "in", value: ["3.0", "3.5"] });
    expect(selection?.limit).toBe(25);
  });

  it("normalizes natural-language model aliases in AI-drafted filters", () => {
    const { selection } = validateSelection({
      dimensions: ["model"],
      measures: ["prompts", "total_tokens"],
      filters: [{ field: "model", op: "in", value: ["Odyssey 3.0", "odyssey 3.5"] }],
    });
    expect(selection?.filters?.[0]).toEqual({ field: "model", op: "in", value: ["3.0", "3.5"] });
  });

  it("preserves hostile filter values for the builder to bind (no SQL breakout)", () => {
    const payload = "3.0'; drop table account_t; --";
    const { selection } = validateSelection({ measures: ["event_count"], filters: [{ field: "model", op: "eq", value: payload }] });
    expect(selection).toBeDefined();

    // The whole point: an AI-drafted selection is still compiled by the safe builder.
    const { sql, binds } = buildReportSql(selection!);
    expect(sql).not.toContain("drop table");
    expect(Object.values(binds)).toContain(payload);
  });
});

describe("draftReportSelection", () => {
  it("requires a non-empty prompt", async () => {
    await expect(draftReportSelection("   ")).resolves.toMatchObject({
      error: "Describe the report you want.",
    });
  });

  it("returns a no-provider error without calling a model", async () => {
    provider.configured = false;

    await expect(draftReportSelection("usage by model")).resolves.toMatchObject({
      error: expect.stringMatching(/No AI provider is configured/i),
    });
  });

  it("reports invalid model JSON with provider metadata", async () => {
    provider.result = { provider: "openrouter", model: "router-test", text: "not json" };

    await expect(draftReportSelection("usage by model")).resolves.toMatchObject({
      error: expect.stringMatching(/valid report selection/i),
      provider: "openrouter",
      model: "router-test",
    });
  });

  it("validates a model-drafted selection before returning it", async () => {
    provider.result = {
      provider: "gemini",
      model: "gemini-test",
      text: JSON.stringify({
        dimensions: ["model", "made_up"],
        measures: ["usage_revenue", "fake_measure"],
        filters: [{ field: "model", op: "eq", value: "3.5" }],
        sort: { field: "usage_revenue", dir: "desc" },
        limit: 5,
        notes: "Usage revenue by model.",
      }),
    };

    const draft = await draftReportSelection("usage revenue by model");

    expect(draft).toMatchObject({
      selection: {
        dimensions: ["model"],
        measures: ["usage_revenue"],
        filters: [{ field: "model", op: "eq", value: "3.5" }],
        sort: { field: "usage_revenue", dir: "desc" },
        limit: 5,
      },
      notes: "Usage revenue by model.",
      provider: "gemini",
      model: "gemini-test",
    });
  });
});
