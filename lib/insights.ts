import "server-only";
import type { Group6Usage } from "@/lib/group6-usage";
import { formatHours, formatHourRanges } from "@/lib/group6-usage";
import { money } from "@/lib/format";

export type UsageInsights = {
  activity: string;
  allocation: string;
  composition: string;
  relationship: string;
  source: "ai" | "computed";
};

// Deterministic, always-correct sentences derived straight from the data.
// Used as a fallback and as the grounding for the AI prose.
function computedInsights(u: Group6Usage): UsageInsights {
  const d = u.derived;
  const topProduct = u.productMix[0];
  const backfill = d.backfillDays.length
    ? ` until a ${d.backfillDays.length}-day bulk backfill (${d.backfillDays[0].slice(5)}–${d.backfillDays[d.backfillDays.length - 1].slice(5)})`
    : "";
  const split = d.modelSplit.map((m) => `${m.modelLabel} ${m.pct}%`).join(" / ");
  const quiet = formatHourRanges(d.quietHours);
  const zero = d.zeroHours.length ? `, with near-zero traffic ${formatHourRanges(d.zeroHours)}` : "";

  return {
    activity: `Daily volume holds near ${d.medianDailyPrompts} prompts/day${backfill}. Hour-of-day is the reliable capacity signal.`,
    allocation: `Peak usage clusters at ${formatHours(d.peakHours)} UTC; ${quiet} is quietest${zero}. The models split ${split} and track the same curve, so allocate shared headroom around the peaks.`,
    composition: `Token-billed plans run roughly ${u.kpis.inputSharePct}% input / ${100 - u.kpis.inputSharePct}% output${topProduct ? `; ${shorten(topProduct.product)} leads billed revenue at ${money(topProduct.revenueDue)}` : ""}.`,
    relationship: d.singleRumPlans
      ? "Each Group 6 plan bills by prompts or tokens (never both), so accounts fall on one axis; revenue scales with usage volume."
      : "Revenue scales with usage volume across plans.",
    source: "computed",
  };
}

function shorten(name: string) {
  return name.replace(/^NextAI\s+Odd?[iy]ss?ey\s+/i, "").replace(/\s*Group\s*6\s*$/i, "").trim();
}

function compactSummary(u: Group6Usage) {
  return {
    window: u.windowUtc,
    revenueDue: u.kpis.revenueDue,
    tokens: { total: u.kpis.totalTokens, inputSharePct: u.kpis.inputSharePct },
    prompts: u.kpis.totalPrompts,
    usageEvents: u.kpis.usageEvents,
    users: u.kpis.totalUsers,
    models: u.models.map((m) => ({ model: m.modelLabel, events: m.events, blocks: m.tokenBlocks, billedRevenue: m.revenueDue })),
    peakHoursUtc: u.derived.peakHours,
    quietHoursUtc: u.derived.quietHours,
    zeroTrafficHoursUtc: u.derived.zeroHours,
    medianDailyPrompts: u.derived.medianDailyPrompts,
    backfillDays: u.derived.backfillDays,
    topProductsByRevenue: u.productMix.slice(0, 4).map((p) => ({ product: shorten(p.product), users: p.users, billedRevenue: p.revenueDue })),
    tokenByModel: u.models.map((m) => ({ model: m.modelLabel, inputBlocks: Math.round(m.inputTokens / 1000), outputBlocks: Math.round(m.outputTokens / 1000) })),
    singleRumPlans: u.derived.singleRumPlans,
  };
}

// Resilient flash-model fallback chain for on-demand summaries and insights.
export function geminiModels(): string[] {
  return ["gemini-2.5-flash", process.env.GEMINI_MODEL, "gemini-2.0-flash", "gemini-flash-latest"]
    .filter((m): m is string => Boolean(m))
    .filter((m, i, a) => a.indexOf(m) === i);
}

