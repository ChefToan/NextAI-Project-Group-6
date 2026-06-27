import { baseDashboardContext, type DashboardContext } from "@/lib/dashboard-context";
import { getGroup6Dashboard, type Group6Dashboard } from "@/lib/brm-group6";
import { getGroup6Usage, type Group6Usage } from "@/lib/group6-usage";
import { getOracleDashboardSummary } from "@/lib/oracle-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Compact, PII-free usage facts for the assistant context.
function summarizeUsage(u: Group6Usage) {
  if (!u.connected) return { connected: false };
  return {
    connected: true,
    window: u.windowUtc,
    kpis: u.kpis,
    models: u.models.map((m) => ({
      model: m.modelLabel,
      events: m.events,
      prompts: m.prompts,
      tokenBlocks: m.tokenBlocks,
      usageRevenue: m.usageRevenue,
      billedRevenue: m.revenueDue,
      users: m.users,
    })),
    peakHoursUtc: u.peakHours,
    busiestHours: [...u.byHour].sort((a, b) => b.m30 + b.m35 - (a.m30 + a.m35)).slice(0, 4).map((h) => ({ hour: h.hour, events: h.m30 + h.m35 })),
    topProductsByRevenue: u.productMix.slice(0, 5).map((p) => ({ product: p.product, model: p.model, users: p.users, billedRevenue: p.revenueDue })),
    note: "Day-of-week/daily totals are skewed by a Dec 19-21 backfill; hour-of-day is the reliable allocation signal.",
  };
}

type ChatRequest = {
  message?: string;
  dashboardContext?: DashboardContext;
};

type AssistantResponse = {
  verdict: string;
  bullets: Array<{ text: string; sourceLabel: string; sourceKey: string }>;
  confidence: string;
  sources: Array<{ label: string; key: string }>;
  actions: string[];
  configured: boolean;
};

function isOracleQuestion(message: string, context?: DashboardContext) {
  const lower = message.toLowerCase();
  return Boolean(
    context?.group6 ||
      /group 6|nextaig6|brm|oracle|account|plan|product|cohort|catalog|token|prompt|usage|revenue|bill|odyssey|model|3\.0|3\.5|capacity|allocat|service_t|product_t|plan_t|event/.test(
        lower,
      ),
  );
}

function answerGroup6Locally(message: string, group6: Group6Dashboard): AssistantResponse {
  const lower = message.toLowerCase();
  const dominant = group6.productMix[0];
  const cohortMix = group6.users.reduce<Record<string, number>>((acc, user) => {
    acc[user.productName] = (acc[user.productName] ?? 0) + 1;
    return acc;
  }, {});
  const cohortDominant = Object.entries(cohortMix).sort((a, b) => b[1] - a[1])[0];
  const productNames = group6.productCatalog.slice(0, 4).map((item) => item.name);
  const planNames = group6.planCatalog.slice(0, 4).map((item) => item.name);
  const cohortProduct =
    cohortDominant?.[0] || group6.users[0]?.productName || "No purchased product";
  const cohortProductUsers = cohortDominant?.[1] ?? 0;

  if (/plan|catalog/.test(lower)) {
    return {
      verdict: `Group 6 has ${group6.planCatalog.length} visible plans and ${group6.productCatalog.length} visible products in Oracle.`,
      bullets: [
        {
          text: `Plans include: ${planNames.join("; ")}.`,
          sourceLabel: "PLAN_T",
          sourceKey: "segments",
        },
        {
          text: `Products include: ${productNames.join("; ")}.`,
          sourceLabel: "PRODUCT_T",
          sourceKey: "segments",
        },
        {
          text: `The six-customer cohort is currently concentrated on ${cohortProduct}${cohortProductUsers ? ` across ${cohortProductUsers} customers` : ""}.`,
          sourceLabel: "PURCHASED_PRODUCT_T",
          sourceKey: "kpis",
        },
      ],
      confidence: "High - answered locally from Oracle, no external AI call",
      sources: [
        { label: "PLAN_T", key: "segments" },
        { label: "PRODUCT_T", key: "segments" },
        { label: "PURCHASED_PRODUCT_T", key: "kpis" },
      ],
      actions: ["Create report"],
      configured: true,
    };
  }

  return {
    verdict: `The dashboard is using the latest ${group6.users.length} Group 6 accounts. All six loaded customer accounts are active and currently show ${cohortProduct}.`,
    bullets: [
      {
        text: `${group6.metrics.group6_user_total ?? "Unknown"} total Group 6 customers are visible; ${group6.metrics.group6_active_users ?? "unknown"} are active.`,
        sourceLabel: "ACCOUNT_T + SERVICE_T",
        sourceKey: "kpis",
      },
      {
        text: `The cohort simulated current time is ${group6.simulatedNowUtc} UTC, based on the latest Group 6 account timestamp.`,
        sourceLabel: "ACCOUNT_T",
        sourceKey: "kpis",
      },
      {
        text: `The visible six-customer cohort product mix is led by ${cohortProduct}${cohortProductUsers ? ` across ${cohortProductUsers} customers` : ""}; the full Group 6 mix is led by ${dominant?.productName ?? "unknown"}.`,
        sourceLabel: "PURCHASED_PRODUCT_T + PRODUCT_T",
        sourceKey: "kpis",
      },
      {
        text: `${group6.productCatalog.length} Group 6 products and ${group6.planCatalog.length} Group 6 plans are loaded for comparison.`,
        sourceLabel: "PRODUCT_T + PLAN_T",
        sourceKey: "segments",
      },
    ],
    confidence: "High - answered locally from Oracle, no external AI call",
    sources: [
      { label: "Group 6 dashboard", key: "kpis" },
      { label: "SERVICE_T", key: "segments" },
      { label: "PRODUCT_T / PLAN_T", key: "segments" },
    ],
    actions: ["Create report"],
    configured: true,
  };
}

