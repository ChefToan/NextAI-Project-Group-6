import { baseDashboardContext, type DashboardContext } from "@/lib/dashboard-context";
import { getGroup6Dashboard, type Group6Dashboard } from "@/lib/brm-group6";
import { getGroup6Usage, type Group6Usage, type UsageRange } from "@/lib/group6-usage";
import { getOracleDashboardSummary } from "@/lib/oracle-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderName = "gemini" | "openrouter";

type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

type ChatRequest = {
  message?: string;
  dashboardContext?: DashboardContext;
  range?: UsageRange;
  history?: ChatHistoryItem[];
};

type AssistantBullet = { text: string; sourceLabel: string; sourceKey: string };
type AssistantSource = { label: string; key: string };
type AssistantAction = { label: string; kind: "report" | "raw_usage" | "none"; href?: string };

type AssistantResponse = {
  verdict: string;
  bullets: AssistantBullet[];
  confidence: string;
  sources: AssistantSource[];
  actions: AssistantAction[];
  configured: boolean;
  provider?: ProviderName;
  model?: string;
  warnings: string[];
  errors: string[];
};

type ProviderResult = {
  provider: ProviderName;
  model: string;
  text: string;
};

type StreamEvent =
  | { type: "status"; message: string }
  | { type: "result"; payload: AssistantResponse }
  | { type: "error"; payload: AssistantResponse };

const CHAT_TIMEOUT_MS = 18_000;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_CHARS = 700;
const SOURCE_KEYS = new Set(["kpis", "authChart", "decline", "segments", "usage", "catalog", "tax", "ar", "pricing", "exceptions"]);

function trimText(value: unknown, max = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function configured(value: string | undefined): value is string {
  return Boolean(value && value.trim() && !value.includes("your_") && !value.includes("your-"));
}

function providerOrder(): ProviderName[] {
  const raw = process.env.AI_PROVIDER_ORDER || process.env.AI_PRIMARY_PROVIDER || "gemini,openrouter";
  const order = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is ProviderName => item === "gemini" || item === "openrouter");
  return order.length ? [...new Set(order)] : ["gemini", "openrouter"];
}

function pushWarning(warnings: string[], message: string) {
  if (!warnings.includes(message)) warnings.push(message);
}

function compactHistory(history?: ChatHistoryItem[]) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((item) => ({ role: item.role, content: trimText(item.content, MAX_HISTORY_CHARS) }))
    .filter((item) => item.content);
}

function summarizeGroup6Dashboard(group6: Group6Dashboard) {
  const statusMix = group6.users.reduce<Record<string, number>>((acc, user) => {
    acc[user.accountStatusLabel] = (acc[user.accountStatusLabel] ?? 0) + 1;
    return acc;
  }, {});
  const recentCohortProductMix = group6.users.reduce<Record<string, number>>((acc, user) => {
    acc[user.productName] = (acc[user.productName] ?? 0) + 1;
    return acc;
  }, {});

  return {
    connected: group6.connected,
    generatedAt: group6.generatedAt,
    simulatedNowUtc: group6.simulatedNowUtc,
    serviceType: group6.serviceType,
    metrics: group6.metrics,
    recentCohortSize: group6.users.length,
    recentCohortStatusMix: statusMix,
    recentCohortProductMix,
    productCatalog: group6.productCatalog.map((item) => ({
      name: item.name,
      description: item.description,
      permitted: item.permitted,
    })),
    planCatalog: group6.planCatalog.map((item) => ({
      name: item.name,
      description: item.description,
    })),
    productMix: group6.productMix,
    notes: group6.notes,
  };
}

// PII-free but broad enough for follow-up questions across the report.
function summarizeUsage(u: Group6Usage) {
  if (!u.connected) return { connected: false, generatedAt: u.generatedAt };
  return {
    connected: true,
    generatedAt: u.generatedAt,
    window: u.windowUtc,
    availableRange: u.availableRange,
    kpis: u.kpis,
    derived: u.derived,
    models: u.models,
    daily: u.daily,
    tokenByProduct: u.tokenByProduct,
    byHour: u.byHour,
    byDow: u.byDow,
    byWeek: u.byWeek,
    productMix: u.productMix,
    usersByPlan: u.usersByPlan,
    exceptions: u.exceptions,
    statusBreakdown: u.statusBreakdown,
    tax: u.tax,
    ar: u.ar,
    pricing: u.pricing,
    relationships: u.scatter.map((point) => ({
      model: point.modelLabel,
      product: point.product,
      kind: point.kind,
      prompts: point.prompts,
      tokenBlocks: point.tokenBlocks,
      revenue: point.revenue,
    })),
    notes: u.notes,
  };
}