function localPanelSummary(panel: string, context: unknown): { text: string; source: "computed" } {
  const c = (context && typeof context === "object" ? context : {}) as Record<string, any>;
  const title = panel.toLowerCase();

  if (Array.isArray(c.daily) && c.daily.length > 0) {
    const prompts = c.daily.map((d: any) => Number(d.prompts)).filter(Number.isFinite);
    const blocks = c.daily.map((d: any) => Number(d.tokens) / 1000).filter(Number.isFinite);
    const minP = Math.min(...prompts);
    const maxP = Math.max(...prompts);
    const minB = Math.round(Math.min(...blocks));
    const maxB = Math.round(Math.max(...blocks));
    return { text: "Daily usage varies across the selected period, with prompts ranging from " + minP + " to " + maxP + " and token blocks from " + minB + " to " + maxB + ".", source: "computed" };
  }

  if (Array.isArray(c.tokenByProduct) && c.tokenByProduct.length > 0) {
    const rows = c.tokenByProduct
      .map((r: any) => ({ product: shorten(String(r.product ?? "Product")), blocks: (Number(r.inputTokens) + Number(r.outputTokens)) / 1000 }))
      .filter((r) => Number.isFinite(r.blocks))
      .sort((a, b) => b.blocks - a.blocks);
    const top = rows[0];
    return { text: top ? top.product + " carries the largest token volume at about " + Math.round(top.blocks).toLocaleString() + " blocks." : "Token volume is available by product for the selected window.", source: "computed" };
  }

  if (Array.isArray(c.usersByPlan) && c.usersByPlan.length > 0) {
    const rows = c.usersByPlan.slice().sort((a: any, b: any) => Number(b.users) - Number(a.users));
    const top = rows[0];
    return { text: top ? "Plan distribution is balanced around " + Number(top.users).toLocaleString() + " customers on " + shorten(String(top.plan ?? "the leading plan")) + "." : "Plan distribution is available for the selected accounts.", source: "computed" };
  }

  if (Array.isArray(c.byHour) && (Array.isArray(c.peakHours) || title.includes("hour"))) {
    const rows = c.byHour
      .map((h: any) => ({ hour: Number(h.hour), events: Number(h.m30 ?? 0) + Number(h.m35 ?? 0) }))
      .filter((h) => Number.isFinite(h.hour) && Number.isFinite(h.events))
      .sort((a, b) => b.events - a.events);
    const top = rows.slice(0, 3).map((h) => String(h.hour).padStart(2, "0") + ":00").join(", ");
    return { text: top ? "Usage is busiest around " + top + " UTC; use those hours for capacity planning." : "Hourly usage is available for capacity planning.", source: "computed" };
  }

  if (c.tax && typeof c.tax === "object") {
    const tax = c.tax as Record<string, any>;
    return { text: "AIT review compares " + money(Number(tax.collected ?? 0)) + " collected against an expected " + money(Number(tax.expected ?? 0)) + ".", source: "computed" };
  }

  return { text: "This panel summarizes the selected dashboard metrics for the current view.", source: "computed" };
}

// On-demand one-sentence summary of a single chart panel (used by SummarizeButton).
export async function summarizePanel(panel: string, context: unknown): Promise<{ text: string; source: "ai" | "computed" }> {
  const fallback = localPanelSummary(panel, context);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallback;
  const prompt = [
    "You summarize ONE chart from the NextAI Group 6 billing dashboard (Oracle BRM) in a single sentence (<= 28 words).",
    "Ground every claim strictly in the JSON below; no markdown, no preamble, no invented numbers. Operational tone.",
    `Chart: ${panel}`,
    `Data: ${JSON.stringify(context).slice(0, 4000)}`,
  ].join("\n");
  for (const model of geminiModels()) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const json = await res.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      return { text: String(text).trim().replace(/^["']|["']$/g, ""), source: "ai" };
    } catch {
      /* try next model */
    }
  }
  return fallback;
}

// Cache AI insights so only the first request pays the Gemini latency; the
// Group 6 training data is effectively static. Keyed on the metrics that would
// change the narrative. Only successful AI results are cached (so failures retry).
let cache: { key: string; value: UsageInsights; at: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getUsageInsights(u: Group6Usage): Promise<UsageInsights> {
  const fallback = computedInsights(u);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!u.connected || !apiKey) return fallback;

  const cacheKey = `${u.kpis.usageEvents}|${u.kpis.revenueDue}|${u.windowUtc.max}|${u.derived.peakHours.join(",")}`;
  if (cache && cache.key === cacheKey && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  const prompt = [
    "You are a billing/usage analyst for the NextAI Group 6 console (Oracle BRM).",
    "Write four short, decision-useful insight sentences from the JSON metrics below. Ground every claim in the numbers; do not invent values.",
    "Tone: concise, operational, no markdown, no emojis. One sentence each, <= 30 words.",
    "Return STRICT JSON with keys exactly: activity, allocation, composition, relationship.",
    "- activity: how daily usage moved over the window (mention the backfill if backfillDays is non-empty).",
    "- allocation: when to add serving capacity for Odyssey 3.0/3.5 (use peak and quiet hours; note models track together).",
    "- composition: what is being billed (input/output token split and the top revenue product).",
    "- relationship: how prompts, tokens, and revenue relate per account (note single-RUM plans if singleRumPlans is true).",
    "",
    `Metrics: ${JSON.stringify(compactSummary(u))}`,
  ].join("\n");

  // Try the configured model, then resilient alternates if it is overloaded
  // (Google returns 503 UNAVAILABLE on spikes). De-duplicated, capped per call.
  const models = geminiModels();

  for (const model of models) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue; // 503/429/etc — try the next model
      const json = await res.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      const fenced = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
      const parsed = JSON.parse(fenced ? fenced[1] : text.trim());
      const result: UsageInsights = {
        activity: typeof parsed.activity === "string" ? parsed.activity : fallback.activity,
        allocation: typeof parsed.allocation === "string" ? parsed.allocation : fallback.allocation,
        composition: typeof parsed.composition === "string" ? parsed.composition : fallback.composition,
        relationship: typeof parsed.relationship === "string" ? parsed.relationship : fallback.relationship,
        source: "ai",
      };
      cache = { key: cacheKey, value: result, at: Date.now() };
      return result;
    } catch {
      // try next model
    }
  }
  return fallback;
}