function fallbackAnswer(message: string): AssistantResponse {
  const lower = message.toLowerCase();
  const wantsAllocation = /time|hour|day|week|capacity|allocat|peak|provision|when/.test(lower);
  const wantsModel = /odyssey|3\.0|3\.5|model|compare/.test(lower);

  if (wantsAllocation) {
    return {
      verdict: "Allocate shared capacity around the midday-to-early-evening peak; overnight is quietest.",
      bullets: [
        { text: "Usage (by event start time) peaks roughly 12:00-14:00 and 16:00-18:00 UTC, with near-zero traffic 08:00-10:00.", sourceLabel: "Usage by hour", sourceKey: "kpis" },
        { text: "Odyssey 3.0 and 3.5 follow the same diurnal curve and split ~50/50, so headroom can be shared rather than per-model.", sourceLabel: "Hour-of-day by model", sourceKey: "segments" },
        { text: "Day-of-week and daily totals are skewed by a bulk backfill on Dec 19-21; treat hour-of-day as the reliable signal.", sourceLabel: "Usage volume over time", sourceKey: "authChart" },
      ],
      confidence: "Local fallback - configure GEMINI_API_KEY for live AI responses",
      sources: [
        { label: "Usage by hour", key: "kpis" },
        { label: "Hour-of-day by model", key: "segments" },
      ],
      actions: ["Create report"],
      configured: false,
    };
  }

  if (wantsModel) {
    return {
      verdict: "Odyssey 3.0 and 3.5 are near-balanced across Group 6 on events, prompts, tokens, and revenue.",
      bullets: [
        { text: "Usage events split almost evenly between the two models (~2,511 vs ~2,507).", sourceLabel: "Models", sourceKey: "kpis" },
        { text: "Token volumes and rated usage revenue are within a few percent of each other across models.", sourceLabel: "Token breakdown", sourceKey: "decline" },
        { text: "Each Group 6 plan bills by prompts or tokens (not both), so per-account usage sits on one axis.", sourceLabel: "Relationship", sourceKey: "segments" },
      ],
      confidence: "Local fallback - configure GEMINI_API_KEY for live AI responses",
      sources: [
        { label: "Model comparison", key: "kpis" },
        { label: "Token breakdown", key: "decline" },
      ],
      actions: ["Create report"],
      configured: false,
    };
  }

  return {
    verdict: "Group 6 usage and billing context is available. Use the Overview and Statistics tabs for tokens, prompts, revenue, and model splits.",
    bullets: [
      { text: "Scope is the Group 6 billing cohort across Odyssey 3.0 and 3.5.", sourceLabel: "Group 6 usage", sourceKey: "kpis" },
      { text: "Revenue is billed total due (BILL_T); time-resolved usage revenue uses rated event impacts.", sourceLabel: "Revenue", sourceKey: "kpis" },
      { text: "Token, prompt, temporal, and per-model aggregates come from the Group 6 usage events.", sourceLabel: "Usage events", sourceKey: "segments" },
    ],
    confidence: "Local fallback - configure GEMINI_API_KEY for live AI responses",
    sources: [
      { label: "Group 6 usage", key: "kpis" },
      { label: "Token / model breakdown", key: "segments" },
    ],
    actions: ["Create report"],
    configured: false,
  };
}