function buildPrompt(message: string, context: unknown, history: ChatHistoryItem[]) {
  return [
    "You are the embedded AI assistant for the NextAI Group 6 billing console.",
    "Answer only from the dashboard metrics, Oracle summaries, and conversation history provided below.",
    "This is an Oracle BRM PIN schema demo. Treat aggregate database metrics as the source of truth.",
    "Scope is Group 6 (/service/nextaig6): LLM token/prompt usage, billed revenue, plan/product mix, tax, AR, exceptions, pricing, and the Odyssey 3.0 vs 3.5 model split.",
    "Never reveal or invent customer PII, account numbers, names, emails, phone numbers, or addresses. Aggregate metrics are allowed.",
    "If the requested answer is not supported by the provided data, say what data is missing. Do not guess.",
    "For follow-up questions, use the conversation history only to resolve references; data claims must still come from the current context.",
    "Return strict JSON only. No markdown, no prose outside JSON.",
    "JSON keys: verdict, bullets, confidence, sources, actions.",
    "bullets must be an array of objects: { text, sourceLabel, sourceKey }.",
    "sources must be an array of objects: { label, key }.",
    "Use source keys only from: kpis, authChart, decline, segments, usage, catalog, tax, ar, pricing, exceptions.",
    "actions may contain these labels when relevant: Open report, View raw usage JSON.",
    "Keep the answer concise, operational, and grounded in numbers.",
    "",
    `Conversation history: ${JSON.stringify(history)}`,
    `User question: ${message}`,
    `Grounding context: ${JSON.stringify(context)}`,
  ].join("\n");
}

function parseJsonBlock(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

function normalizeBullets(value: unknown): AssistantBullet[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((item) => {
    const maybe = typeof item === "string" ? { text: item } : (item as Partial<AssistantBullet>);
    const sourceKey = SOURCE_KEYS.has(String(maybe.sourceKey)) ? String(maybe.sourceKey) : "usage";
    return {
      text: trimText(maybe.text, 900),
      sourceLabel: trimText(maybe.sourceLabel || "Grounding context", 80),
      sourceKey,
    };
  }).filter((item) => item.text);
}

function normalizeSources(value: unknown): AssistantSource[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((item) => {
    const maybe = typeof item === "string" ? { label: item, key: item } : (item as Partial<AssistantSource>);
    const key = SOURCE_KEYS.has(String(maybe.key)) ? String(maybe.key) : "usage";
    return {
      label: trimText(maybe.label || key, 80),
      key,
    };
  });
}

function normalizeActions(value: unknown): AssistantAction[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).map((item) => {
    const label = typeof item === "string" ? item : String((item as { label?: unknown })?.label ?? "");
    if (/raw|json|data/i.test(label)) return { label: "View raw usage JSON", kind: "raw_usage" as const, href: "/api/group6/usage" };
    if (/report|statistics|export/i.test(label)) return { label: "Open report", kind: "report" as const, href: "/report" };
    return { label: trimText(label || "Open report", 40), kind: "none" as const };
  });
}

function normalizeProviderResponse(result: ProviderResult, warnings: string[]): AssistantResponse {
  const parsed = parseJsonBlock(result.text) as Partial<AssistantResponse>;
  const bullets = normalizeBullets(parsed.bullets);
  const sources = normalizeSources(parsed.sources);
  const actions = normalizeActions(parsed.actions);
  const verdict = trimText(parsed.verdict, 900);

  if (!verdict) {
    throw new Error(`${result.provider} response did not include a grounded verdict.`);
  }

  return {
    verdict,
    bullets,
    confidence: trimText(parsed.confidence || `Grounded response from ${result.provider}`, 220),
    sources: sources.length ? sources : [...new Map(bullets.map((b) => [b.sourceKey, { label: b.sourceLabel, key: b.sourceKey }])).values()],
    actions,
    configured: true,
    provider: result.provider,
    model: result.model,
    warnings,
    errors: [],
  };
}

