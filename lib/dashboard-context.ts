export type DashboardContext = {
  rangeLabel?: string;
  comparison?: string;
  processor?: string;
  segment?: string | null;
  updatedText?: string;
  kpis?: Record<string, string>;
  incident?: string;
  group6?: unknown;
};

export function baseDashboardContext(context?: DashboardContext) {
  return {
    product: "NextAI Group 6 Console",
    purpose:
      "Help operators analyze Group 6 LLM usage on Oracle BRM: token and prompt volume, billed revenue, L01-L10 usage-intensity buckets, the Odyssey 3.0 vs 3.5 model split, and when to allocate serving capacity.",
    activeView: "Overview / Statistics & Report",
    range: context?.rangeLabel ?? "Current billing window",
    comparison: context?.comparison ?? "Odyssey 3.0 vs 3.5",
    scope: context?.segment ?? "/service/nextaig6 (Group 6)",
    freshness: context?.updatedText ?? "Live Oracle snapshot",
    note:
      context?.incident ??
      "Day-of-week and daily totals include a bulk backfill on Dec 19-21; hour-of-day is the reliable capacity-allocation signal.",
    visibleKpis: {
      revenueDue: "Billed total due from BILL_T across Group 6 accounts",
      tokens: "Input/output tokens from Group 6 usage events (block = 1000 tokens)",
      prompts: "Prompt-billed usage events (PromptG6 RUM)",
      modelSplit: "Odyssey 3.0 vs 3.5 from MODEL_CODE2_G6 on usage events",
      ...context?.kpis,
    },
    assistantRules: [
      "Cite dashboard sources used for each answer.",
      "Distinguish likely explanations from verified facts.",
      "Prefer Oracle aggregate metrics; treat hour-of-day as more reliable than day-of-week for this dataset.",
      "Avoid exposing customer names, emails, phone numbers, account numbers, or other PII in chat responses.",
      "Do not invent database results. If database context is absent, say the answer is based on the dashboard snapshot.",
    ],
  };
}