function parseJsonBlock(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

function normalizeBullets(value: unknown, fallback: AssistantResponse["bullets"]) {
  if (!Array.isArray(value)) return fallback;

  return value.slice(0, 5).map((item) => {
    if (typeof item === "string") {
      return { text: item, sourceLabel: "Oracle summary", sourceKey: "kpis" };
    }

    const maybe = item as Partial<AssistantResponse["bullets"][number]>;
    return {
      text: maybe.text || "Oracle metric is available in the dashboard context.",
      sourceLabel: maybe.sourceLabel || "Oracle summary",
      sourceKey: maybe.sourceKey || "kpis",
    };
  });
}

function normalizeSources(value: unknown, fallback: AssistantResponse["sources"]) {
  if (!Array.isArray(value)) return fallback;

  return value.slice(0, 5).map((item) => {
    if (typeof item === "string") {
      return { label: item === "kpis" ? "Oracle summary" : item, key: item };
    }

    const maybe = item as Partial<AssistantResponse["sources"][number]>;
    return {
      label: maybe.label || "Oracle summary",
      key: maybe.key || "kpis",
    };
  });
}

async function callGemini(message: string, context: unknown): Promise<AssistantResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallbackAnswer(message);

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const prompt = [
    "You are the embedded AI assistant for the NextAI Group 6 console.",
    "Answer only from the dashboard metrics and supporting context below.",
    "This deployment is connected to an Oracle BRM PIN schema. Use the Oracle aggregate metrics as the source of truth.",
    "Scope is Group 6 (/service/nextaig6): LLM token/prompt usage, billed revenue, L01-L10 usage-intensity buckets, and the Odyssey 3.0 vs 3.5 model split. L01-L10 are not plan tiers. The dashboard has an Overview tab and a Statistics & Report tab.",
    "Never reveal customer PII such as account numbers, names, emails, phone numbers, or addresses. Aggregate metrics are allowed.",
    "Return strict JSON with keys: verdict, bullets, confidence, sources, actions.",
    "bullets must be an array of objects: { text, sourceLabel, sourceKey }.",
    "sources must use these sourceKey values when relevant: kpis, authChart, decline, segments.",
    "actions can include: Create report.",
    "Keep the answer concise and operational. Do not include markdown.",
    "",
    `User question: ${message}`,
    `Context: ${JSON.stringify(context)}`,
  ].join("\n");

  const response = await fetch(endpoint, {
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

  const parsed = parseJsonBlock(text) as Partial<AssistantResponse>;

  return {
    verdict: parsed.verdict || fallbackAnswer(message).verdict,
    bullets: normalizeBullets(parsed.bullets, fallbackAnswer(message).bullets),
    confidence: parsed.confidence || "AI response based on configured dashboard context",
    sources: normalizeSources(parsed.sources, fallbackAnswer(message).sources),
    actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 4) as string[] : fallbackAnswer(message).actions,
    configured: true,
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequest;
  const message = body.message?.trim();

  if (!message) {
    return Response.json({ error: "Message is required." }, { status: 400 });
  }

  try {
    const [oracleSummary, group6, usage] = await Promise.all([
      getOracleDashboardSummary(),
      getGroup6Dashboard(),
      getGroup6Usage(),
    ]);

    // Simple catalog/cohort lookups answer instantly & deterministically; analytical
    // questions (time, model, revenue, token trends) go to the model with usage context.
    const simpleLookup = /\b(catalog|list (the )?(plans|products)|how many (users|products|plans|accounts)|which plan|recent accounts|latest accounts)\b/i.test(message);
    if (simpleLookup && isOracleQuestion(message, body.dashboardContext)) {
      return Response.json(answerGroup6Locally(message, group6));
    }

    const context = {
      dashboard: baseDashboardContext(body.dashboardContext),
      oracle: oracleSummary,
      group6Usage: summarizeUsage(usage),
    };

    return Response.json(await callGemini(message, context));
  } catch (error) {
    return Response.json(
      {
        ...fallbackAnswer(message),
        configured: Boolean(process.env.GEMINI_API_KEY),
        error: error instanceof Error ? error.message : "Unknown chat error",
      },
      { status: 200 },
    );
  }
}