function warningResponse(verdict: string, warnings: string[], errors: string[] = []): AssistantResponse {
  return {
    verdict,
    bullets: warnings.map((text) => ({ text, sourceLabel: "Assistant configuration", sourceKey: "kpis" })),
    confidence: errors.length ? "Error - no provider returned a usable answer" : "Warning - assistant provider is not fully configured",
    sources: [{ label: "Assistant configuration", key: "kpis" }],
    actions: [],
    configured: false,
    warnings,
    errors,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = CHAT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(prompt: string): Promise<ProviderResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!configured(apiKey)) throw new Error("GEMINI_API_KEY is missing.");

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${detail.slice(0, 500)}`);
  }

  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini response did not include text content.");
  return { provider: "gemini", model, text };
}

async function callOpenRouter(prompt: string): Promise<ProviderResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!configured(apiKey)) throw new Error("OPENROUTER_API_KEY is missing.");

  const model = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free";
  const allowPaid = process.env.OPENROUTER_ALLOW_PAID === "true";
  if (!allowPaid && !model.endsWith(":free")) {
    throw new Error(`OpenRouter model "${model}" is blocked because it is not a :free model. Set OPENROUTER_MODEL to a :free slug or explicitly set OPENROUTER_ALLOW_PAID=true.`);
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  if (process.env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  if (process.env.OPENROUTER_APP_TITLE) headers["X-Title"] = process.env.OPENROUTER_APP_TITLE;

  const response = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${detail.slice(0, 500)}`);
  }

  const json = await response.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter response did not include message content.");
  return { provider: "openrouter", model, text };
}

async function callProviders(prompt: string, emit: (event: StreamEvent) => void, warnings: string[]) {
  const errors: string[] = [];
  for (const provider of providerOrder()) {
    try {
      emit({ type: "status", message: `Calling ${provider === "gemini" ? "Google AI Studio" : "OpenRouter"}...` });
      const result = provider === "gemini" ? await callGemini(prompt) : await callOpenRouter(prompt);
      emit({ type: "status", message: "Validating grounded response..." });
      return normalizeProviderResponse(result, warnings);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${provider} failed.`;
      errors.push(message);
      pushWarning(warnings, message);
    }
  }

  throw new Error(errors.join(" | ") || "No AI provider is configured.");
}

async function buildGroundingContext(body: ChatRequest, emit: (event: StreamEvent) => void) {
  emit({ type: "status", message: "Reading Oracle and Group 6 aggregates..." });
  const range = {
    from: Number.isFinite(body.range?.from) ? Math.floor(body.range!.from as number) : undefined,
    to: Number.isFinite(body.range?.to) ? Math.floor(body.range!.to as number) : undefined,
  };

  const [oracleSummary, group6, usage] = await Promise.all([
    getOracleDashboardSummary(),
    getGroup6Dashboard(),
    getGroup6Usage(range),
  ]);

  return {
    dashboard: baseDashboardContext(body.dashboardContext),
    oracle: oracleSummary,
    group6: summarizeGroup6Dashboard(group6),
    group6Usage: summarizeUsage(usage),
    selectedRange: range,
    sourceMap: {
      kpis: "Top-level dashboard KPIs and account/service status aggregates",
      authChart: "Usage volume over time chart",
      decline: "Token/model breakdown charts",
      segments: "Product, plan, model, and usage-intensity segments",
      usage: "Group 6 usage event aggregates",
      catalog: "Oracle PRODUCT_T and PLAN_T catalog context",
      tax: "AIT tax configuration and collection aggregates",
      ar: "BILL_T accounts receivable aggregates",
      pricing: "Product list price and realized price aggregates",
      exceptions: "Unrated/orphan usage, unpaid bills, and suspended subscriptions",
    },
  };
}

function streamResponse(handler: (emit: (event: StreamEvent) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await handler(emit);
      } catch (error) {
        emit({
          type: "error",
          payload: warningResponse("The assistant could not produce a grounded answer.", [], [
            error instanceof Error ? error.message : "Unknown chat error",
          ]),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequest;
  const message = body.message?.trim();

  if (!message) {
    return Response.json({ error: "Message is required." }, { status: 400 });
  }

  return streamResponse(async (emit) => {
    const warnings: string[] = [];
    if (!configured(process.env.GEMINI_API_KEY)) pushWarning(warnings, "GEMINI_API_KEY is missing; Google AI Studio will be skipped.");
    if (!configured(process.env.OPENROUTER_API_KEY)) pushWarning(warnings, "OPENROUTER_API_KEY is missing; OpenRouter backup will be skipped.");

    const context = await buildGroundingContext(body, emit);
    const history = compactHistory(body.history);
    const prompt = buildPrompt(message, context, history);

    if (!configured(process.env.GEMINI_API_KEY) && !configured(process.env.OPENROUTER_API_KEY)) {
      emit({
        type: "result",
        payload: warningResponse("No AI provider is configured, so I cannot answer from the database context yet.", warnings),
      });
      return;
    }

    const payload = await callProviders(prompt, emit, warnings);
    emit({ type: "result", payload });
  });
}
