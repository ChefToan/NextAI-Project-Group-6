import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const componentSource = readFileSync(fileURLToPath(new URL("./GenerateReportButton.tsx", import.meta.url)), "utf8");
const summarySource = readFileSync(fileURLToPath(new URL("./SummarizeButton.tsx", import.meta.url)), "utf8");
const cssSource = readFileSync(fileURLToPath(new URL("../globals.css", import.meta.url)), "utf8");

describe("GenerateReportButton UI smoke contract", () => {
  it("exposes stable hooks for modal, preset, custom, AI, preview, and download flows", () => {
    [
      "report-open-button",
      "report-builder-modal",
      "report-mode-custom",
      "report-ai-prompt",
      "report-ai-draft-button",
      "report-add-filter-button",
      "report-custom-filter-row",
      "report-sort-field",
      "report-row-limit",
      "report-format",
      "report-preview-button",
      "report-preview",
      "report-preview-table",
      "report-download-button",
      "report-error",
    ].forEach((testId) => {
      expect(componentSource).toContain(`data-testid="${testId}"`);
    });
    [
      "report-preset-${preset.id}",
      "report-custom-dimension-${dimension.id}",
      "report-custom-measure-${measure.id}",
      "report-custom-filter-field-${index}",
      "report-remove-filter-${index}",
      "report-field-${field.id}",
    ].forEach((testIdTemplate) => {
      expect(componentSource).toContain(testIdTemplate);
    });
  });

  it("keeps AI validation local and avoids disabling the AI button for empty prompts", () => {
    expect(componentSource).toContain('setError("Describe the report you want.")');
    expect(componentSource).toContain('data-testid="report-ai-draft-button"');
    expect(componentSource).not.toContain("disabled={aiLoading || !aiPrompt.trim()}");
  });

  it("smooth-scrolls to generated report and AI summary output", () => {
    expect(componentSource).toContain("setScrollTarget");
    expect(componentSource).toContain("mainRef");
    expect(componentSource).toContain("scrollTo({ top: Math.max(0, top), behavior: \"smooth\" })");
    expect(componentSource).toContain("scrollToResult: true");
    expect(summarySource).toContain("scrollIntoView({ behavior: \"smooth\", block: \"nearest\" })");
  });

  it("keeps the modal action rail reachable and custom controls responsive", () => {
    expect(cssSource).toMatch(/\.report-modal-footer\s*{[\s\S]*position:\s*sticky/);
    expect(cssSource).toMatch(/@media \(max-width: 860px\)[\s\S]*\.report-filter-row\s*{[\s\S]*grid-template-columns:\s*1fr/);
    expect(cssSource).toMatch(/@media \(max-width: 860px\)[\s\S]*\.report-modal-actions \.btn\s*{[\s\S]*width:\s*100%/);
  });
});
